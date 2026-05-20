"""
Lumio Worker — process_raw

RAW-Verarbeitung für CR2, CR3, NEF, ARW, RAF, DNG, ORF, PEF, RW2, X3F, ...

Strategie (Geschwindigkeit > absolute Qualität):
  1. Wenn das RAW ein eingebettetes JPEG-Preview enthält (>99% der Fälle bei
     modernen Kameras): das verwenden — sieht aus wie auf dem Kamera-Display
     und ist in <100 ms verfügbar.
  2. Wenn das Preview ein BITMAP ist (selten): zu JPEG kodieren.
  3. Fallback: voll demosaicen via rawpy.postprocess (sekundenlang) mit
     use_camera_wb=True für brauchbare Kamera-WB.

Aus dem Preview-JPEG werden dann mit libvips die finalen Renditions
(thumb/preview/web) abgeleitet — exakt der gleiche Code wie für Standard-
Bilder, gerufen über _generate_renditions_from_path.
"""
from __future__ import annotations

import os
import tempfile

import structlog

from app import app
from db import fetch_file, mark_file_ready, mark_file_failed, upsert_rendition
from rt import file_status as _publish_status
from storage import download_to_file, upload_file, rendition_key


log = structlog.get_logger(__name__)


# Identisch zu process_file (Quelle der Wahrheit ist process_file). Wir
# halten die Konstante hier separat, damit RAW-Verarbeitung unabhängig
# weiter entwickelt werden kann (z.B. niedrigere Qualität fürs Thumb).
RENDITION_SPECS: list[tuple[str, int, int]] = [
    ("thumb", 400, 75),
    ("preview", 1600, 82),
    ("web", 2560, 85),
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
    """Decodiert RAW → JPEG-Preview → drei Renditions wie bei process_file."""
    import rawpy
    import imageio.v3 as iio

    file_id = file_row["id"]
    tenant_id = file_row["tenant_id"]
    gallery_id = file_row["gallery_id"]
    storage_key = file_row["storage_key"]

    with tempfile.TemporaryDirectory(prefix="lumio_raw_") as tmp:
        src_path = os.path.join(tmp, "source.raw")
        download_to_file(storage_key, src_path)
        log.info("process_raw.downloaded",
                 file_id=file_id, size=os.path.getsize(src_path))

        preview_jpeg_path = os.path.join(tmp, "preview.jpg")
        method = _extract_or_demosaic(src_path, preview_jpeg_path)
        log.info("process_raw.decoded", file_id=file_id, method=method)

        # Aus dem Preview die Renditions ableiten — identische Pipeline
        # wie process_file, nur dass die Quelle bereits ein JPEG ist.
        from imaging import render_webp_sizes

        def _persist(kind: str, out_path: str, w: int, h: int) -> None:
            key = rendition_key(tenant_id, gallery_id, file_id, kind, "webp")
            size_bytes = upload_file(out_path, key, "image/webp")
            upsert_rendition(
                file_id=file_id, kind=kind, storage_key=key, fmt="webp",
                width=w, height=h, size_bytes=size_bytes,
            )
            log.info("process_raw.rendition_done", file_id=file_id,
                     kind=kind, width=w, height=h, size=size_bytes)

        src_w, src_h = render_webp_sizes(
            src_path=preview_jpeg_path, specs=RENDITION_SPECS,
            out_dir=tmp, on_rendition=_persist,
        )

        # width/height des Originals — beim eingebetteten Preview ist das
        # nicht zwingend die echte Sensor-Größe. Wir nutzen aus rawpy die
        # tatsächlichen Sensor-Dimensionen.
        orig_w, orig_h = _read_sensor_size(src_path)
        final_w = orig_w or src_w
        final_h = orig_h or src_h
        mark_file_ready(file_id, final_w, final_h)
        _publish_status(gallery_id, file_id, "ready",
                        width=final_w, height=final_h)
        log.info("process_raw.complete",
                 file_id=file_id, width=final_w, height=final_h)


def _extract_or_demosaic(src_path: str, out_jpeg: str) -> str:
    """Schreibt entweder das eingebettete Preview oder ein demosaictes
    Vollbild als JPEG nach `out_jpeg`. Gibt die verwendete Methode zurück
    ("embedded_jpeg", "embedded_bitmap", "demosaic")."""
    import rawpy
    import imageio.v3 as iio

    with rawpy.imread(src_path) as raw:
        # 1. Eingebettetes Preview versuchen
        try:
            thumb = raw.extract_thumb()
            if thumb.format == rawpy.ThumbFormat.JPEG:
                with open(out_jpeg, "wb") as f:
                    f.write(thumb.data)
                return "embedded_jpeg"
            elif thumb.format == rawpy.ThumbFormat.BITMAP:
                # ndarray → JPEG via imageio
                iio.imwrite(out_jpeg, thumb.data, extension=".jpg", quality=92)
                return "embedded_bitmap"
        except rawpy.LibRawNoThumbnailError:
            log.info("process_raw.no_embedded_thumb")
        except rawpy.LibRawUnsupportedThumbnailError:
            log.info("process_raw.unsupported_embedded_thumb")
        except Exception as err:
            # Defensiv — manche Builds werfen andere Exceptions
            log.warning("process_raw.thumb_extract_failed", err=str(err))

        # 2. Voll demosaicen — langsam, aber zuverlässig
        rgb = raw.postprocess(
            use_camera_wb=True,
            no_auto_bright=False,
            output_bps=8,
        )
        iio.imwrite(out_jpeg, rgb, extension=".jpg", quality=92)
        return "demosaic"


def _read_sensor_size(src_path: str) -> tuple[int | None, int | None]:
    """Liest die echten Sensor-Dimensionen aus dem RAW. Robust gegen Fehler."""
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
