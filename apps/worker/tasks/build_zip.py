"""
Lumio Worker — build_zip

Erzeugt ein ZIP-Archiv der Originaldateien einer Galerie (oder eines
Subset). Wir streamen die Files aus S3 in den ZIP-Stream und laden den
Stream in Chunks zu S3 hoch (Multipart). So bleibt der Speicherbedarf
konstant, egal wie groß die Galerie.

Bei Bildern lohnt sich keine Kompression (JPEGs/RAWs sind bereits
kompakt), wir verwenden `ZIP_STORED`.

Aufgerufen über den Job-Stream lumio:jobs:zip_build:
  {
    "type": "build_zip",
    "tenantId": "...",
    "galleryId": "...",
    "fileIds": null | ["..."],
    "label": "all" | "selection_<accessId>",
    "zipDownloadId": "..."
  }
"""
from __future__ import annotations

import io
import os
import zipfile
from datetime import datetime
from pathlib import Path

import structlog

from app import app
from storage import get_s3_client, get_bucket
from db import get_conn


log = structlog.get_logger(__name__)


# Chunk-Größe fürs Multipart-Upload zum S3. 8 MiB ist S3-Minimum für alle
# außer dem letzten Part.
UPLOAD_PART_BYTES = 8 * 1024 * 1024


@app.task(
    name="tasks.build_zip.build",
    bind=True,
    max_retries=1,
    default_retry_delay=120,
)
def build_zip(
    self,
    zip_download_id: str,
    tenant_id: str,
    gallery_id: str,
    file_ids: list[str] | None,
    label: str,
) -> dict:
    log.info("build_zip.start",
             zip_id=zip_download_id, gallery=gallery_id,
             file_count=len(file_ids) if file_ids else "all")

    _set_status(zip_download_id, "building")

    try:
        storage_key = _build(
            tenant_id=tenant_id,
            gallery_id=gallery_id,
            file_ids=file_ids,
            label=label,
        )
        _set_ready(zip_download_id, storage_key)
        return {"zip_id": zip_download_id, "status": "ready", "key": storage_key}
    except Exception as err:
        log.exception("build_zip.failed", zip_id=zip_download_id)
        _set_failed(zip_download_id, str(err))
        raise self.retry(exc=err)


# ---------------------------------------------------------------------------
# Kernlogik
# ---------------------------------------------------------------------------
def _build(*, tenant_id: str, gallery_id: str,
           file_ids: list[str] | None, label: str) -> str:
    s3 = get_s3_client()
    bucket = get_bucket()

    # Files aus der DB ziehen — original_filename + storage_key
    files = _fetch_files(gallery_id, file_ids)
    if not files:
        raise ValueError("no files to zip")

    ts = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    out_key = f"t/{tenant_id}/downloads/{gallery_id}/{label}_{ts}.zip"

    # Multipart-Upload aufsetzen
    create = s3.create_multipart_upload(
        Bucket=bucket, Key=out_key, ContentType="application/zip"
    )
    upload_id = create["UploadId"]
    parts: list[dict] = []
    part_number = 1

    buffer = io.BytesIO()

    def flush_buffer(final: bool = False) -> None:
        """Wenn buffer ≥ UPLOAD_PART_BYTES (oder final): als Part nach S3."""
        nonlocal part_number
        data = buffer.getvalue()
        if not data and not final:
            return
        if not final and len(data) < UPLOAD_PART_BYTES:
            return
        if final and not data and parts:
            return  # nichts mehr zu uploaden

        resp = s3.upload_part(
            Bucket=bucket,
            Key=out_key,
            UploadId=upload_id,
            PartNumber=part_number,
            Body=data,
        )
        parts.append({"ETag": resp["ETag"], "PartNumber": part_number})
        log.debug("build_zip.part_uploaded",
                  part=part_number, size=len(data))
        part_number += 1
        buffer.seek(0)
        buffer.truncate()

    try:
        # ZIP-Writer auf BytesIO. Wir schreiben Files rein und flushen
        # immer wenn der Buffer voll genug ist.
        with zipfile.ZipFile(buffer, mode="w",
                             compression=zipfile.ZIP_STORED,
                             allowZip64=True) as zf:
            seen_names: set[str] = set()
            for f in files:
                arcname = _dedupe_name(f["original_filename"], seen_names)
                zinfo = zipfile.ZipInfo(filename=arcname)
                zinfo.compress_type = zipfile.ZIP_STORED
                # Datum aus File.created_at? Wir nehmen jetzt, der Browser
                # zeigt das in den Eigenschaften an.
                zinfo.date_time = datetime.utcnow().timetuple()[:6]

                # File-Daten direkt aus S3 in den ZIP-Stream pumpen
                obj = s3.get_object(Bucket=bucket, Key=f["storage_key"])
                with zf.open(zinfo, "w") as zentry:
                    body = obj["Body"]
                    while True:
                        chunk = body.read(1024 * 1024)
                        if not chunk:
                            break
                        zentry.write(chunk)
                        # Nach jedem MiB checken, ob wir ein Part hochladen
                        # können
                        flush_buffer()

        # ZIP ist fertig geschrieben — verbleibenden Buffer als letzten Part
        flush_buffer(final=True)

        # Wenn nur EIN Part angelegt wurde und der < 5 MiB ist, hätten wir
        # eigentlich kein Multipart machen sollen — S3 verlangt dann nicht
        # die 5-MiB-Mindestgröße für den letzten Part, also ist das ok.
        if not parts:
            # Edge-Case: leere ZIP — sollte nicht passieren, aber defensiv
            raise RuntimeError("no parts uploaded")

        s3.complete_multipart_upload(
            Bucket=bucket, Key=out_key, UploadId=upload_id,
            MultipartUpload={"Parts": parts},
        )
        log.info("build_zip.complete", key=out_key, parts=len(parts))
        return out_key

    except Exception:
        # Multipart aufräumen, damit nichts im Bucket bleibt
        try:
            s3.abort_multipart_upload(
                Bucket=bucket, Key=out_key, UploadId=upload_id
            )
        except Exception:
            pass
        raise


