"""
Lumio Worker — Branding-Asset-Optimierung

Konvertiert ein hochgeladenes Branding-Bild (Login-Background) in
ein optimiertes WebP. Trigger:

  Studio-User lädt JPEG/PNG/WebP als Login-Hintergrund hoch
    → API setzt branding.loginBackgroundUrl auf den Upload-Key
    → API enqueued process_branding_asset { brandingId, kind }
    → Dieser Task lädt das Original, konvertiert nach WebP (quality 85,
      max edge 2400px), lädt das WebP unter neuem Key hoch, updatet die
      DB-Spalte und löscht das Original.

Warum nicht direkt beim Upload? Der Browser-PUT ist presigned S3,
ohne Backend-Roundtrip. Konvertierung im Worker hält den Upload
schnell und nutzt libvips effizient.

Robustheit:
  - Wenn das Original schon WebP ist UND klein genug (<= 2400px), wird
    nichts gemacht (Idempotenz: erneuter Run findet nichts zu tun).
  - Wenn der Branding-Datensatz weg ist oder die Spalte schon einen
    anderen Key trägt (z.B. der User hat zwischenzeitlich ein neues
    Bild hochgeladen), brechen wir ab — kein Race-Risiko.
  - Format-Fehler → status_log, Original bleibt; UI funktioniert
    weiterhin (das alte Bild ist immer noch sichtbar).

Erweiterbarkeit: Logo + Favicon werden aktuell NICHT konvertiert —
das sind typisch kleine SVG/PNG-Files, da lohnt sich kein WebP-Roundtrip.
Wenn das später anders sein soll, kann derselbe Task auch andere
kinds verarbeiten — er bekommt das kind als Argument.
"""
from __future__ import annotations

import os
import tempfile

import structlog

from app import app
import db
import storage
from imaging import probe_dimensions

log = structlog.get_logger("lumio.process_branding_asset")

MAX_EDGE = 2400
WEBP_QUALITY = 85


# Field-Mapping wie auf der API-Seite. Aktuell verarbeiten wir nur
# loginBackground; logo/favicon koennten spaeter dazukommen.
FIELDS = {
    "loginBackground": "loginBackgroundUrl",
}


