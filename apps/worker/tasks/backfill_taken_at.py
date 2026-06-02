"""
Lumio Worker — Backfill takenAt (Aufnahmezeitpunkt aus EXIF)

Hintergrund: Das Feld files.takenAt (Aufnahmezeitpunkt aus EXIF) wird
seit dem Feature "Kundengalerie-Sortierung nach Aufnahmedatum" beim
Verarbeiten neuer Uploads automatisch befüllt (siehe process_file /
process_raw). Für Bilder/RAWs, die VORHER hochgeladen wurden, ist
takenAt NULL — sie würden beim Sortieren nach Aufnahmedatum ans Ende
rutschen.

Dieser Task liest die EXIF-Daten der Originale nach und füllt takenAt.
Wir laden dafür das Original herunter (EXIF steckt im Header; ein
partieller Download wäre möglich, lohnt die Komplexität aber nicht für
einen einmaligen Operator-Lauf). Daher in Batches über `limit`
verteilen statt alles auf einmal.

Aufruf global für alle Tenants (Default-Batch 500):

    docker compose exec worker celery -A app call \\
        tasks.backfill_taken_at.run_global

    # größerer Batch:
    docker compose exec worker celery -A app call \\
        tasks.backfill_taken_at.run_global --args='[2000]'

Oder pro Galerie:

    docker compose exec worker celery -A app call \\
        tasks.backfill_taken_at.run_for_gallery --args='["<galleryId>"]'

Idempotent: es werden nur Files mit takenAt IS NULL betrachtet, und
set_taken_at überschreibt nichts mit NULL. Mehrfach startbar — Files
ohne EXIF-Datum bleiben einfach NULL und werden bei jedem Lauf erneut
(erfolglos, aber harmlos) geprüft.
"""
from __future__ import annotations

import os
import tempfile

import structlog

from app import app
from db import get_conn, set_taken_at
from exif_meta import extract_taken_at
from storage import download_to_file

log = structlog.get_logger(__name__)

# Nur diese Kinds tragen EXIF mit Aufnahmedatum. Videos/PDFs/other
# lassen wir aus.
_KINDS = ("image", "raw")


@app.task(name="tasks.backfill_taken_at.run_for_gallery", bind=True)
def run_for_gallery(self, gallery_id: str) -> dict:
    """Backfill takenAt für alle EXIF-tragenden Files einer Galerie."""
    log.info("backfill_taken_at.gallery_start", gallery_id=gallery_id)
    files = _files_needing_backfill(gallery_id=gallery_id)
    return _run(files)


@app.task(name="tasks.backfill_taken_at.run_global", bind=True)
def run_global(self, limit: int = 500) -> dict:
    """Globaler Backfill — bis zu `limit` Files galerieübergreifend."""
    log.info("backfill_taken_at.global_start", limit=limit)
    files = _files_needing_backfill_global(limit=limit)
    return _run(files)


def _run(files: list[dict]) -> dict:
    log.info("backfill_taken_at.files_pending", count=len(files))
    ok = 0
    no_exif = 0
    failed = 0
    for f in files:
        try:
            taken = _backfill_one(f)
            if taken is None:
                no_exif += 1
            else:
                ok += 1
        except Exception as err:
            log.warning("backfill_taken_at.file_failed",
                        file_id=f["id"], err=str(err))
            failed += 1
    result = {
        "ok": ok,
        "no_exif": no_exif,
        "failed": failed,
        "total": len(files),
    }
    log.info("backfill_taken_at.complete", **result)
    return result


def _backfill_one(f: dict):
    """Lädt das Original, liest takenAt, schreibt es (falls vorhanden).
    Gibt den datetime oder None zurück."""
    file_id = f["id"]
    storage_key = f["storageKey"]
    with tempfile.TemporaryDirectory(prefix="lumio-exif-bf-") as td:
        src_path = os.path.join(td, "source")
        download_to_file(storage_key, src_path)
        taken_at = extract_taken_at(src_path)
        set_taken_at(file_id, taken_at)
    return taken_at


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _files_needing_backfill(*, gallery_id: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            'SELECT f.id, f."storageKey" '
            'FROM files f '
            'WHERE f."galleryId" = %s AND f.status = %s '
            '  AND f.kind = ANY(%s) AND f."takenAt" IS NULL '
            'ORDER BY f."createdAt"',
            (gallery_id, "ready", list(_KINDS)),
        ).fetchall()
    return list(rows)


def _files_needing_backfill_global(*, limit: int) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            'SELECT f.id, f."storageKey" '
            'FROM files f '
            'WHERE f.status = %s AND f.kind = ANY(%s) '
            '  AND f."takenAt" IS NULL '
            'ORDER BY f."createdAt" '
            'LIMIT %s',
            ("ready", list(_KINDS), limit),
        ).fetchall()
    return list(rows)
