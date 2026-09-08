"""
Lumio Worker — process_raw

RAW processing for CR2, CR3, NEF, ARW, RAF, DNG, ORF, PEF, RW2, X3F, ...

Strategy (speed > absolute quality):
  1. If the RAW contains an embedded JPEG preview (>99% of cases on
     modern cameras): use it -- looks like the camera's display and is
     available in <100 ms.
  2. If the preview is a BITMAP (rare): encode it to JPEG.
  3. Fallback: full demosaic via rawpy.postprocess (takes seconds) with
     use_camera_wb=True for a usable camera white balance.

The final renditions (thumb/preview/web) are then derived from the
preview JPEG with libvips -- the exact same code as for standard images,
invoked via _generate_renditions_from_path.
"""
from __future__ import annotations

import os
import tempfile

import structlog

from app import app
from db import fetch_file, mark_file_ready, mark_file_failed, upsert_rendition, set_taken_at, reconcile_original_size
from exif_meta import extract_metadata
from hashing import sha256_file
from rt import file_status as _publish_status
from storage import download_to_file, upload_file, rendition_key


log = structlog.get_logger(__name__)


# Identical to process_file (process_file is the source of truth). We
# keep the constant separate here so RAW processing can evolve
# independently (e.g. lower quality for the thumb).
# web_jpeg: customer-friendly download variant, see process_file.
RENDITION_SPECS: list[tuple[str, int, int, str]] = [
    ("thumb", 400, 75, "webp"),
    ("preview", 1600, 82, "webp"),
    ("web", 2560, 85, "webp"),
    ("web_jpeg", 2560, 88, "jpg"),
]


@app.task(
    name="tasks.process_raw.generate_raw_preview",
    bind=True,
    max_retries=2,
    default_retry_delay=60,
)
def generate_raw_preview(self, file_id: str) -> dict:
    log.info("process_raw.start", file_id=file_id)

    file_row = fetch_file(file_id)
    if not file_row:
        log.warning("process_raw.file_missing", file_id=file_id)
        return {"file_id": file_id, "status": "missing"}

    try:
        _process(file_row)
        return {"file_id": file_id, "status": "ready"}
    except Exception as err:
        log.exception("process_raw.failed", file_id=file_id, err=str(err))
        try:
            mark_file_failed(file_id, str(err))
            _publish_status(file_row["gallery_id"], file_id, "failed")
        except Exception:
            pass
        raise self.retry(exc=err)


def _process(file_row: dict) -> None:
    """Decodes RAW -> JPEG preview -> three renditions, same as process_file."""
    import rawpy
    import imageio.v3 as iio

    file_id = file_row["id"]
    tenant_id = file_row["tenant_id"]
    gallery_id = file_row["gallery_id"]
    storage_key = file_row["storage_key"]

    with tempfile.TemporaryDirectory(prefix="lumio_raw_") as tmp:
        src_path = os.path.join(tmp, "source.raw")
        download_to_file(storage_key, src_path)
        reconcile_original_size(file_id, os.path.getsize(src_path))
        log.info("process_raw.downloaded",
                 file_id=file_id, size=os.path.getsize(src_path))

        # SHA-256 of the RAW original -- before the decode pipeline
        # starts, so a decode error doesn't prevent the hash.
        src_sha = sha256_file(src_path)

        # Read capture timestamp + original hash/size from the RAW
        # original's EXIF (best-effort). exiftool reads most RAW
        # containers; unsupported ones -> None. original_md5/
        # original_size are practically always None here: the Lightroom
        # plug-in only ever publishes JPEG renders (never the RAW
        # itself), so a directly uploaded RAW never carries the embedded
        # tag -- extraction stays in anyway, so process_file/process_raw
        # remain symmetric.
        taken_at, original_md5, original_size = extract_metadata(src_path)

        preview_jpeg_path = os.path.join(tmp, "preview.jpg")
        method = _extract_or_demosaic(src_path, preview_jpeg_path)
        log.info("process_raw.decoded", file_id=file_id, method=method)

        # Derive the renditions from the preview -- identical pipeline to
        # process_file, except the source is already a JPEG.
        from imaging import render_image_sizes

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
            log.info("process_raw.rendition_done", file_id=file_id,
                     kind=kind, fmt=fmt, width=w, height=h, size=size_bytes)

        src_w, src_h = render_image_sizes(
            src_path=preview_jpeg_path, specs=RENDITION_SPECS,
            out_dir=tmp, on_rendition=_persist,
        )

        # Width/height of the original -- for the embedded preview that's
        # not necessarily the real sensor size. We use rawpy for the
        # actual sensor dimensions.
        orig_w, orig_h = _read_sensor_size(src_path)
        final_w = orig_w or src_w
        final_h = orig_h or src_h
        mark_file_ready(file_id, final_w, final_h, sha256=src_sha,
                        original_md5=original_md5, original_size=original_size)
        set_taken_at(file_id, taken_at)
        _publish_status(gallery_id, file_id, "ready",
                        width=final_w, height=final_h)
        log.info("process_raw.complete",
                 file_id=file_id, width=final_w, height=final_h,
                 sha256=src_sha, original_md5=original_md5, original_size=original_size)
        # Kick off auto-tagging -- same as process_file. The task itself
        # decides via the feature flag whether it does anything.
        try:
            app.send_task("tasks.auto_tag.tag_image", args=[file_id])
        except Exception as err:
            log.warning("process_raw.auto_tag_enqueue_failed",
                        file_id=file_id, err=str(err))


def _extract_or_demosaic(src_path: str, out_jpeg: str) -> str:
    """Writes either the embedded preview or a demosaiced full image as
    JPEG to `out_jpeg`. Returns the method used ("embedded_jpeg",
    "embedded_bitmap", "demosaic")."""
    import rawpy
    import imageio.v3 as iio

    with rawpy.imread(src_path) as raw:
        # 1. Try the embedded preview
        try:
            thumb = raw.extract_thumb()
            if thumb.format == rawpy.ThumbFormat.JPEG:
                with open(out_jpeg, "wb") as f:
                    f.write(thumb.data)
                return "embedded_jpeg"
            elif thumb.format == rawpy.ThumbFormat.BITMAP:
                # ndarray -> JPEG via imageio
                iio.imwrite(out_jpeg, thumb.data, extension=".jpg", quality=92)
                return "embedded_bitmap"
        except rawpy.LibRawNoThumbnailError:
            log.info("process_raw.no_embedded_thumb")
        except rawpy.LibRawUnsupportedThumbnailError:
            log.info("process_raw.unsupported_embedded_thumb")
        except Exception as err:
            # Defensive -- some builds throw other exceptions
            log.warning("process_raw.thumb_extract_failed", err=str(err))

        # 2. Full demosaic -- slow, but reliable
        rgb = raw.postprocess(
            use_camera_wb=True,
            no_auto_bright=False,
            output_bps=8,
        )
        iio.imwrite(out_jpeg, rgb, extension=".jpg", quality=92)
        return "demosaic"


def _read_sensor_size(src_path: str) -> tuple[int | None, int | None]:
    """Reads the real sensor dimensions from the RAW. Robust against errors."""
    import rawpy
    try:
        with rawpy.imread(src_path) as raw:
            sizes = raw.sizes
            return (
                int(sizes.width or 0) or None,
                int(sizes.height or 0) or None,
            )
    except Exception:
        return (None, None)
