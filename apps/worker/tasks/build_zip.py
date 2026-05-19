"""
Lumio Worker — build_zip

Erzeugt einen ZIP-Archive der Originaldateien einer Galerie oder einer
Auswahl. Streaming-basiert (zipstream-ng) — kein Tempfile, kein RAM-Blowup.

Zwei Modi:
  - on_demand: ZIP wird im S3 abgelegt und für 7 Tage gecacht; API verteilt
    nur den Download-Link.
  - direct_stream: ZIP wird direkt an einen offenen HTTP-Response gepiped
    (nur sinnvoll wenn API-Prozess den Stream entgegennimmt — siehe Phase 2).
"""
from __future__ import annotations

import structlog
from app import app

log = structlog.get_logger(__name__)


@app.task(name="tasks.build_zip.build", bind=True, max_retries=2)
def build_zip(
    self,
    gallery_id: str,
    file_ids: list[str] | None = None,
    label: str = "download",
) -> dict:
    """Erzeugt ein ZIP der angegebenen (oder aller) Files einer Galerie.

    Schreibt das fertige ZIP nach S3 unter `downloads/{gallery_id}/{label}_{ts}.zip`
    und gibt den Storage-Key zurück. Die API erzeugt daraus dann eine Presigned URL.
    """
    log.info("build_zip.start", gallery_id=gallery_id, file_count=len(file_ids or []))

    # TODO:
    #   import zipstream
    #   from storage import get_s3_client, get_bucket
    #
    #   files = db.query(...)
    #   z = zipstream.ZipStream(compress_type=zipstream.ZIP_STORED)  # Bilder schon kompress.
    #   for f in files:
    #       # S3-Stream als Iterator zu zipstream geben
    #       obj = s3.get_object(Bucket=BUCKET, Key=f.storage_key)
    #       z.add(obj["Body"].iter_chunks(), arcname=f.original_filename)
    #
    #   # In Chunks zu S3 hochladen (MultipartUpload)
    #   key = f"downloads/{gallery_id}/{label}_{ts}.zip"
    #   upload_iter_to_s3(z, key)

    return {"gallery_id": gallery_id, "status": "stub"}
