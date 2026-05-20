"""
Lumio Worker — Backfill web_jpeg renditions

Hintergrund: ab Sprint "Customer Web Downloads als JPEG" generiert die
Processing-Pipeline pro File zusätzlich zu web.webp auch web_jpeg.jpg
— eine kunden-freundliche JPEG-Variante in 2560px Long-Edge, 88%
Quality.

Für Files, die VOR diesem Sprint hochgeladen wurden, existiert
web_jpeg nicht. Der ZIP-Builder hat zwar einen Fallback auf web.webp,
aber Kunden bekommen damit weiter webp ausgeliefert — und genau das
war ja der Grund für den Sprint.

Dieser Task generiert die fehlende web_jpeg-Rendition aus der
existierenden web.webp. Das ist deutlich billiger als ein komplettes
Re-Processing: nur ein webp-Decode + ein JPEG-Encode, kein
Original-Download, keine drei Resize-Operationen.

Aufruf manuell pro Galerie (oder global) via:

    docker compose exec worker celery -A app call \\
        tasks.backfill_web_jpeg.run_for_gallery \\
        --args='["<galleryId>"]'

oder per docker compose run --rm worker python -c ...

Idempotent: prüft pro File, ob web_jpeg schon existiert, und
überspringt es. Lässt sich problemlos neu starten.
"""
from __future__ import annotations

import os
import tempfile

import structlog

from app import app
from db import get_conn, upsert_rendition
from imaging import render_image_sizes
from storage import download_to_file, upload_file, rendition_key

log = structlog.get_logger(__name__)


@app.task(name="tasks.backfill_web_jpeg.run_for_gallery", bind=True)
def run_for_gallery(self, gallery_id: str) -> dict:
    """Generiert fehlende web_jpeg-Renditions für eine Galerie."""
    log.info("backfill.start", gallery_id=gallery_id)

    files = _files_needing_backfill(gallery_id=gallery_id)
    log.info("backfill.files_pending", gallery_id=gallery_id,
             count=len(files))

    ok = 0
    skipped = 0
    failed = 0
    for f in files:
        try:
            if _file_already_has_web_jpeg(f["id"]):
                skipped += 1
                continue
            _backfill_one(f)
            ok += 1
        except Exception as err:
            log.exception("backfill.file_failed",
                          file_id=f["id"], err=str(err))
            failed += 1

    log.info("backfill.complete",
             gallery_id=gallery_id, ok=ok, skipped=skipped, failed=failed)
    return {"gallery_id": gallery_id, "ok": ok,
            "skipped": skipped, "failed": failed}


@app.task(name="tasks.backfill_web_jpeg.run_for_tenant", bind=True)
def run_for_tenant(self, tenant_id: str) -> dict:
    """Wie run_for_gallery, aber für alle Galerien eines Tenants."""
    log.info("backfill.tenant_start", tenant_id=tenant_id)
    with get_conn() as conn:
        rows = conn.execute(
            'SELECT id FROM galleries WHERE "tenantId" = %s',
            (tenant_id,),
        ).fetchall()
    totals = {"ok": 0, "skipped": 0, "failed": 0}
    for row in rows:
        res = run_for_gallery(row["id"])
        totals["ok"] += res["ok"]
        totals["skipped"] += res["skipped"]
        totals["failed"] += res["failed"]
    log.info("backfill.tenant_complete", tenant_id=tenant_id, **totals)
    return {"tenant_id": tenant_id, **totals}


# ---------------------------------------------------------------------------
def _files_needing_backfill(gallery_id: str) -> list[dict]:
    """Files in dieser Galerie, die eine web.webp-Rendition haben, aber
    keine web_jpeg. Andere Files (z.B. Videos, fehlgeschlagene) werden
    übersprungen — nur Bilder mit existierendem web-Rendition kommen in
    Frage.

    Anmerkung zum Schema: tenantId liegt auf galleries, nicht auf files.
    Wir joinen also über files.galleryId → galleries.id."""
    with get_conn() as conn:
        rows = conn.execute(
            'SELECT DISTINCT f.id, g."tenantId" AS tenant_id, '
            '       f."galleryId" AS gallery_id, '
            '       wr."storageKey" AS web_storage_key '
            'FROM files f '
            'JOIN galleries g ON g.id = f."galleryId" '
            'JOIN renditions wr ON wr."fileId" = f.id AND wr.kind = %s '
            'LEFT JOIN renditions jr ON jr."fileId" = f.id AND jr.kind = %s '
            'WHERE f."galleryId" = %s '
            '  AND f.status = %s '
            '  AND jr.id IS NULL',
            ("web", "web_jpeg", gallery_id, "ready"),
        ).fetchall()
    return list(rows)


def _file_already_has_web_jpeg(file_id: str) -> bool:
    """Sicherheitsnetz gegen Race-Conditions, falls der Backfill parallel
    läuft oder zwischen List und Verarbeitung schon was passiert ist."""
    with get_conn() as conn:
        row = conn.execute(
            'SELECT id FROM renditions WHERE "fileId" = %s AND kind = %s '
            'LIMIT 1',
            (file_id, "web_jpeg"),
        ).fetchone()
    return row is not None


def _backfill_one(file_row: dict) -> None:
    """Eine web_jpeg-Rendition aus der existierenden web.webp bauen."""
    file_id = file_row["id"]
    tenant_id = file_row["tenant_id"]
    gallery_id = file_row["gallery_id"]
    web_key = file_row["web_storage_key"]

    with tempfile.TemporaryDirectory(prefix="lumio_backfill_") as tmp:
        # web.webp lokal holen
        webp_path = os.path.join(tmp, "web.webp")
        download_to_file(web_key, webp_path)

        # Aus der webp eine JPEG-Variante machen. Wir nutzen wieder
        # render_image_sizes mit nur einer Spec — die long-edge der
        # webp ist bereits 2560 oder kleiner, also bleibt scale=1.0
        # und das ist nur ein webp→jpg Re-Encode.
        def _persist(
            kind: str, out_path: str, w: int, h: int, fmt: str
        ) -> None:
            content_type = "image/jpeg"
            key = rendition_key(tenant_id, gallery_id, file_id, kind, fmt)
            size_bytes = upload_file(out_path, key, content_type)
            upsert_rendition(
                file_id=file_id, kind=kind, storage_key=key, fmt=fmt,
                width=w, height=h, size_bytes=size_bytes,
            )
            log.info("backfill.rendition_done",
                     file_id=file_id, kind=kind, fmt=fmt,
                     width=w, height=h, size=size_bytes)

        render_image_sizes(
            src_path=webp_path,
            specs=[("web_jpeg", 2560, 88, "jpg")],
            out_dir=tmp,
            on_rendition=_persist,
            autorotate=False,  # web.webp ist bereits autorotiert
        )
