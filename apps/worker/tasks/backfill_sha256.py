"""
Lumio Worker — Backfill SHA-256

Für Files die VOR dem SHA-256-on-upload-Sprint hochgeladen wurden,
existiert kein sha256-Eintrag in der DB. Dieser Task laedt das
Original aus S3, streamt den Hash, schreibt ihn zurueck. Wird vom
Studio-UI getriggert ("Duplikate finden" → Scan im Hintergrund).

Strategie:
  - Pro Galerie: alle files mit sha256 IS NULL und status='ready'
    enumerieren und seriell durchrechnen. Seriell statt parallel,
    weil S3-Downloads die Worker-Bandbreite teilen sollen mit
    laufenden Upload-Verarbeitungen — Parallel-Backfill koennte den
    regulaeren Pipeline-Throughput killen.
  - Progress wird in Redis als JSON unter
    'lumio:dup-scan:<galleryId>' geschrieben (TTL 1h), die API
    liest das beim Polling-Endpoint. Felder:
      { total, done, ok, failed, status: 'running'|'done'|'failed' }
  - Idempotent: ein zweiter Run findet die schon-gehashten Files
    via 'sha256 IS NULL' nicht mehr → nur die fehlenden werden
    nachgerechnet.
  - Defensiv: Wenn ein Single-File-Hash failt (z.B. S3-Object weg),
    wird das File markiert und der Rest läuft weiter — kein
    Abbrechen des ganzen Scans.

Aufruf von der API:
  enqueue_task('tasks.backfill_sha256.run_for_gallery', gallery_id=...)
"""
from __future__ import annotations

import json
import os
import tempfile

import structlog

from app import app
from db import get_conn, update_file_sha256
from hashing import sha256_file
from storage import download_to_file


log = structlog.get_logger(__name__)


_REDIS_PROGRESS_PREFIX = "lumio:dup-scan:"
_PROGRESS_TTL_SECONDS = 3600  # 1h


def _redis_client():
    """Lazy redis import — gleicher Pattern wie events.py."""
    import redis as redis_lib  # type: ignore

    url = os.environ.get("REDIS_URL", "redis://redis:6379/0")
    return redis_lib.from_url(url, decode_responses=True)


def _set_progress(gallery_id: str, progress: dict) -> None:
    """Schreibt den Progress-State nach Redis. Stille Failures, weil
    der Worker auch ohne Progress-Tracking seinen Job machen soll."""
    try:
        _redis_client().set(
            _REDIS_PROGRESS_PREFIX + str(gallery_id),
            json.dumps(progress),
            ex=_PROGRESS_TTL_SECONDS,
        )
    except Exception as err:
        log.warn("backfill_sha256.progress_failed",
                 gallery_id=gallery_id, err=str(err))


@app.task(name="tasks.backfill_sha256.run_for_gallery", bind=True)
def run_for_gallery(self, gallery_id: str) -> dict:
    """Berechnet sha256 fuer alle Files einer Galerie, die noch keinen
    Hash haben. Streamt Progress nach Redis."""
    log.info("backfill_sha256.start", gallery_id=gallery_id)

    files = _files_needing_hash(gallery_id=gallery_id)
    total = len(files)
    log.info("backfill_sha256.files_pending", gallery_id=gallery_id,
             count=total)

    _set_progress(gallery_id, {
        "total": total,
        "done": 0,
        "ok": 0,
        "failed": 0,
        "status": "running",
    })

    ok = 0
    failed = 0
    done = 0
    for f in files:
        try:
            _hash_one(f)
            ok += 1
        except Exception as err:
            log.exception("backfill_sha256.file_failed",
                          file_id=f["id"], err=str(err))
            failed += 1
        done += 1
        # Progress alle paar Files updaten, nicht bei jedem Single-File —
        # das spart Redis-Roundtrips bei grossen Galerien. Update bei
        # jedem 10. + immer am Ende.
        if done % 10 == 0 or done == total:
            _set_progress(gallery_id, {
                "total": total,
                "done": done,
                "ok": ok,
                "failed": failed,
                "status": "running",
            })

    _set_progress(gallery_id, {
        "total": total,
        "done": done,
        "ok": ok,
        "failed": failed,
        "status": "done",
    })

    log.info("backfill_sha256.complete",
             gallery_id=gallery_id, ok=ok, failed=failed)
    return {"gallery_id": gallery_id, "ok": ok, "failed": failed,
            "total": total}


def _files_needing_hash(gallery_id: str) -> list[dict]:
    """Alle Files dieser Galerie ohne sha256 und mit status='ready'.
    Failed- und in-progress-Files überspringen wir — bei denen ist
    der Hash entweder nie sinnvoll oder kommt durch die normale
    Pipeline noch."""
    with get_conn() as conn:
        rows = conn.execute(
            'SELECT f.id, f."storageKey" AS storage_key '
            'FROM files f '
            'WHERE f."galleryId" = %s '
            '  AND f.status = %s '
            '  AND f.sha256 IS NULL '
            'ORDER BY f."createdAt"',
            (gallery_id, "ready"),
        ).fetchall()
    return list(rows)


def _hash_one(file_row: dict) -> None:
    """Original aus S3 ziehen, hashen, in DB schreiben.
    TempDir wird durch den with-Block aufgeraeumt."""
    file_id = file_row["id"]
    storage_key = file_row["storage_key"]

    with tempfile.TemporaryDirectory(prefix="lumio_sha_") as tmp:
        src_path = os.path.join(tmp, "source")
        download_to_file(storage_key, src_path)
        digest = sha256_file(src_path)
        update_file_sha256(file_id, digest)
        log.info("backfill_sha256.hashed", file_id=file_id, sha256=digest)