@app.task(name="tasks.process_branding_asset.optimize", bind=True)
def optimize(self, branding_id: str, kind: str) -> dict:
    if kind not in FIELDS:
        log.warning("branding.unknown_kind", kind=kind, brandingId=branding_id)
        return {"ok": False, "reason": "unknown_kind"}

    field = FIELDS[kind]

    # 1) Branding + aktuellen Storage-Key holen
    with db.get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            f'SELECT id, "tenantId", "{field}" FROM brandings WHERE id = %s',
            (branding_id,),
        )
        row = cur.fetchone()
    if row is None:
        log.info("branding.not_found", brandingId=branding_id)
        return {"ok": False, "reason": "not_found"}

    tenant_id = row["tenantId"]
    src_key: str | None = row[field]
    if not src_key:
        log.info("branding.no_asset", brandingId=branding_id, kind=kind)
        return {"ok": False, "reason": "no_asset"}

    # Externe URL (http(s)://) wird nicht angefasst — der Tenant koennte
    # bewusst eine CDN-URL setzen.
    if src_key.startswith("http://") or src_key.startswith("https://"):
        log.info("branding.external_url_skip", brandingId=branding_id)
        return {"ok": False, "reason": "external_url"}

    # Wenn das File schon WebP ist UND klein genug: skip.
    already_webp = src_key.lower().endswith(".webp")

    # 2) Original temporär ziehen
    with tempfile.TemporaryDirectory(prefix="lumio-brand-") as tmpdir:
        src_path = os.path.join(tmpdir, "src")
        try:
            storage.download_to_file(src_key, src_path)
        except Exception as err:  # noqa: BLE001
            log.warning(
                "branding.download_failed",
                brandingId=branding_id,
                key=src_key,
                err=str(err),
            )
            return {"ok": False, "reason": "download_failed"}

        try:
            width, height = probe_dimensions(src_path, autorotate=True)
        except Exception as err:  # noqa: BLE001
            log.warning(
                "branding.probe_failed", brandingId=branding_id, err=str(err)
            )
            return {"ok": False, "reason": "probe_failed"}

        long_edge = max(width, height)
        needs_resize = long_edge > MAX_EDGE
        if already_webp and not needs_resize:
            log.info(
                "branding.already_optimal",
                brandingId=branding_id,
                width=width,
                height=height,
            )
            return {"ok": True, "skipped": True}

        # 3) WebP rendern. Wir laden frisch und nutzen pyvips direkt;
        #    render_image_sizes ist auf die Multi-Output-Files-Pipeline
        #    fuer Galerie-Renditions zugeschnitten und ueberproportional
        #    fuer ein Einzelfile.
        import pyvips  # type: ignore

        img = pyvips.Image.new_from_file(src_path, access="sequential")
        img = img.autorot()
        if needs_resize:
            scale = MAX_EDGE / long_edge
            img = img.resize(scale, kernel="lanczos3")

        out_path = os.path.join(tmpdir, "out.webp")
        # quality=85 ist der Sweet-Spot fuer Photo-WebP (~30% kleiner
        # als JPEG bei gleicher visueller Qualitaet). strip=true
        # entfernt EXIF — Privacy + kleinere Files.
        img.webpsave(out_path, Q=WEBP_QUALITY, strip=True)

        # 4) Neuer Key. Wir behalten den Pfad, aber tauschen die
        #    Extension. So bleibt der S3-Key vorhersagbar (Cleanup-
        #    Pfade in brandings.ts funktionieren weiter).
        new_key = src_key.rsplit(".", 1)[0] + ".webp"
        # Wenn der neue Key gleich dem alten ist (z.B. schon .webp +
        # nur resize), ueberschreiben wir denselben Key — kein Cleanup
        # noetig.
        try:
            storage.upload_file(out_path, new_key, "image/webp")
        except Exception as err:  # noqa: BLE001
            log.warning(
                "branding.upload_failed",
                brandingId=branding_id,
                key=new_key,
                err=str(err),
            )
            return {"ok": False, "reason": "upload_failed"}

        # 5) DB updaten + altes File aufraeumen. Atomicitaet zwischen
        #    DB-Update und S3-Delete ist nicht streng noetig — falls
        #    das Delete fehlschlaegt, bleibt ein verwaistes File in S3,
        #    aber der DB-State ist konsistent.
        if new_key != src_key:
            # Race-Schutz: nur updaten wenn die DB-Spalte noch auf den
            # alten Key zeigt (sonst hat der User zwischenzeitlich ein
            # neues Bild hochgeladen und wir wuerden dessen Key
            # ueberschreiben).
            with db.get_conn() as conn, conn.cursor() as cur:
                cur.execute(
                    f'UPDATE brandings SET "{field}" = %s '
                    f'WHERE id = %s AND "{field}" = %s',
                    (new_key, branding_id, src_key),
                )
                updated = cur.rowcount
            if updated == 0:
                log.info(
                    "branding.key_changed_skip_db",
                    brandingId=branding_id,
                    expected=src_key,
                )
                # WebP-Datei wurde hochgeladen aber ist verwaist —
                # raeumen wir auf damit kein S3-Garbage entsteht.
                try:
                    storage.delete_object(new_key)
                except Exception:  # noqa: BLE001
                    pass
                return {"ok": False, "reason": "stale_key"}

            # Altes Original aufraeumen
            try:
                storage.delete_object(src_key)
            except Exception as err:  # noqa: BLE001
                log.warning(
                    "branding.cleanup_failed",
                    brandingId=branding_id,
                    key=src_key,
                    err=str(err),
                )

        log.info(
            "branding.optimized",
            brandingId=branding_id,
            kind=kind,
            old_key=src_key,
            new_key=new_key,
            resized=needs_resize,
            converted=not already_webp,
        )
        return {
            "ok": True,
            "newKey": new_key,
            "resized": needs_resize,
            "converted": not already_webp,
        }
