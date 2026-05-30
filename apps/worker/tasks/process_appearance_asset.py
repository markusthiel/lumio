"""
Lumio Worker — Appearance-Asset-Optimierung

Konvertiert hochgeladene Studio-/Login-/E-Mail-Assets (Logos +
Login-Hintergrund) in optimiertes WebP, damit nicht bei jedem Aufruf
mehrere MB geladen werden. Trigger:

  Studio-User lädt ein Logo/Hintergrundbild hoch
    → API setzt tenants.<kind>Key auf den Upload-Key
    → API enqueued process_appearance_asset { tenantId, kind }
    → Dieser Task lädt das Original, rendert WebP (resize je nach kind),
      lädt es unter neuem Key hoch, updatet die DB-Spalte und löscht das
      Original.

Anders als beim Galerie-Branding-Task verarbeiten wir hier AUCH Logos —
weil ein Studio gern ein 5-MB-PNG hochlädt, das in der Sidebar mit 28px
dargestellt wird. Zwei Stellschrauben:

  - SVG bleibt unangetastet (vektoriell, bereits klein, skaliert perfekt).
  - Logos werden auf max. 512px lange Kante gerechnet, das Hintergrund-
    bild auf 2400px (Hero-Qualität).

Robustheit identisch zum Branding-Task: idempotent (schon-WebP +
klein → skip), Race-Schutz beim DB-Update (nur wenn die Spalte noch auf
den erwarteten Key zeigt), Format-Fehler lassen das Original stehen.
"""
from __future__ import annotations

import os
import tempfile

import structlog

from app import app
import db
import storage
from imaging import probe_dimensions

log = structlog.get_logger("lumio.process_appearance_asset")

WEBP_QUALITY = 85

# kind → DB-Spalte auf der tenants-Tabelle (identisch zum FIELD_MAP der API)
FIELDS = {
    "studioLogo": "studioLogoKey",
    "studioLogoLight": "studioLogoLightKey",
    "loginLogo": "loginLogoKey",
    "loginBackground": "loginBackgroundKey",
    "emailLogo": "emailLogoKey",
}

# Logos werden klein dargestellt (Sidebar ~28px, Login ~56px, Mail 48px) —
# 512px lange Kante ist großzügig für Retina. Das Hintergrundbild ist ein
# Hero und darf groß bleiben.
MAX_EDGE_BY_KIND = {
    "studioLogo": 512,
    "studioLogoLight": 512,
    "loginLogo": 512,
    "emailLogo": 512,
    "loginBackground": 2400,
}

# Kamera-RAW-Formate: libvips kann die nicht direkt öffnen, deshalb
# demosaicen wir sie vorab über rawpy (gleiche Logik wie process_raw)
# zu einem JPEG und konvertieren das dann zu WebP.
RAW_EXTENSIONS = {
    ".cr2", ".cr3", ".nef", ".nrw", ".arw", ".sr2", ".srf",
    ".dng", ".raf", ".orf", ".rw2", ".pef", ".srw", ".raw",
    ".3fr", ".erf", ".kdc", ".mos", ".mrw", ".x3f",
}


