"""
Lumio Worker — process_pdf

Rendert ein mehrseitiges PDF zu Pro-Seiten-Renditions (thumb/preview/web),
damit es in der Galerie als durchblätterbares Dokument erscheint. Das
Original-PDF bleibt unangetastet in S3 und steht weiter als Download.

Pipeline:
  1. PDF aus S3 laden, SHA-256 vom Original berechnen.
  2. Mit ``pdftoppm`` (poppler-utils) jede Seite als PNG bei ~200 DPI
     rastern (gedeckelt auf MAX_PAGES gegen Missbrauch).
  3. Jede Seiten-PNG durch die normale libvips-Rendition-Pipeline
     schicken → thumb/preview/web, gespeichert mit page-Index.
  4. files.pageCount setzen, Status ready.

Warum pdftoppm statt einer Python-Lib: poppler wird nur als separates
Tool aufgerufen (kein Linking) — lizenz-sauber für ein FSL-Projekt.
Bewusst NICHT PyMuPDF/fitz (AGPL).
"""
from __future__ import annotations

import glob
import os
import re
import subprocess
import tempfile

import structlog

from app import app
from db import (
    fetch_file,
    mark_file_ready,
    mark_file_failed,
    upsert_rendition,
    set_page_count,
    reconcile_original_size,
)
from hashing import sha256_file
from imaging import render_image_sizes
from rt import file_status as _publish_status
from storage import download_to_file, upload_file, rendition_key

log = structlog.get_logger(__name__)

# Auflösung des Zwischen-PNGs. 200 DPI ergibt bei A4 ~1654x2339 px; die
# Rendition-Specs skalieren danach auf max. 2560 px Langkante (kein
# Upscaling). Höhere DPI brächte für eine Web-Vorschau nichts.
RENDER_DPI = 200

# Obergrenze gegen Riesen-PDFs (Storage + CPU). Wer mehr braucht, kann
# das anheben — 100 Seiten decken Alben/Magazine locker ab.
MAX_PAGES = 100

# Pro Seite nur webp (kein zusätzliches web_jpeg wie bei Einzelbildern) —
# bei vielen Seiten würde das den Storage unnötig verdoppeln.
PDF_RENDITION_SPECS: list[tuple[str, int, int, str]] = [
    ("thumb", 400, 75, "webp"),
    ("preview", 1600, 82, "webp"),
    ("web", 2560, 85, "webp"),
]


@app.task(
    name="tasks.process_pdf.generate_pdf_renditions",
    bind=True,
    max_retries=2,
    default_retry_delay=30,
)
def generate_pdf_renditions(self, file_id: str) -> dict:
    log.info("process_pdf.start", file_id=file_id)

    file_row = fetch_file(file_id)
    if not file_row:
        log.warning("process_pdf.file_missing", file_id=file_id)
        return {"file_id": file_id, "status": "missing"}

    try:
        page_count = _process(file_row)
        return {"file_id": file_id, "status": "ready", "pages": page_count}
    except Exception as err:
        log.exception("process_pdf.failed", file_id=file_id, err=str(err))
        try:
            mark_file_failed(file_id, str(err))
            _publish_status(file_row["gallery_id"], file_id, "failed")
        except Exception:
            pass
        raise self.retry(exc=err)


def _render_pages_to_png(src_path: str, out_dir: str) -> list[str]:
    """Rastert alle Seiten via pdftoppm und liefert die PNG-Pfade in
    korrekter Seitenreihenfolge (numerisch, nicht lexikalisch)."""
    prefix = os.path.join(out_dir, "page")
    subprocess.run(
        [
            "pdftoppm", "-png",
            "-r", str(RENDER_DPI),
            "-l", str(MAX_PAGES),
            src_path, prefix,
        ],
        check=True,
        capture_output=True,
        timeout=600,
    )
    # pdftoppm benennt page-1.png … bzw. page-01.png je nach Seitenzahl.
    # Lexikalisch wäre page-10 < page-2 → daher numerisch nach der im
    # Dateinamen kodierten Seitenzahl sortieren.
    files = glob.glob(f"{prefix}-*.png")

    def _num(path: str) -> int:
        m = re.search(r"-(\d+)\.png$", path)
        return int(m.group(1)) if m else 0

    return sorted(files, key=_num)


def _process(file_row: dict) -> int:
    file_id = file_row["id"]
    tenant_id = file_row["tenant_id"]
    gallery_id = file_row["gallery_id"]
    storage_key = file_row["storage_key"]

    with tempfile.TemporaryDirectory(prefix="lumio_pdf_") as tmp:
        src_path = os.path.join(tmp, "source.pdf")
        download_to_file(storage_key, src_path)
        reconcile_original_size(file_id, os.path.getsize(src_path))
        log.info("process_pdf.downloaded", file_id=file_id,
                 size=os.path.getsize(src_path))

        src_sha = sha256_file(src_path)

        pages_dir = os.path.join(tmp, "pages")
        os.makedirs(pages_dir, exist_ok=True)
        page_pngs = _render_pages_to_png(src_path, pages_dir)
        if not page_pngs:
            raise RuntimeError("pdftoppm lieferte keine Seiten")

        log.info("process_pdf.rasterized", file_id=file_id,
                 pages=len(page_pngs))

        first_w, first_h = 0, 0
        for page_idx, page_png in enumerate(page_pngs):
            page_out = os.path.join(tmp, f"out_{page_idx}")
            os.makedirs(page_out, exist_ok=True)

            def _persist(kind, out_path, w, h, fmt, _p=page_idx):
                content_type = "image/webp" if fmt == "webp" else "image/jpeg"
                key = rendition_key(tenant_id, gallery_id, file_id, kind, fmt,
                                    page=_p)
                size_bytes = upload_file(out_path, key, content_type)
                upsert_rendition(
                    file_id=file_id, kind=kind, storage_key=key, fmt=fmt,
                    width=w, height=h, size_bytes=size_bytes, page=_p,
                )

            w, h = render_image_sizes(
                src_path=page_png,
                specs=PDF_RENDITION_SPECS,
                out_dir=page_out,
                on_rendition=_persist,
            )
            if page_idx == 0:
                first_w, first_h = w, h

        page_count = len(page_pngs)
        set_page_count(file_id, page_count)
        # Maße = erste Seite (für Grid-Tile + Seitenverhältnis im Viewer).
        mark_file_ready(file_id, first_w, first_h, sha256=src_sha)
        _publish_status(gallery_id, file_id, "ready",
                        width=first_w, height=first_h)
        log.info("process_pdf.complete", file_id=file_id,
                 pages=page_count, sha256=src_sha)
        return page_count
