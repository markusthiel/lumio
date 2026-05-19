"""
Lumio Worker — process_file

Standard-Bildverarbeitung für JPEG, PNG, WebP, AVIF, TIFF, GIF, HEIC, PSD.

Generiert drei Renditions pro Bild:
  - thumb        ( 400 px lange Kante, WebP, q75)
  - preview      (1600 px lange Kante, WebP, q82)
  - web          (2560 px lange Kante, WebP, q85)

Engine: libvips via pyvips. ~4–8x schneller als Pillow/ImageMagick und
geringer Speicherbedarf, weil sequenziell verarbeitet wird.

Aufruf (von Celery via app.send_task oder direkt):
  generate_renditions.delay(file_id)
"""
from __future__ import annotations

import os
import tempfile

import structlog

from app import app
from db import fetch_file, mark_file_ready, mark_file_failed, upsert_rendition
from storage import (
    download_to_file,
    upload_file,
    rendition_key,
)

log = structlog.get_logger(__name__)


# (kind, max_long_edge, quality)
RENDITION_SPECS: list[tuple[str, int, int]] = [
    ("thumb", 400, 75),
    ("preview", 1600, 82),
    ("web", 2560, 85),
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
        except Exception:
            pass
        # Retry, falls noch Versuche übrig
        raise self.retry(exc=err)


def _process(file_row: dict) -> None:
    """Lädt das Original, generiert die Renditions, schreibt sie nach S3
    und in die DB."""
    # Pyvips wird erst beim Task-Aufruf importiert — damit kann der
    # Worker-Container im CI auch ohne libvips geladen werden.
    import pyvips  # type: ignore

    file_id = file_row["id"]
    tenant_id = file_row["tenant_id"]
    gallery_id = file_row["gallery_id"]
    storage_key = file_row["storage_key"]

    with tempfile.TemporaryDirectory(prefix="lumio_") as tmp:
        src_path = os.path.join(tmp, "source")
        download_to_file(storage_key, src_path)
        log.info("process_file.downloaded", file_id=file_id,
                 size=os.path.getsize(src_path))

        # Dimensions einmal mit sequential-access ermitteln (billig, keine
        # Pixel-Operationen). Wir brauchen die für die scale-Berechnung der
        # Renditions und für den File-Record.
        probe = pyvips.Image.new_from_file(src_path, access="sequential")
        probe = probe.autorot()
        src_w = probe.width
        src_h = probe.height
        long_edge = max(src_w, src_h)
        final_w, final_h = src_w, src_h
        del probe  # libvips-handle freigeben

        for kind, max_edge, quality in RENDITION_SPECS:
            scale = min(1.0, max_edge / long_edge) if long_edge > 0 else 1.0
            out_path = os.path.join(tmp, f"{kind}.webp")

            # Wichtig: für jede Rendition ein FRISCHES Image-Handle. JPEG ist
            # single-pass, libvips mit access="sequential" kann nicht mehrfach
            # durchgelesen werden — der zweite resize() crasht mit
            # "VipsJpeg: out of order read". Wir laden also pro Rendition neu.
            # JPEG-Decode ist günstig genug; bei 3 Renditions zahlen wir den
            # Decode-Aufwand 3x, dafür ist der Code robust.
            img = pyvips.Image.new_from_file(src_path, access="sequential")
            img = img.autorot()

            if scale < 1.0:
                resized = img.resize(scale)
            else:
                resized = img

            # WebP-Output mit voreingestellter Qualität.
            resized.write_to_file(
                f"{out_path}[Q={quality},effort=4,strip=true]"
            )

            key = rendition_key(
                tenant_id, gallery_id, file_id, kind, "webp"
            )
            size_bytes = upload_file(out_path, key, "image/webp")

            upsert_rendition(
                file_id=file_id,
                kind=kind,
                storage_key=key,
                fmt="webp",
                width=resized.width,
                height=resized.height,
                size_bytes=size_bytes,
            )
            log.info("process_file.rendition_done",
                     file_id=file_id, kind=kind,
                     width=resized.width, height=resized.height,
                     size=size_bytes)

        mark_file_ready(file_id, final_w, final_h)
        log.info("process_file.complete", file_id=file_id,
                 width=final_w, height=final_h)
