"""
Lumio Worker — process_raw

RAW-Verarbeitung für CR2, CR3, NEF, ARW, RAF, DNG, ORF, PEF, RW2, X3F, ...

Strategie (Geschwindigkeit > absolute Qualität):
  1. Wenn das RAW ein eingebettetes JPEG-Preview enthält (>99% der Fälle bei
     modernen Kameras): das verwenden — sieht aus wie auf dem Kamera-Display
     und ist in <100 ms verfügbar.
  2. Fallback: voll demosaicen via rawpy.postprocess (sekundenlang).

Aus dem Preview-JPEG werden dann mit libvips die finalen Renditions abgeleitet
(thumb/preview/web).
"""
from __future__ import annotations

import os
import tempfile

import structlog
from app import app

log = structlog.get_logger(__name__)


@app.task(name="tasks.process_raw.generate_preview", bind=True, max_retries=2)
def generate_raw_preview(self, file_id: str) -> dict:
    """Decodiert ein RAW-File zu einem JPEG-Preview, das dann wie ein normales
    Bild weiterverarbeitet wird.
    """
    log.info("process_raw.start", file_id=file_id)

    # TODO:
    #   import rawpy, imageio.v3 as iio
    #   from storage import download_to_tempfile, upload_file
    #
    #   src = download_to_tempfile(file_row.storage_key, ...)
    #   with rawpy.imread(src) as raw:
    #       try:
    #           thumb = raw.extract_thumb()
    #           if thumb.format == rawpy.ThumbFormat.JPEG:
    #               preview_bytes = thumb.data
    #           else:
    #               preview_bytes = encode_jpeg(thumb.data)
    #       except rawpy.LibRawNoThumbnailError:
    #           # Fallback: voll demosaicen
    #           rgb = raw.postprocess(use_camera_wb=True, no_auto_bright=False,
    #                                  output_bps=8)
    #           preview_bytes = encode_jpeg(rgb, quality=92)
    #
    #   # Preview als neues "input" für die Standard-Pipeline ablegen
    #   preview_key = f"previews/{file_id}/raw_preview.jpg"
    #   upload_bytes(preview_bytes, preview_key, "image/jpeg")
    #
    #   # Standard-Rendition-Task triggern, der dann von preview_key weiter macht
    #   from tasks.process_file import generate_renditions
    #   generate_renditions.delay(file_id, source_key=preview_key)

    return {"file_id": file_id, "status": "stub"}
