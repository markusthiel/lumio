"""
Lumio Worker — process_file

Standard image processing for JPEG, PNG, WebP, AVIF, TIFF, GIF, HEIC and PSD
(PSD via composite extraction with Pillow, see psd.py -- libvips cannot
read PSD directly).

Generates three renditions per image:
  - thumb        ( 400 px long edge, WebP, q75)
  - preview      (1600 px long edge, WebP, q82)
  - web          (2560 px long edge, WebP, q85)

Engine: libvips via pyvips. ~4-8x faster than Pillow/ImageMagick and a
lower memory footprint, because processing is sequential.

Invocation (from Celery via app.send_task, or directly):
  generate_renditions.delay(file_id)
"""
from __future__ import annotations

import os
import tempfile

import structlog

from app import app
from db import fetch_file, mark_file_ready, mark_file_failed, upsert_rendition, set_taken_at, reconcile_original_size
from exif_meta import extract_metadata
from hashing import sha256_file
from imaging import render_image_sizes
from psd import is_psd, flatten_psd_to_png
from rt import file_status as _publish_status
from storage import (
    download_to_file,
    upload_file,
    rendition_key,
)

log = structlog.get_logger(__name__)


# Renditions the worker generates. Tuple: (kind, max_long_edge, quality, format).
#
# Why web_jpeg in addition to web? The customer-download variant "Web
# version" originally served web.webp. WebP opens in modern browsers and
# macOS Preview, but not in classic image management tools (Lightroom
# import, older Photoshop versions, many print shops). An additional
# JPEG variant with slightly higher quality (88 vs 85) partially
# compensates for the size growth from the less efficient format; the
# resulting file is about 30-40% larger than the webp but smaller than
# the original and opens easily everywhere.
#
# Storage overhead: ~1-2 MB extra per file (a 2560px JPEG image). So for
# a 100-file gallery, +100-200 MB storage. Acceptable compared to the
# original (typically 5-15 MB per RAW or high-resolution JPEG).
RENDITION_SPECS: list[tuple[str, int, int, str]] = [
    ("thumb", 400, 75, "webp"),
    ("preview", 1600, 82, "webp"),
    ("web", 2560, 85, "webp"),
    ("web_jpeg", 2560, 88, "jpg"),
]


@app.task(
    name="tasks.process_file.generate_renditions",
    bind=True,
    max_retries=2,
    default_retry_delay=30,
)
def generate_renditions(self, file_id: str) -> dict:
    log.info("process_file.start", file_id=file_id)

    file_row = fetch_file(file_id)
    if not file_row:
        log.warning("process_file.file_missing", file_id=file_id)
        return {"file_id": file_id, "status": "missing"}

    try:
        _process(file_row)
        return {"file_id": file_id, "status": "ready"}
    except Exception as err:
        log.exception("process_file.failed", file_id=file_id, err=str(err))
        try:
            mark_file_failed(file_id, str(err))
            _publish_status(file_row["gallery_id"], file_id, "failed")
        except Exception:
            pass
        # Retry, if attempts remain
        raise self.retry(exc=err)


def _process(file_row: dict) -> None:
    """Downloads the original, generates the renditions, writes them to S3
    and the DB."""
    file_id = file_row["id"]
    tenant_id = file_row["tenant_id"]
    gallery_id = file_row["gallery_id"]
    storage_key = file_row["storage_key"]

    with tempfile.TemporaryDirectory(prefix="lumio_") as tmp:
        src_path = os.path.join(tmp, "source")
        download_to_file(storage_key, src_path)
        # Write the ACTUAL original size back (the client-reported value
        # was unchecked; protects quota/billing from being undercut).
        reconcile_original_size(file_id, os.path.getsize(src_path))
        log.info("process_file.downloaded", file_id=file_id,
                 size=os.path.getsize(src_path))

        # Compute SHA-256 of the original file. ~1s for a 50 MB photo;
        # negligible compared to the decode + resize cost. We do this up
        # here rather than at the end, so an encoding error doesn't
        # accidentally prevent the hash -- the original is the sole
        # source of truth for the hash, all renditions come only after.
        src_sha = sha256_file(src_path)

        # Read capture timestamp + original hash/size from the original's
        # EXIF (best-effort, never throws). From the ORIGINAL, not the
        # PSD composite etc. -- only the original carries the camera EXIF
        # (and any hash/size embedded by the Lightroom plug-in). A single
        # exiftool call for all three values instead of several.
        taken_at, original_md5, original_size = extract_metadata(src_path)

        def _persist(
            kind: str, out_path: str, w: int, h: int, fmt: str
        ) -> None:
            content_type = "image/webp" if fmt == "webp" else "image/jpeg"
            key = rendition_key(tenant_id, gallery_id, file_id, kind, fmt)
            size_bytes = upload_file(out_path, key, content_type)
            upsert_rendition(
                file_id=file_id, kind=kind, storage_key=key, fmt=fmt,
                width=w, height=h, size_bytes=size_bytes,
            )
            log.info("process_file.rendition_done", file_id=file_id,
                     kind=kind, fmt=fmt, width=w, height=h, size=size_bytes)

        # PSD: libvips cannot decode the format directly. We extract the
        # flattened composite via Pillow as PNG and run the pipeline on
        # that. Every other format passes through unchanged.
        render_src = src_path
        if is_psd(src_path):
            render_src = os.path.join(tmp, "psd_composite.png")
            flatten_psd_to_png(src_path, render_src)
            log.info("process_file.psd_flattened", file_id=file_id)

        final_w, final_h = render_image_sizes(
            src_path=render_src,
            specs=RENDITION_SPECS,
            out_dir=tmp,
            on_rendition=_persist,
        )

        mark_file_ready(file_id, final_w, final_h, sha256=src_sha,
                        original_md5=original_md5, original_size=original_size)
        set_taken_at(file_id, taken_at)
        _publish_status(gallery_id, file_id, "ready",
                        width=final_w, height=final_h)
        log.info("process_file.complete", file_id=file_id,
                 width=final_w, height=final_h, sha256=src_sha,
                 original_md5=original_md5, original_size=original_size)

        # Kick off auto-tagging -- a separate Celery task, asynchronous.
        # The task itself checks the feature flag and skips if it's off.
        # Enqueue errors are tolerated: if Celery/Redis has a problem, the
        # image is still done -- it just lacks tags.
        try:
            app.send_task("tasks.auto_tag.tag_image", args=[file_id])
        except Exception as err:
            log.warning("process_file.auto_tag_enqueue_failed",
                        file_id=file_id, err=str(err))
