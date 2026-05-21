"""
Lumio Worker — Backfill video_mp4 renditions

Hintergrund: ab Sprint "Web-MP4 als Customer-Download" generiert die
Video-Pipeline neben HLS auch eine standalone-MP4 (kind='video_mp4',
1080p oder Quellauflösung). Diese wird als "Web-Version" zum Download
angeboten — eine kompakte, sofort abspielbare Datei.

Für Videos, die VOR diesem Sprint hochgeladen wurden, existiert
video_mp4 nicht. Im Customer-Download liefert die API dann einen
404, und der ZIP-Builder filtert das Video aus dem Web-ZIP. Das ist
korrekt, aber für den Kunden ärgerlich.

Dieser Task generiert die fehlende video_mp4-Rendition aus dem
Original-Video. Anders als beim web_jpeg-Backfill (der eine billige
Re-Encodierung von webp zu jpg machen kann) müssen wir hier das
Original durch ffmpeg jagen — das ist GPU/CPU-intensiv und kann pro
Video Minuten dauern. Wir verteilen die Last über die Celery-Queue,
nicht in einem Burst.

Aufruf manuell pro Galerie:

    docker compose exec worker celery -A app call \\
        tasks.backfill_video_mp4.run_for_gallery \\
        --args='["<galleryId>"]'

Oder global für alle Tenants:

    docker compose exec worker celery -A app call \\
        tasks.backfill_video_mp4.run_global

Idempotent: prüft pro File, ob video_mp4 schon existiert, und
überspringt es. Lässt sich problemlos neu starten.
"""
from __future__ import annotations

import tempfile
from pathlib import Path

import structlog

from app import app
from db import get_conn, upsert_rendition
from storage import download_to_file, upload_file, rendition_key

log = structlog.get_logger(__name__)


@app.task(name="tasks.backfill_video_mp4.run_for_gallery", bind=True)
def run_for_gallery(self, gallery_id: str) -> dict:
    """Generiert fehlende video_mp4-Renditions für eine Galerie."""
    log.info("backfill_video_mp4.start", gallery_id=gallery_id)

    files = _files_needing_backfill(gallery_id=gallery_id)
    log.info("backfill_video_mp4.files_pending",
             gallery_id=gallery_id, count=len(files))

    ok = 0
    skipped = 0
    failed = 0
    for f in files:
        try:
            if _file_already_has_video_mp4(f["id"]):
                skipped += 1
                continue
            _backfill_one(f)
            ok += 1
        except Exception as err:
            log.warning("backfill_video_mp4.file_failed",
                        file_id=f["id"], err=str(err))
            failed += 1

    result = {
        "gallery_id": gallery_id,
        "ok": ok,
        "skipped": skipped,
        "failed": failed,
        "total": len(files),
    }
    log.info("backfill_video_mp4.complete", **result)
    return result


@app.task(name="tasks.backfill_video_mp4.run_global", bind=True)
def run_global(self, limit: int = 100) -> dict:
    """Globaler Backfill — verarbeitet bis zu `limit` Videos
    galerie-übergreifend. Sinnvoller initialer Default: klein
    starten (100) um Auslastung zu beobachten, dann größere Batches
    wenn der Worker das verträgt."""
    log.info("backfill_video_mp4.global_start", limit=limit)

    files = _files_needing_backfill_global(limit=limit)
    log.info("backfill_video_mp4.global_files_pending",
             count=len(files))

    ok = 0
    skipped = 0
    failed = 0
    for f in files:
        try:
            if _file_already_has_video_mp4(f["id"]):
                skipped += 1
                continue
            _backfill_one(f)
            ok += 1
        except Exception as err:
            log.warning("backfill_video_mp4.file_failed",
                        file_id=f["id"], err=str(err))
            failed += 1

    result = {
        "ok": ok,
        "skipped": skipped,
        "failed": failed,
        "total": len(files),
    }
    log.info("backfill_video_mp4.global_complete", **result)
    return result


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _files_needing_backfill(*, gallery_id: str) -> list[dict]:
    """Liste der Video-Files in der Galerie ohne video_mp4-Rendition."""
    with get_conn() as conn:
        rows = conn.execute(
            'SELECT f.id, f."tenantId", f."galleryId", '
            '       f."storageKey", f."originalFilename" '
            'FROM files f '
            'WHERE f."galleryId" = %s AND f.kind = %s AND f.status = %s '
            '  AND NOT EXISTS ( '
            '    SELECT 1 FROM renditions r '
            '    WHERE r."fileId" = f.id AND r.kind = %s '
            '  ) '
            'ORDER BY f."createdAt"',
            (gallery_id, "video", "ready", "video_mp4"),
        ).fetchall()
    return list(rows)


def _files_needing_backfill_global(*, limit: int) -> list[dict]:
    """Wie _files_needing_backfill, aber tenant-übergreifend mit Limit."""
    with get_conn() as conn:
        rows = conn.execute(
            'SELECT f.id, f."tenantId", f."galleryId", '
            '       f."storageKey", f."originalFilename" '
            'FROM files f '
            'WHERE f.kind = %s AND f.status = %s '
            '  AND NOT EXISTS ( '
            '    SELECT 1 FROM renditions r '
            '    WHERE r."fileId" = f.id AND r.kind = %s '
            '  ) '
            'ORDER BY f."createdAt" '
            'LIMIT %s',
            ("video", "ready", "video_mp4", limit),
        ).fetchall()
    return list(rows)


def _file_already_has_video_mp4(file_id: str) -> bool:
    """Re-Check unmittelbar vor dem Backfill — schützt vor doppelter
    Arbeit wenn der Task parallel oder zweimal läuft."""
    with get_conn() as conn:
        row = conn.execute(
            'SELECT 1 FROM renditions '
            'WHERE "fileId" = %s AND kind = %s LIMIT 1',
            (file_id, "video_mp4"),
        ).fetchone()
    return row is not None


def _backfill_one(f: dict) -> None:
    """Lädt das Original herunter, probet die Höhe, ruft die gemeinsame
    Web-MP4-Funktion aus process_video auf, lädt das Ergebnis hoch."""
    # Late import: vermeidet zirkuläre Import-Probleme zur Modul-
    # Initialisierungs-Zeit. Außerdem braucht der Backfill nur _make_web_mp4
    # und _probe — kein Grund das gesamte process_video-Modul beim
    # Start des Workers zu laden.
    from tasks.process_video import _make_web_mp4, _probe

    file_id = f["id"]
    tenant_id = f["tenantId"]
    gallery_id = f["galleryId"]
    storage_key = f["storageKey"]

    log.info("backfill_video_mp4.file_start", file_id=file_id)

    with tempfile.TemporaryDirectory(prefix="lumio-mp4-bf-") as td:
        tmpdir = Path(td)
        src = tmpdir / "src"
        download_to_file(storage_key, str(src))

        probe = _probe(src)
        height = int(probe.get("height", 0))
        has_audio = bool(probe.get("has_audio", False))
        target_h = min(1080, height) if height > 0 else 1080

        out = tmpdir / "web.mp4"
        _make_web_mp4(
            src_path=src, out_path=out,
            target_height=target_h, has_audio=has_audio,
        )

        mp4_key = rendition_key(
            tenant_id, gallery_id, file_id, "video_mp4", "mp4"
        )
        mp4_size = upload_file(str(out), mp4_key, "video/mp4")
        upsert_rendition(
            file_id=file_id, kind="video_mp4",
            storage_key=mp4_key, fmt="mp4",
            width=0, height=target_h,
            size_bytes=mp4_size,
        )

    log.info("backfill_video_mp4.file_complete", file_id=file_id)