@app.task(name="tasks.process_appearance_asset.optimize", bind=True)
def optimize(self, tenant_id: str, kind: str) -> dict:
    if kind not in FIELDS:
        log.warning("appearance.unknown_kind", kind=kind, tenantId=tenant_id)
        return {"ok": False, "reason": "unknown_kind"}

    field = FIELDS[kind]
    max_edge = MAX_EDGE_BY_KIND[kind]

    # 1) Tenant + aktuellen Storage-Key holen
    with db.get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            f'SELECT id, "{field}" AS src FROM tenants WHERE id = %s',
            (tenant_id,),
        )
        row = cur.fetchone()
    if row is None:
        log.info("appearance.not_found", tenantId=tenant_id)
        return {"ok": False, "reason": "not_found"}

    src_key: str | None = row["src"]
    if not src_key:
        log.info("appearance.no_asset", tenantId=tenant_id, kind=kind)
        return {"ok": False, "reason": "no_asset"}

    # Externe URL (http(s)://) nicht anfassen — könnte bewusst eine
    # CDN-URL sein.
    if src_key.startswith("http://") or src_key.startswith("https://"):
        log.info("appearance.external_url_skip", tenantId=tenant_id)
        return {"ok": False, "reason": "external_url"}

    # SVG ist vektoriell + klein → kein WebP-Roundtrip, einfach behalten.
    if src_key.lower().endswith(".svg"):
        log.info("appearance.svg_skip", tenantId=tenant_id, kind=kind)
        return {"ok": True, "skipped": True, "reason": "svg"}

    # Zielformat: E-Mail-Logos müssen mail-kompatibel sein → PNG. WebP
    # zeigen viele Mail-Clients (u.a. Outlook) nicht an, das Logo wäre
    # dort unsichtbar. PNG behält Transparenz und wird überall gerendert.
    # Alle anderen Assets (nur Web-Anzeige) bleiben WebP.
    is_email_logo = kind == "emailLogo"
    target_ext = "png" if is_email_logo else "webp"
    already_target = src_key.lower().endswith("." + target_ext)

    # 2) Original temporär ziehen
    with tempfile.TemporaryDirectory(prefix="lumio-appearance-") as tmpdir:
        src_path = os.path.join(tmpdir, "src")
        try:
            storage.download_to_file(src_key, src_path)
        except Exception as err:  # noqa: BLE001
            log.warning(
                "appearance.download_failed",
                tenantId=tenant_id,
                key=src_key,
                err=str(err),
            )
            return {"ok": False, "reason": "download_failed"}

        # RAW vorab via rawpy zu JPEG demosaicen (libvips öffnet RAW
        # nicht direkt). Wir nehmen das eingebettete Preview, sonst volles
        # Demosaicing — danach läuft der normale WebP-Pfad.
        work_path = src_path
        if any(src_key.lower().endswith(ext) for ext in RAW_EXTENSIONS):
            jpeg_path = os.path.join(tmpdir, "demosaiced.jpg")
            try:
                from tasks.process_raw import _extract_or_demosaic

                _extract_or_demosaic(src_path, jpeg_path)
                work_path = jpeg_path
                already_target = False
            except Exception as err:  # noqa: BLE001
                log.warning(
                    "appearance.raw_demosaic_failed",
                    tenantId=tenant_id,
                    key=src_key,
                    err=str(err),
                )
                return {"ok": False, "reason": "raw_failed"}

        try:
            width, height = probe_dimensions(work_path, autorotate=True)
        except Exception as err:  # noqa: BLE001
            # libvips kann das Format evtl. nicht direkt öffnen (z.B.
            # JPEG 2000 ohne OpenJPEG-Support). Wenn es noch das Original
            # ist, als letzten Versuch über Pillow zu JPEG transcodieren.
            transcoded = (
                _transcode_via_pillow(src_path, tmpdir)
                if work_path == src_path
                else None
            )
            if transcoded is None:
                log.warning(
                    "appearance.probe_failed",
                    tenantId=tenant_id,
                    err=str(err),
                )
                return {"ok": False, "reason": "probe_failed"}
            work_path = transcoded
            already_target = False
            try:
                width, height = probe_dimensions(work_path, autorotate=True)
            except Exception as err2:  # noqa: BLE001
                log.warning(
                    "appearance.probe_failed",
                    tenantId=tenant_id,
                    err=str(err2),
                )
                return {"ok": False, "reason": "probe_failed"}

        long_edge = max(width, height)
        needs_resize = long_edge > max_edge
        if already_target and not needs_resize:
            log.info(
                "appearance.already_optimal",
                tenantId=tenant_id,
                kind=kind,
                width=width,
                height=height,
            )
            return {"ok": True, "skipped": True}

        # 3) Zielformat rendern (PNG für E-Mail-Logo, sonst WebP)
        import pyvips  # type: ignore

        img = pyvips.Image.new_from_file(work_path, access="sequential")
        img = img.autorot()
        if needs_resize:
            scale = max_edge / long_edge
            img = img.resize(scale, kernel="lanczos3")

        # strip=True entfernt EXIF (Privacy + kleinere Files). Beide
        # Formate behalten den Alpha-Kanal transparenter Logos.
        if is_email_logo:
            out_path = os.path.join(tmpdir, "out.png")
            img.pngsave(out_path, strip=True)
            content_type = "image/png"
        else:
            out_path = os.path.join(tmpdir, "out.webp")
            img.webpsave(out_path, Q=WEBP_QUALITY, strip=True)
            content_type = "image/webp"

        # 4) Neuer Key — gleicher Pfad, Extension je Zielformat. So
        #    bleiben die Cleanup-Pfade in appearance.ts vorhersagbar.
        new_key = src_key.rsplit(".", 1)[0] + "." + target_ext
        try:
            storage.upload_file(out_path, new_key, content_type)
        except Exception as err:  # noqa: BLE001
            log.warning(
                "appearance.upload_failed",
                tenantId=tenant_id,
                key=new_key,
                err=str(err),
            )
            return {"ok": False, "reason": "upload_failed"}

        # 5) DB updaten (Race-Schutz: nur wenn Spalte noch auf alten Key
        #    zeigt) + altes File aufräumen.
        if new_key != src_key:
            with db.get_conn() as conn, conn.cursor() as cur:
                cur.execute(
                    f'UPDATE tenants SET "{field}" = %s '
                    f'WHERE id = %s AND "{field}" = %s',
                    (new_key, tenant_id, src_key),
                )
                updated = cur.rowcount
            if updated == 0:
                log.info(
                    "appearance.key_changed_skip_db",
                    tenantId=tenant_id,
                    expected=src_key,
                )
                try:
                    storage.delete_object(new_key)
                except Exception:  # noqa: BLE001
                    pass
                return {"ok": False, "reason": "stale_key"}

            try:
                storage.delete_object(src_key)
            except Exception as err:  # noqa: BLE001
                log.warning(
                    "appearance.cleanup_failed",
                    tenantId=tenant_id,
                    key=src_key,
                    err=str(err),
                )

        log.info(
            "appearance.optimized",
            tenantId=tenant_id,
            kind=kind,
            old_key=src_key,
            new_key=new_key,
            resized=needs_resize,
            converted=not already_target,
        )
        return {
            "ok": True,
            "newKey": new_key,
            "resized": needs_resize,
            "converted": not already_target,
        }


def _transcode_via_pillow(src_path: str, tmpdir: str) -> str | None:
    """Letzter Ausweg für Formate, die libvips nicht direkt öffnet
    (z.B. JPEG 2000 / .jp2). Pillow ist mit OpenJPEG gebaut und kann
    sie lesen — wir schreiben ein JPEG, das danach normal zu WebP
    konvertiert wird. Gibt den JPEG-Pfad zurück oder None, wenn auch
    Pillow das Format nicht öffnen kann (dann ist es vermutlich kein
    Bild)."""
    try:
        from PIL import Image as PILImage  # type: ignore

        out = os.path.join(tmpdir, "transcoded.jpg")
        with PILImage.open(src_path) as im:
            im.convert("RGB").save(out, "JPEG", quality=92)
        return out
    except Exception as err:  # noqa: BLE001
        log.warning("appearance.pillow_transcode_failed", err=str(err))
        return None
