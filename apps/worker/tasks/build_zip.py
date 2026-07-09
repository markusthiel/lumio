"""
Lumio Worker — build_zip

Erzeugt ein ZIP-Archiv der Originaldateien einer Galerie (oder eines
Subset).

WICHTIG zum Buffering: ein früher Versuch wollte echtes Streaming:
ZipFile auf einen BytesIO schreiben, parallel Buffer-Teile als S3-
Multipart-Parts hochladen, Buffer leeren. Das funktioniert NICHT —
ZipFile schreibt am Ende das Central Directory mit Offsets in die
zuvor geschriebenen Local File Headers; ein truncate() unter dem
Writer macht alle Offsets falsch. Resultat: lesbare Namensliste,
aber 'Bad magic number for file header' beim Entpacken.

Aktueller Ansatz: ZIP wird vollständig in einer Tempdatei auf der
Worker-Disk gebaut, dann via Multipart in 8-MiB-Chunks zu S3
gepusht. Speicherbedarf ist O(part_size). Disk-Bedarf ist O(zip_size)
— für Galerien bis ~hunderte GB völlig ok, der Worker-Container hat
genug Platz. Bei TB-Galerien müsste man auf stream-zip (oder eine
selbstgebaute store-only-Implementation, die Local File Headers
direkt schreibt und Central Directory am Ende komponiert) umsteigen.

Bei Bildern lohnt sich keine Kompression (JPEGs/RAWs sind bereits
kompakt), wir verwenden ZIP_STORED.

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

import os
import re
import tempfile
import zipfile
from datetime import datetime

import structlog
from botocore.exceptions import ClientError

from app import app
from storage import get_s3_client, get_bucket
from db import get_conn


log = structlog.get_logger(__name__)


# Chunk-Größe fürs Multipart-Upload zum S3. 8 MiB ist S3-Minimum für alle
# außer dem letzten Part.
UPLOAD_PART_BYTES = 8 * 1024 * 1024


# ENV-Fallback für die Teil-ZIP-Obergrenze, falls die API im Job keinen
# Cap mitgibt (Alt-Job / Mixed-Deploy). Regulär kommt der Wert aus dem
# Tenant-Setting bzw. dem globalen Default und wird von der API resolved.
# Bevorzugt ZIP_PART_MAX_MIB, dann das alte ZIP_PART_MAX_BYTES; Default 8 GiB.
def _part_max_bytes() -> int:
    mib = os.environ.get("ZIP_PART_MAX_MIB", "").strip()
    if mib:
        try:
            v = int(mib)
            if v > 0:
                return v * 1024 * 1024
        except ValueError:
            pass
    raw = os.environ.get("ZIP_PART_MAX_BYTES", "").strip()
    if raw:
        try:
            v = int(raw)
            if v > 0:
                return v
        except ValueError:
            pass
    return 8 * 1024 * 1024 * 1024


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
    variant: str = "original",
    part_max_bytes: int | None = None,
) -> dict:
    log.info("build_zip.start",
             zip_id=zip_download_id, gallery=gallery_id,
             file_count=len(file_ids) if file_ids else "all",
             variant=variant)

    _set_status(zip_download_id, "building")

    try:
        result = _build(
            zip_download_id=zip_download_id,
            tenant_id=tenant_id,
            gallery_id=gallery_id,
            file_ids=file_ids,
            label=label,
            variant=variant,
            part_max_bytes=part_max_bytes,
        )
        return {"zip_id": zip_download_id, "status": "ready", **result}
    except Exception as err:
        log.exception("build_zip.failed", zip_id=zip_download_id)
        _set_failed(zip_download_id, str(err))
        raise self.retry(exc=err)


# ---------------------------------------------------------------------------
# Kernlogik
# ---------------------------------------------------------------------------
def _build(*, zip_download_id: str, tenant_id: str, gallery_id: str,
           file_ids: list[str] | None, label: str,
           variant: str = "original",
           part_max_bytes: int | None = None) -> dict:
    s3 = get_s3_client()
    bucket = get_bucket()

    # Files aus der DB ziehen — original_filename + storage_key + size_bytes.
    files = _fetch_files(gallery_id, file_ids, variant)
    if not files:
        raise ValueError("no files to zip")

    ts = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    # Cap kommt normalerweise aus dem Tenant-Setting (von der API im Job
    # mitgegeben). Fehlt er (Alt-Job / Mixed-Deploy), ENV-Fallback.
    cap = part_max_bytes if (part_max_bytes and part_max_bytes > 0) else _part_max_bytes()
    section_map = _fetch_section_map(gallery_id)
    plan = _plan_parts(files, section_map, cap)

    if len(plan) <= 1:
        # Einzel-ZIP — exakt das bisherige Verhalten (rückwärtskompatibel):
        # ein Objekt, in zip_downloads.storageKey, partCount bleibt 0.
        out_key = f"t/{tenant_id}/downloads/{gallery_id}/{label}_{ts}.zip"
        _pack_and_upload(s3, bucket, files, out_key)
        _set_ready(zip_download_id, out_key)
        log.info("build_zip.single_ready", zip_id=zip_download_id, key=out_key)
        return {"key": out_key, "parts": 1}

    # Mehrteilig: pro Teil ein ZIP + eine zip_download_parts-Zeile.
    log.info("build_zip.multipart_plan",
             zip_id=zip_download_id, parts=len(plan), cap=cap)
    parts_meta: list[dict] = []
    for i, part in enumerate(plan, start=1):
        slug = _slugify(part["label"]) if part.get("label") else f"teil-{i}"
        out_key = (
            f"t/{tenant_id}/downloads/{gallery_id}/"
            f"{label}_{ts}_p{i}_{slug}.zip"
        )
        zip_size, packed = _pack_and_upload(s3, bucket, part["files"], out_key)
        parts_meta.append({
            "index": i,
            "label": part.get("label"),
            "storage_key": out_key,
            "size_bytes": zip_size,
            "file_count": packed,
        })
    _set_ready_multipart(zip_download_id, parts_meta)
    log.info("build_zip.multipart_ready",
             zip_id=zip_download_id, parts=len(parts_meta))
    return {"parts": len(parts_meta)}


def _plan_parts(files: list[dict], section_map: dict, cap: int) -> list[dict]:
    """Teilt die Dateiliste in Teile <= cap (Summe size_bytes) auf.

    Sortiert nach (Sektion-sortIndex, Sektionsname, Dateiname), packt dann
    greedy. Ein Teil, der genau EINER Sektion entspricht, bekommt deren Titel
    als Label; erstreckt sich eine Sektion über mehrere Teile, wird "Titel (k)"
    angehängt. Gemischte Teile / Dateien ohne Sektion → label = None
    (Frontend zeigt dann "Teil i/N"). Ergibt genau 1 Teil, wenn alles unter
    den Cap passt.
    """
    INF = float("inf")

    def sort_key(f):
        sm = section_map.get(str(f["id"]))
        return (sm[0] if sm else INF, sm[1] if sm else "",
                f.get("original_filename") or "")

    ordered = sorted(files, key=sort_key)

    parts: list[dict] = []
    cur: dict | None = None
    for f in ordered:
        sz = int(f.get("size_bytes") or 0)
        if cur is not None and cur["bytes"] > 0 and cur["bytes"] + sz > cap:
            parts.append(cur)
            cur = None
        if cur is None:
            cur = {"files": [], "bytes": 0, "sections": set()}
        cur["files"].append(f)
        cur["bytes"] += sz
        sm = section_map.get(str(f["id"]))
        cur["sections"].add(sm[1] if sm else None)
    if cur is not None:
        parts.append(cur)

    if len(parts) <= 1:
        return parts

    # Labels bestimmen
    from collections import Counter
    for p in parts:
        titles = {t for t in p["sections"] if t}
        p["_single"] = (
            next(iter(titles))
            if (len(titles) == 1 and None not in p["sections"])
            else None
        )
    counts = Counter(p["_single"] for p in parts if p["_single"])
    seen: dict[str, int] = {}
    for p in parts:
        t = p["_single"]
        if t and counts[t] == 1:
            p["label"] = t
        elif t:
            seen[t] = seen.get(t, 0) + 1
            p["label"] = f"{t} ({seen[t]})"
        else:
            p["label"] = None
    return parts


def _slugify(s: str) -> str:
    s = re.sub(r"[^\w.-]+", "-", s, flags=re.UNICODE).strip("-.")
    return s[:60] or "teil"


def _pack_and_upload(s3, bucket: str, files: list[dict],
                     out_key: str) -> tuple[int, int]:
    """Packt `files` in ein ZIP auf Disk und lädt es nach out_key.

    Rückgabe: (zip_size_bytes, packed_count). Fehlende S3-Objekte werden
    übersprungen (nicht fatal), packed_count zählt die tatsächlich
    eingepackten Dateien.
    """
    tmp = tempfile.NamedTemporaryFile(
        prefix="lumio-zip-", suffix=".zip", delete=False
    )
    tmp_path = tmp.name
    try:
        with zipfile.ZipFile(
            tmp, mode="w",
            compression=zipfile.ZIP_STORED,
            allowZip64=True,
        ) as zf:
            seen_names: set[str] = set()
            skipped: list[dict] = []
            for f in files:
                arcname = _dedupe_name(f["original_filename"], seen_names)
                zinfo = zipfile.ZipInfo(filename=arcname)
                zinfo.compress_type = zipfile.ZIP_STORED
                zinfo.date_time = datetime.utcnow().timetuple()[:6]

                try:
                    obj = s3.get_object(Bucket=bucket, Key=f["storage_key"])
                except s3.exceptions.NoSuchKey:
                    skipped.append({
                        "file_id": f.get("id"),
                        "key": f["storage_key"],
                        "filename": f["original_filename"],
                        "error": "NoSuchKey",
                    })
                    log.warning(
                        "build_zip.skip_missing_key",
                        file_id=str(f.get("id")),
                        key=f["storage_key"],
                        filename=f["original_filename"],
                    )
                    continue
                except ClientError as e:
                    err = e.response.get("Error", {})
                    code = err.get("Code", "")
                    status = (
                        e.response.get("ResponseMetadata", {}).get(
                            "HTTPStatusCode"
                        )
                    )
                    is_not_found = (
                        status == 404
                        or code
                        in (
                            "NoSuchKey",
                            "NoSuchBucket",
                            "404",
                            "NotFound",
                        )
                    )
                    if is_not_found:
                        skipped.append({
                            "file_id": f.get("id"),
                            "key": f["storage_key"],
                            "filename": f["original_filename"],
                            "error": code or f"HTTP{status}",
                        })
                        log.warning(
                            "build_zip.skip_s3_not_found",
                            file_id=str(f.get("id")),
                            key=f["storage_key"],
                            filename=f["original_filename"],
                            code=code,
                            status=status,
                        )
                        continue
                    log.error(
                        "build_zip.s3_error_unrecoverable",
                        file_id=str(f.get("id")),
                        key=f["storage_key"],
                        code=code,
                        status=status,
                        message=err.get("Message", ""),
                    )
                    raise

                with zf.open(zinfo, "w") as zentry:
                    body = obj["Body"]
                    while True:
                        chunk = body.read(1024 * 1024)
                        if not chunk:
                            break
                        zentry.write(chunk)

            if skipped:
                log.warning(
                    "build_zip.completed_with_skips",
                    count=len(skipped),
                    total=len(files),
                )

        tmp.close()
        zip_size = os.path.getsize(tmp_path)
        packed = len(files) - len(skipped)
        log.info("build_zip.local_complete",
                 path=tmp_path, size=zip_size, packed=packed)

        if zip_size < UPLOAD_PART_BYTES:
            with open(tmp_path, "rb") as fh:
                s3.put_object(
                    Bucket=bucket,
                    Key=out_key,
                    Body=fh,
                    ContentType="application/zip",
                    ContentLength=zip_size,
                )
            log.info("build_zip.uploaded_single", key=out_key, size=zip_size)
        else:
            _multipart_upload_file(s3, bucket, out_key, tmp_path)

        return zip_size, packed

    finally:
        try:
            os.unlink(tmp_path)
        except FileNotFoundError:
            pass


def _multipart_upload_file(s3, bucket: str, out_key: str, src_path: str) -> None:
    """Lädt eine lokale Datei in 8-MiB-Parts via S3-Multipart hoch."""
    create = s3.create_multipart_upload(
        Bucket=bucket, Key=out_key, ContentType="application/zip"
    )
    upload_id = create["UploadId"]
    parts: list[dict] = []
    part_number = 1

    try:
        with open(src_path, "rb") as f:
            while True:
                chunk = f.read(UPLOAD_PART_BYTES)
                if not chunk:
                    break
                resp = s3.upload_part(
                    Bucket=bucket,
                    Key=out_key,
                    UploadId=upload_id,
                    PartNumber=part_number,
                    Body=chunk,
                )
                parts.append({"ETag": resp["ETag"], "PartNumber": part_number})
                log.debug(
                    "build_zip.part_uploaded",
                    part=part_number, size=len(chunk),
                )
                part_number += 1

        if not parts:
            raise RuntimeError("no parts uploaded")

        s3.complete_multipart_upload(
            Bucket=bucket, Key=out_key, UploadId=upload_id,
            MultipartUpload={"Parts": parts},
        )
        log.info("build_zip.multipart_complete",
                 key=out_key, parts=len(parts))

    except Exception:
        try:
            s3.abort_multipart_upload(
                Bucket=bucket, Key=out_key, UploadId=upload_id,
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
                 file_ids: list[str] | None,
                 variant: str = "original") -> list[dict]:
    """Lädt Files aus der DB.

    Bei variant="web" bevorzugen wir je nach file.kind:
      - Videos:    'video_mp4' (standalone MP4, Download-fähig)
      - Bilder:    'web_jpeg' (Kunden-freundliches JPEG), Fallback 'web'
                   (webp) für Altbestand vor der web_jpeg-Pipeline

    Files ohne passende Web-Rendition werden weggefiltert — bei
    Videos kann das passieren wenn der Backfill für video_mp4 noch
    nicht durchgelaufen ist. Wir bauen lieber eine kleinere ZIP
    ohne diese Videos als eine kaputte mit Standbildern statt
    Videos.

    Filenames werden auf "<stem>_web.<ext>" umgebaut, mit ext je
    nach Rendition-Format (mp4, jpg, webp).
    """
    with get_conn() as conn:
        if variant == "web":
            # DISTINCT ON pro File-ID, mit ORDER-BY-Präferenz die beim
            # picken die "richtige" Rendition zieht: video_mp4 für
            # Videos, web_jpeg für Bilder (Fallback web/webp).
            if file_ids:
                rows = conn.execute(
                    'SELECT DISTINCT ON (f.id) '
                    '  f.id, f."originalFilename" AS original_filename, '
                    '  f.kind AS file_kind, '
                    '  r."storageKey" AS storage_key, '
                    '  r."sizeBytes" AS size_bytes, '
                    '  r.kind AS rkind, r.format AS rformat '
                    'FROM files f '
                    'JOIN renditions r ON r."fileId" = f.id '
                    'WHERE f."galleryId" = %s AND f.id = ANY(%s) '
                    '  AND f.status = %s '
                    '  AND f."publicVisibility" = %s '
                    '  AND ( '
                    '    (f.kind = %s AND r.kind = %s) '
                    '    OR (f.kind <> %s AND r.kind IN (%s, %s)) '
                    '  ) '
                    'ORDER BY f.id, '
                    '  CASE r.kind '
                    '    WHEN %s THEN 0 '
                    '    WHEN %s THEN 0 '
                    '    ELSE 1 '
                    '  END, '
                    '  f."sortIndex"',
                    (gallery_id, file_ids, "ready", "visible",
                     "video", "video_mp4",
                     "video", "web_jpeg", "web",
                     "video_mp4", "web_jpeg"),
                ).fetchall()
            else:
                rows = conn.execute(
                    'SELECT DISTINCT ON (f.id) '
                    '  f.id, f."originalFilename" AS original_filename, '
                    '  f.kind AS file_kind, '
                    '  r."storageKey" AS storage_key, '
                    '  r."sizeBytes" AS size_bytes, '
                    '  r.kind AS rkind, r.format AS rformat '
                    'FROM files f '
                    'JOIN renditions r ON r."fileId" = f.id '
                    'WHERE f."galleryId" = %s AND f.status = %s '
                    '  AND f."publicVisibility" = %s '
                    '  AND ( '
                    '    (f.kind = %s AND r.kind = %s) '
                    '    OR (f.kind <> %s AND r.kind IN (%s, %s)) '
                    '  ) '
                    'ORDER BY f.id, '
                    '  CASE r.kind '
                    '    WHEN %s THEN 0 '
                    '    WHEN %s THEN 0 '
                    '    ELSE 1 '
                    '  END, '
                    '  f."sortIndex"',
                    (gallery_id, "ready", "visible",
                     "video", "video_mp4",
                     "video", "web_jpeg", "web",
                     "video_mp4", "web_jpeg"),
                ).fetchall()

            files = list(rows)
            # Filenames in *_web.<ext> umbauen. Extension je nach
            # tatsächlichem Format: mp4 bei Videos, jpg bei web_jpeg,
            # webp bei legacy web-Renditions.
            for f in files:
                fn = f["original_filename"]
                dot = fn.rfind(".")
                stem = fn[:dot] if dot > 0 else fn
                if f["rkind"] == "video_mp4":
                    ext = "mp4"
                elif f["rformat"] == "jpg":
                    ext = "jpg"
                else:
                    ext = "webp"
                f["original_filename"] = f"{stem}_web.{ext}"
            return files

        # variant="original" — Standard
        if file_ids:
            rows = conn.execute(
                'SELECT id, "originalFilename" AS original_filename, '
                '"storageKey" AS storage_key, "sizeBytes" AS size_bytes '
                'FROM files '
                'WHERE "galleryId" = %s AND id = ANY(%s) AND status = %s '
                '  AND "publicVisibility" = %s '
                'ORDER BY "sortIndex", "originalFilename"',
                (gallery_id, file_ids, "ready", "visible"),
            ).fetchall()
        else:
            rows = conn.execute(
                'SELECT id, "originalFilename" AS original_filename, '
                '"storageKey" AS storage_key, "sizeBytes" AS size_bytes '
                'FROM files '
                'WHERE "galleryId" = %s AND status = %s '
                '  AND "publicVisibility" = %s '
                'ORDER BY "sortIndex", "originalFilename"',
                (gallery_id, "ready", "visible"),
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
        # Etwaige Teile aus einem früheren (mehrteiligen) Build entfernen —
        # dieser Build ist einteilig.
        conn.execute(
            'DELETE FROM zip_download_parts WHERE "zipDownloadId" = %s',
            (zip_id,),
        )
        conn.execute(
            'UPDATE zip_downloads '
            'SET status = %s, "storageKey" = %s, "sizeBytes" = %s, '
            '    "partCount" = 0, "updatedAt" = NOW() '
            'WHERE id = %s',
            ("ready", storage_key, size, zip_id),
        )


def _fetch_section_map(gallery_id: str) -> dict:
    """file_id -> (section_sortIndex, section_title) für Files mit Sektion.

    Files ohne Sektion tauchen nicht auf (werden beim Split ans Ende
    gruppiert und generisch benannt).
    """
    with get_conn() as conn:
        rows = conn.execute(
            'SELECT f.id AS file_id, gs."sortIndex" AS sort_index, '
            '       gs.title AS title '
            'FROM files f '
            'JOIN gallery_sections gs ON gs.id = f."sectionId" '
            'WHERE f."galleryId" = %s AND f."sectionId" IS NOT NULL',
            (gallery_id,),
        ).fetchall()
    return {str(r["file_id"]): (r["sort_index"], r["title"]) for r in rows}


def _set_ready_multipart(zip_id: str, parts: list[dict]) -> None:
    """Schreibt die Teil-Zeilen und markiert den Parent als ready (mehrteilig).

    Läuft als eine Transaktion (get_conn committet beim Verlassen).
    """
    total = sum(int(p["size_bytes"]) for p in parts)
    count = sum(int(p["file_count"]) for p in parts)
    with get_conn() as conn:
        conn.execute(
            'DELETE FROM zip_download_parts WHERE "zipDownloadId" = %s',
            (zip_id,),
        )
        for p in parts:
            conn.execute(
                'INSERT INTO zip_download_parts '
                '(id, "zipDownloadId", "partIndex", label, "storageKey", '
                ' "sizeBytes", "fileCount", "createdAt") '
                'VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, NOW())',
                (zip_id, p["index"], p["label"], p["storage_key"],
                 int(p["size_bytes"]), int(p["file_count"])),
            )
        conn.execute(
            'UPDATE zip_downloads '
            'SET status = %s, "storageKey" = NULL, "sizeBytes" = %s, '
            '    "partCount" = %s, "fileCount" = %s, "updatedAt" = NOW() '
            'WHERE id = %s',
            ("ready", total, len(parts), count, zip_id),
        )


def _set_failed(zip_id: str, message: str) -> None:
    with get_conn() as conn:
        conn.execute(
            'UPDATE zip_downloads '
            'SET status = %s, "errorMessage" = %s, "updatedAt" = NOW() '
            'WHERE id = %s',
            ("failed", message[:500], zip_id),
        )