def _dedupe_name(name: str, seen: set[str]) -> str:
    """Verhindert Kollisionen bei identischen Dateinamen."""
    if name not in seen:
        seen.add(name)
        return name
    stem, ext = os.path.splitext(name)
    for i in range(2, 10_000):
        candidate = f"{stem}_{i}{ext}"
        if candidate not in seen:
            seen.add(candidate)
            return candidate
    # Pathologischer Fall — UUID dranhängen
    import uuid
    candidate = f"{stem}_{uuid.uuid4().hex[:8]}{ext}"
    seen.add(candidate)
    return candidate


# ---------------------------------------------------------------------------
# DB-Helfer
# ---------------------------------------------------------------------------
def _fetch_files(gallery_id: str,
                 file_ids: list[str] | None) -> list[dict]:
    with get_conn() as conn:
        if file_ids:
            rows = conn.execute(
                'SELECT id, "originalFilename" AS original_filename, '
                '"storageKey" AS storage_key, "sizeBytes" AS size_bytes '
                'FROM files '
                'WHERE "galleryId" = %s AND id = ANY(%s) AND status = %s '
                'ORDER BY "sortIndex", "originalFilename"',
                (gallery_id, file_ids, "ready"),
            ).fetchall()
        else:
            rows = conn.execute(
                'SELECT id, "originalFilename" AS original_filename, '
                '"storageKey" AS storage_key, "sizeBytes" AS size_bytes '
                'FROM files '
                'WHERE "galleryId" = %s AND status = %s '
                'ORDER BY "sortIndex", "originalFilename"',
                (gallery_id, "ready"),
            ).fetchall()
    return list(rows)


def _set_status(zip_id: str, status: str) -> None:
    with get_conn() as conn:
        conn.execute(
            'UPDATE zip_downloads SET status = %s, "updatedAt" = NOW() '
            'WHERE id = %s',
            (status, zip_id),
        )


def _set_ready(zip_id: str, storage_key: str) -> None:
    with get_conn() as conn:
        # Größe holen
        s3 = get_s3_client()
        head = s3.head_object(Bucket=get_bucket(), Key=storage_key)
        size = head.get("ContentLength", 0)
        conn.execute(
            'UPDATE zip_downloads '
            'SET status = %s, "storageKey" = %s, "sizeBytes" = %s, '
            '    "updatedAt" = NOW() '
            'WHERE id = %s',
            ("ready", storage_key, size, zip_id),
        )


def _set_failed(zip_id: str, message: str) -> None:
    with get_conn() as conn:
        conn.execute(
            'UPDATE zip_downloads '
            'SET status = %s, "errorMessage" = %s, "updatedAt" = NOW() '
            'WHERE id = %s',
            ("failed", message[:500], zip_id),
        )
