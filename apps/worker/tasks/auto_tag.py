"""
Lumio Worker — Auto-Tagging

Analysiert ein Bild und schreibt Tag-Vorschlaege in file_auto_tags.

Etappe 1 (jetzt): Rule-Based Heuristiken via PIL + EXIF.
Etappe 2 (kommt): CLIP / ML-basiert mit semantischem Vokabular.

Triggered:
  - aus process_file.generate_renditions nach mark_file_ready
  - aus process_raw.develop nach mark_file_ready (RAW)
  Nur wenn Tenant-Feature-Flag 'ai_tagging' aktiv ist — sonst no-op.

Tag-Vokabular (festes Set, alle keys/labels):
  Format: portrait | landscape | square
  Lichtstimmung: bright | dark | golden_hour
  Saettigung: vivid | muted | black_and_white
  Setting: indoor | outdoor (heuristisch, kann irren bei ungewoehnlicher
           Belichtung — daher confidence niedrig)
  Tageszeit (aus EXIF takenAt): morning | afternoon | evening | night

Jeder Tag bekommt eine Confidence 0..1 — bei rule-based meist binary,
aber wir bewahren das Feld fuer Etappe 2 (CLIP liefert echte Scores).
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
from typing import Optional

import structlog
from PIL import Image, ImageStat

from app import app
from db import get_conn
from feature_flags import is_feature_enabled
from storage import download_to_file

log = structlog.get_logger(__name__)


# Schwellwerte — alle empirisch, in der Praxis nachjustierbar
PORTRAIT_RATIO_THRESHOLD = 0.95  # height/width >= 1/0.95
LANDSCAPE_RATIO_THRESHOLD = 1.05  # width/height >= 1.05
BRIGHT_THRESHOLD = 175  # mean luminance (0-255)
DARK_THRESHOLD = 75
BW_SATURATION_THRESHOLD = 12  # mean saturation in HSV (0-255)
VIVID_SATURATION_THRESHOLD = 110
MUTED_SATURATION_THRESHOLD = 50


@app.task(name="tasks.auto_tag.tag_image", bind=True, max_retries=1)
def tag_image(self, file_id: str) -> dict:
    """Analysiert ein File und schreibt Tag-Vorschlaege.

    Wird nach process_file.generate_renditions getriggert. Feature-Flag-
    Check zuerst — wenn aus: schnell return, keine DB-Schreibvorgaenge.
    """
    log.info("auto_tag.start", file_id=file_id)

    file_row = _fetch_file_for_tagging(file_id)
    if not file_row:
        log.warning("auto_tag.file_missing", file_id=file_id)
        return {"file_id": file_id, "status": "missing"}

    tenant_id = file_row["tenant_id"]
    if not is_feature_enabled(tenant_id, "ai_tagging"):
        log.info("auto_tag.feature_disabled", file_id=file_id, tenant_id=tenant_id)
        return {"file_id": file_id, "status": "skipped_feature_off"}

    # Wir nutzen die preview-Rendition statt des Originals — kleiner zu
    # downloaden, schnellere Analyse, fuer Heuristiken voellig ausreichend.
    # Wenn keine preview existiert (z.B. Video): skip.
    preview_key = file_row.get("preview_key")
    if not preview_key:
        log.info("auto_tag.no_preview_skipping", file_id=file_id)
        return {"file_id": file_id, "status": "skipped_no_preview"}

    try:
        suggestions = _analyze(preview_key, exif=file_row.get("exif"),
                               taken_at=file_row.get("taken_at"),
                               width=file_row.get("width"),
                               height=file_row.get("height"))
    except Exception as err:
        log.exception("auto_tag.analyze_failed", file_id=file_id, err=str(err))
        return {"file_id": file_id, "status": "failed", "error": str(err)}

    if not suggestions:
        return {"file_id": file_id, "status": "no_suggestions"}

    _upsert_suggestions(file_id, suggestions)
    log.info("auto_tag.complete", file_id=file_id,
             count=len(suggestions),
             tags=[s["tagName"] for s in suggestions])
    return {
        "file_id": file_id,
        "status": "ok",
        "count": len(suggestions),
    }


def _fetch_file_for_tagging(file_id: str) -> Optional[dict]:
    """Holt File-Row inkl. tenant_id, exif und preview-Rendition-Key.
    Joint ueber gallery → tenant und renditions für die preview-Variante.
    """
    with get_conn() as conn:
        row = conn.execute(
            '''
            SELECT
                f.id,
                f.kind,
                f.width,
                f.height,
                f.exif,
                f."takenAt" AS taken_at,
                g."tenantId" AS tenant_id,
                (SELECT r."storageKey" FROM renditions r
                 WHERE r."fileId" = f.id AND r.kind = 'preview'
                 LIMIT 1) AS preview_key
            FROM files f
            JOIN galleries g ON g.id = f."galleryId"
            WHERE f.id = %s AND f.status = 'ready'
            ''',
            (file_id,),
        ).fetchone()
    if not row:
        return None
    # Nur image-Kind taggen; raws haben preview, aber wir taggen die als
    # 'image' nach process_raw. video wird nicht getagged (kein PIL-decode).
    if row["kind"] not in ("image", "raw"):
        return None
    return row


def _analyze(preview_storage_key: str, *, exif: dict | str | None,
             taken_at, width: int | None, height: int | None) -> list[dict]:
    """Laedt die Preview-Rendition aus S3 und analysiert sie.
    Gibt eine Liste von {tagName, confidence, source}-Dicts zurueck.
    """
    suggestions: list[dict] = []

    with tempfile.NamedTemporaryFile(suffix=".webp", delete=False) as tmp:
        try:
            download_to_file(preview_storage_key, tmp.name)
            img = Image.open(tmp.name)
            img.load()  # damit lazy-decode jetzt passiert
        finally:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass

    actual_w, actual_h = img.size if img else (width or 0, height or 0)

    # 1) Aspect-Ratio
    if actual_w and actual_h:
        ratio = actual_w / actual_h
        if ratio < PORTRAIT_RATIO_THRESHOLD:
            suggestions.append({"tagName": "portrait", "confidence": 1.0,
                                "source": "rule_based"})
        elif ratio > LANDSCAPE_RATIO_THRESHOLD:
            suggestions.append({"tagName": "landscape", "confidence": 1.0,
                                "source": "rule_based"})
        else:
            suggestions.append({"tagName": "square", "confidence": 1.0,
                                "source": "rule_based"})

    # 2) Brightness (Luminance Mean). Wir konvertieren zu L-Mode (Graustufen)
    # statt ueber RGB-mean zu gehen — L ist perceptual-gewichtet (Rec. 601).
    try:
        lum = ImageStat.Stat(img.convert("L"))
        lum_mean = lum.mean[0]
        if lum_mean >= BRIGHT_THRESHOLD:
            suggestions.append({"tagName": "bright",
                                "confidence": min(1.0, (lum_mean - BRIGHT_THRESHOLD) / 30 + 0.7),
                                "source": "rule_based"})
        elif lum_mean <= DARK_THRESHOLD:
            suggestions.append({"tagName": "dark",
                                "confidence": min(1.0, (DARK_THRESHOLD - lum_mean) / 30 + 0.7),
                                "source": "rule_based"})

        # 3) Sättigung via HSV — schwarzweiss bei sehr niedriger Saturation
        hsv = img.convert("HSV")
        sat_mean = ImageStat.Stat(hsv).mean[1]
        if sat_mean < BW_SATURATION_THRESHOLD:
            suggestions.append({"tagName": "black_and_white",
                                "confidence": min(1.0, 0.7 + (BW_SATURATION_THRESHOLD - sat_mean) / 12),
                                "source": "rule_based"})
        elif sat_mean >= VIVID_SATURATION_THRESHOLD:
            suggestions.append({"tagName": "vivid", "confidence": 0.85,
                                "source": "rule_based"})
        elif sat_mean <= MUTED_SATURATION_THRESHOLD:
            suggestions.append({"tagName": "muted", "confidence": 0.75,
                                "source": "rule_based"})
    except Exception as err:
        log.warning("auto_tag.brightness_saturation_failed", err=str(err))

    # 4) EXIF-Heuristiken — ISO + Aperture → indoor/outdoor (grob)
    exif_dict = _parse_exif(exif)
    if exif_dict:
        iso = _extract_int(exif_dict, ["ISOSpeedRatings", "ISO", "PhotographicSensitivity"])
        f_number = _extract_float(exif_dict, ["FNumber", "ApertureValue"])
        # Indoor-Heuristik: hohes ISO (>= 1600) + offene Blende (<= f/2.8)
        if iso and iso >= 1600 and f_number and f_number <= 2.8:
            suggestions.append({"tagName": "indoor", "confidence": 0.7,
                                "source": "rule_based"})
        # Outdoor-Heuristik: niedriges ISO (<= 200) + geschlossenere Blende (>= f/5.6)
        elif iso and iso <= 200 and f_number and f_number >= 5.6:
            suggestions.append({"tagName": "outdoor", "confidence": 0.7,
                                "source": "rule_based"})

    # 5) Tageszeit aus takenAt (lokale Tageszeit-Annahme)
    if taken_at:
        try:
            # taken_at kommt als datetime; Stunde extrahieren
            h = taken_at.hour if hasattr(taken_at, "hour") else None
            if h is not None:
                tod = _time_of_day(h)
                if tod:
                    # Confidence niedriger weil EXIF-Zeit nicht immer
                    # korrekt gesetzt ist (manche Kameras default UTC,
                    # manche local — wir wissen es nicht ohne Timezone)
                    suggestions.append({"tagName": tod, "confidence": 0.6,
                                        "source": "rule_based"})
        except Exception as err:
            log.warning("auto_tag.time_of_day_failed", err=str(err))

    return suggestions


def _parse_exif(exif) -> dict:
    """exif kommt aus DB als JSON oder dict — normalisieren."""
    if not exif:
        return {}
    if isinstance(exif, str):
        try:
            return json.loads(exif)
        except (ValueError, TypeError):
            return {}
    if isinstance(exif, dict):
        return exif
    return {}


def _extract_int(d: dict, keys: list[str]) -> Optional[int]:
    for k in keys:
        if k in d:
            v = d[k]
            try:
                # EXIF kann "ISO 1600" oder "1600" oder int sein
                if isinstance(v, str):
                    v = "".join(c for c in v if c.isdigit())
                    return int(v) if v else None
                return int(v)
            except (ValueError, TypeError):
                continue
    return None


def _extract_float(d: dict, keys: list[str]) -> Optional[float]:
    for k in keys:
        if k in d:
            v = d[k]
            try:
                if isinstance(v, str):
                    # "f/2.8" -> "2.8"
                    v = v.replace("f/", "").replace("F/", "").strip()
                    return float(v)
                return float(v)
            except (ValueError, TypeError):
                continue
    return None


def _time_of_day(hour: int) -> Optional[str]:
    """Mapping Stunde → Tageszeit-Bucket.
    morning   05:00 - 10:59
    afternoon 11:00 - 16:59
    evening   17:00 - 20:59
    night     21:00 - 04:59
    """
    if 5 <= hour <= 10:
        return "morning"
    if 11 <= hour <= 16:
        return "afternoon"
    if 17 <= hour <= 20:
        return "evening"
    return "night"


def _upsert_suggestions(file_id: str, suggestions: list[dict]) -> None:
    """Schreibt die Vorschlaege in file_auto_tags.

    Wenn ein Tag fuer das File schon existiert:
      - status='suggested' → confidence updaten (re-tag kann neue Heuristik
        haben)
      - status='accepted'  → nichts tun (User hat es schon manuell akzeptiert)
      - status='rejected'  → nichts tun (User will diesen Tag nicht)

    Unique-Constraint (fileId, tagName) verhindert Doppel-Inserts; wir
    machen ON CONFLICT DO UPDATE.
    """
    with get_conn() as conn:
        for s in suggestions:
            conn.execute(
                '''
                INSERT INTO file_auto_tags
                    ("fileId", "tagName", confidence, source, status, "updatedAt")
                VALUES (%s, %s, %s, %s, 'suggested', CURRENT_TIMESTAMP)
                ON CONFLICT ("fileId", "tagName") DO UPDATE SET
                    confidence = EXCLUDED.confidence,
                    "updatedAt" = CURRENT_TIMESTAMP
                WHERE file_auto_tags.status = 'suggested'
                ''',
                (file_id, s["tagName"], s["confidence"], s["source"]),
            )
