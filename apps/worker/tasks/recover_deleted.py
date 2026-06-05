"""
Lumio Worker — recover_deleted

Stellt GELÖSCHTE Originaldateien eines Tenants/einer Galerie wieder her,
indem es die noncurrent Objekt-Versionen aus dem (versionierten) S3-Bucket
liest und in ein ZIP packt. Use-Case: ein Kunde hat versehentlich Galerien/
Bilder gelöscht — die DB-Zeilen sind weg, aber dank Bucket-Versioning liegen
die Originale noch als noncurrent Versionen im Bucket (Aufbewahrung per
Lifecycle, Standard 30 Tage).

WICHTIG: Das stellt NICHT die Galerien in der App wieder her (dafür müssten
DB-Zeilen rekonstruiert werden — separates Thema). Es liefert dem Studio die
verlorenen Quelldateien als Download.

Enumeration über das deterministische Key-Layout:
    t/<tenant>/g/<gallery>/orig/<file>/<dateiname>

Ein Key gilt als "gelöscht und wiederherstellbar", wenn seine AKTUELLE
Version ein Delete-Marker ist UND es eine vorherige echte Version gibt.
Wir holen die jüngste echte Version (die unmittelbar vor dem Löschen).

Aufgerufen über lumio:jobs:export mit type=recover_deleted:
    { "type": "recover_deleted", "exportItemId": "...",
      "tenantId": "...", "galleryId": "..." }
"""
from __future__ import annotations

import os
import tempfile
import zipfile
from datetime import datetime
from typing import Any

import structlog

from app import app
from storage import get_s3_client, get_bucket

# Status-/Upload-Helfer aus export_zip wiederverwenden — identische
# tenant_export_items-Tabelle, identisches Multipart-Upload.
from tasks.export_zip import (
    _set_item_status,
    _set_item_ready,
    _set_item_failed,
    _maybe_finalize_export,
    _multipart_upload,
    _dedupe_name,
)

log = structlog.get_logger(__name__)


@app.task(
    name="tasks.recover_deleted.build",
    bind=True,
    max_retries=1,
    default_retry_delay=120,
)
def recover_deleted(
    self,
    export_item_id: str,
    tenant_id: str,
    gallery_id: str,
) -> dict:
    log.info(
        "recover_deleted.start",
        item_id=export_item_id, tenant=tenant_id, gallery=gallery_id,
    )
    _set_item_status(export_item_id, "building")

    try:
        result = _build(tenant_id=tenant_id, gallery_id=gallery_id)
        _set_item_ready(
            export_item_id,
            storage_key=result["storage_key"],
            size_bytes=result["size_bytes"],
            file_count=result["file_count"],
        )
        _maybe_finalize_export(export_item_id)
        return {"item_id": export_item_id, "status": "ready", **result}
    except Exception as err:
        log.exception("recover_deleted.failed", item_id=export_item_id)
        _set_item_failed(export_item_id, str(err))
        _maybe_finalize_export(export_item_id)
        return {"item_id": export_item_id, "status": "failed"}


def _build(*, tenant_id: str, gallery_id: str) -> dict[str, Any]:
    s3 = get_s3_client()
    bucket = get_bucket()
    prefix = f"t/{tenant_id}/g/{gallery_id}/orig/"

    # Versionen + Delete-Marker unter dem Prefix paginiert einsammeln.
    deleted_latest: set[str] = set()
    versions_by_key: dict[str, list[tuple[str, Any, int]]] = {}
    kwargs: dict[str, Any] = {"Bucket": bucket, "Prefix": prefix}
    while True:
        resp = s3.list_object_versions(**kwargs)
        for dm in resp.get("DeleteMarkers", []):
            if dm.get("IsLatest"):
                deleted_latest.add(dm["Key"])
        for v in resp.get("Versions", []):
            versions_by_key.setdefault(v["Key"], []).append(
                (v["VersionId"], v["LastModified"], int(v.get("Size", 0)))
            )
        if resp.get("IsTruncated"):
            kwargs["KeyMarker"] = resp.get("NextKeyMarker")
            kwargs["VersionIdMarker"] = resp.get("NextVersionIdMarker")
        else:
            break

    # Wiederherstellbar: Key aktuell gelöscht (Delete-Marker ist latest)
    # UND es existiert eine vorherige echte Version → die jüngste nehmen.
    recover: list[tuple[str, str]] = []  # (key, version_id)
    for key in deleted_latest:
        cands = versions_by_key.get(key)
        if not cands:
            continue
        cands.sort(key=lambda c: c[1], reverse=True)  # jüngste zuerst
        recover.append((key, cands[0][0]))

    if not recover:
        raise ValueError(
            "Keine wiederherstellbaren gelöschten Originale gefunden "
            "(evtl. außerhalb des Aufbewahrungsfensters von 30 Tagen)."
        )

    ts = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    out_key = f"t/{tenant_id}/exports/recovered_{ts}_{gallery_id}.zip"

    tmp = tempfile.NamedTemporaryFile(
        prefix="lumio-recover-", suffix=".zip", delete=False
    )
    tmp_path = tmp.name
    file_count = 0
    try:
        with zipfile.ZipFile(
            tmp, mode="w", compression=zipfile.ZIP_STORED, allowZip64=True
        ) as zf:
            seen: set[str] = set()
            for key, version_id in recover:
                filename = key.rsplit("/", 1)[-1] or key
                arcname = _dedupe_name(filename, seen)
                try:
                    obj = s3.get_object(
                        Bucket=bucket, Key=key, VersionId=version_id
                    )
                except Exception as e:  # noqa: BLE001
                    # Einzelnes Objekt nicht lesbar (z.B. Version inzwischen
                    # durch Lifecycle entfernt) → überspringen, Rest retten.
                    log.warning(
                        "recover_deleted.skip_object",
                        key=key, version_id=version_id, error=str(e),
                    )
                    continue
                zinfo = zipfile.ZipInfo(filename=arcname)
                zinfo.compress_type = zipfile.ZIP_STORED
                zinfo.date_time = datetime.utcnow().timetuple()[:6]
                with zf.open(zinfo, "w") as zentry:
                    body = obj["Body"]
                    while True:
                        chunk = body.read(1024 * 1024)
                        if not chunk:
                            break
                        zentry.write(chunk)
                file_count += 1

        tmp.close()

        if file_count == 0:
            raise ValueError(
                "Gelöschte Versionen waren nicht mehr lesbar "
                "(Aufbewahrungsfenster überschritten?)."
            )

        size_bytes = os.path.getsize(tmp_path)
        log.info(
            "recover_deleted.local_complete",
            files=file_count, size=size_bytes, gallery=gallery_id,
        )
        _multipart_upload(tmp_path, out_key)

        return {
            "storage_key": out_key,
            "size_bytes": size_bytes,
            "file_count": file_count,
        }
    finally:
        try:
            os.unlink(tmp_path)
        except FileNotFoundError:
            pass
