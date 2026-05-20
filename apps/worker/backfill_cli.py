#!/usr/bin/env python3
"""
Lumio Worker — Backfill CLI

Generiert nachträglich web_jpeg-Renditions für bestehende Files. Läuft
synchron (kein Celery-Queue-Detour), damit der Operator sofort sieht
wann es durch ist und ob's Fehler gab.

Aufruf:

    # Alle Galerien aller Tenants:
    docker compose exec worker python -m backfill_cli all

    # Nur ein Tenant:
    docker compose exec worker python -m backfill_cli tenant <tenantId>

    # Nur eine Galerie:
    docker compose exec worker python -m backfill_cli gallery <galleryId>

Idempotent: Files, die bereits eine web_jpeg-Rendition haben, werden
übersprungen.
"""
from __future__ import annotations

import sys

from db import get_conn


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] not in {"all", "tenant", "gallery"}:
        print(__doc__, file=sys.stderr)
        return 2

    # Import erst hier, damit das --help / Usage schnell ist und nicht
    # die ganze Worker-Welt mit-initialisiert.
    from tasks.backfill_web_jpeg import run_for_gallery

    mode = sys.argv[1]
    if mode == "gallery":
        if len(sys.argv) < 3:
            print("usage: backfill_cli gallery <galleryId>", file=sys.stderr)
            return 2
        gallery_id = sys.argv[2]
        res = run_for_gallery(gallery_id)
        print(f"done: {res}")
        return 0

    if mode == "tenant":
        if len(sys.argv) < 3:
            print("usage: backfill_cli tenant <tenantId>", file=sys.stderr)
            return 2
        tenant_id = sys.argv[2]
        with get_conn() as conn:
            rows = conn.execute(
                'SELECT id, title FROM galleries WHERE "tenantId" = %s '
                'ORDER BY "createdAt"',
                (tenant_id,),
            ).fetchall()
        return _process_galleries(rows, run_for_gallery)

    # mode == "all"
    with get_conn() as conn:
        rows = conn.execute(
            'SELECT id, title FROM galleries ORDER BY "tenantId", "createdAt"'
        ).fetchall()
    return _process_galleries(rows, run_for_gallery)


def _process_galleries(rows: list, fn) -> int:
    totals = {"ok": 0, "skipped": 0, "failed": 0}
    for i, row in enumerate(rows, 1):
        print(f"[{i}/{len(rows)}] {row['title']!r} ({row['id']}) ...",
              flush=True)
        try:
            res = fn(row["id"])
            totals["ok"] += res["ok"]
            totals["skipped"] += res["skipped"]
            totals["failed"] += res["failed"]
            print(f"  → ok={res['ok']} skipped={res['skipped']} "
                  f"failed={res['failed']}", flush=True)
        except Exception as err:
            print(f"  FAILED: {err}", flush=True)
            totals["failed"] += 1
    print(f"\ntotals: {totals}")
    return 0 if totals["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
