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
) -> dict:
    log.info("build_zip.start",
             zip_id=zip_download_id, gallery=gallery_id,
             file_count=len(file_ids) if file_ids else "all",
             variant=variant)

    _set_status(zip_download_id, "building")

    try:
        storage_key = _build(
            tenant_id=tenant_id,
            gallery_id=gallery_id,
            file_ids=file_ids,
            label=label,
            variant=variant,
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
           file_ids: list[str] | None, label: str,
           variant: str = "original") -> str:
    s3 = get_s3_client()
    bucket = get_bucket()

    # Files aus der DB ziehen — original_filename + storage_key. Bei
    # variant="web" joinen wir auf renditions(kind='web') und nutzen
    # deren storageKey + bauen "_web.webp"-Dateinamen.
    files = _fetch_files(gallery_id, file_ids, variant)
    if not files:
        raise ValueError("no files to zip")

    ts = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    out_key = f"t/{tenant_id}/downloads/{gallery_id}/{label}_{ts}.zip"

    # Tempdatei auf Disk. delete=False, damit wir explizit close()-en
    # können bevor wir lesen — sonst hat NamedTemporaryFile auf manchen
    # Plattformen Probleme. Wir räumen am Ende selbst auf.
    tmp = tempfile.NamedTemporaryFile(
        prefix="lumio-zip-", suffix=".zip", delete=False
    )
    tmp_path = tmp.name
    try:
        # Phase 1: ZIP auf Disk bauen
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

                # Defensives Skipping: wenn das S3-Objekt fehlt (z.B.
                # weil ein reject-Cleanup die Rendition-Datei gelöscht
                # hat, oder weil jemand direkt im Bucket manipuliert
                # hat), wollen wir nicht den ganzen ZIP-Build sprengen.
                # Wir loggen das File und gehen weiter. Der Customer
                # bekommt ein ZIP mit den anderen Files; die fehlenden
                # erscheinen in den Worker-Logs für Debugging.
                #
                # Wir catchen sowohl s3.exceptions.NoSuchKey (boto3
                # >=1.20) als auch ClientError mit verschiedenen
                # Codes (MinIO meldet manchmal NoSuchKey, manchmal
                # '404', manchmal 'NoSuchBucket' wenn die Tenant-
                # Bucket-Konvention durcheinander geraten ist).
                # Default: alles was 404-artig aussieht skippen,
                # andere ClientErrors (Auth-Probleme, 5xx) bubbeln
                # weiter und brechen den Build ab.
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
                    # Skip auf alles was nach "Objekt nicht da" aussieht
                    # — egal welcher Code-String, solange HTTP 404 oder
                    # einer der bekannten S3/MinIO-Codes.
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
                    # Andere S3-Fehler: loggen und re-raisen — die
                    # darf der Worker nicht stillschweigend schlucken.
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
        log.info("build_zip.local_complete", path=tmp_path, size=zip_size)

        # Phase 2: Hochladen. Bei kleinen ZIPs (< 8 MiB) ein
        # einfaches put_object — Multipart hat S3-seits einen
        # 5-MiB-Mindest-Part (außer letztem) und der Setup-Overhead
        # lohnt da nicht.
        if zip_size < UPLOAD_PART_BYTES:
            with open(tmp_path, "rb") as f:
                s3.put_object(
                    Bucket=bucket,
                    Key=out_key,
                    Body=f,
                    ContentType="application/zip",
                    ContentLength=zip_size,
                )
            log.info("build_zip.uploaded_single", key=out_key, size=zip_size)
        else:
            _multipart_upload_file(s3, bucket, out_key, tmp_path)

        return out_key

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
