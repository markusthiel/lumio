"""
Lumio Worker — EXIF-Metadaten

Liest den Aufnahmezeitpunkt (DateTimeOriginal) aus dem Original-File via
pyexiv2 (libexiv2 ist im Worker-Image installiert). Best-effort: bei
fehlendem/kaputtem EXIF oder nicht unterstütztem Format gibt es None
zurück — die Verarbeitung darf deswegen NIE scheitern.

Genutzt von process_file (JPEG/PNG/HEIC/TIFF) und process_raw (CR2/NEF/
ARW/...). pyexiv2/exiv2 liest EXIF auch aus vielen RAW-Containern; bei
nicht unterstützten (z.B. teils CR3) kommt schlicht nichts → None.

Der zurückgegebene datetime ist NAIV (lokale Kamerazeit, ohne Zeitzone).
Für das Sortieren innerhalb einer Galerie — typischerweise ein Shooting,
eine Kamera — ist das konsistent und ausreichend; eine
Zeitzonen-Normalisierung wäre Over-Engineering.
"""
from __future__ import annotations

from datetime import datetime

import structlog

log = structlog.get_logger(__name__)

# Bevorzugte Tags: Aufnahme > Digitalisierung > Datei-Änderungsdatum.
_DATE_TAGS = (
    "Exif.Photo.DateTimeOriginal",
    "Exif.Photo.DateTimeDigitized",
    "Exif.Image.DateTime",
)

# EXIF-Datumsformat: "YYYY:MM:DD HH:MM:SS" (Doppelpunkte auch im Datum).
_EXIF_DT_FMT = "%Y:%m:%d %H:%M:%S"


def _parse_exif_datetime(value: str) -> datetime | None:
    if not value:
        return None
    # Nur "YYYY:MM:DD HH:MM:SS" verwenden; manche Kameras hängen
    # Sub-Sekunden/Zeitzonen-Offsets an, die strptime nicht mag.
    v = value.strip()[:19]
    # Platzhalter/leere Werte aussortieren ("0000:00:00 00:00:00").
    if v.startswith("0000") or len(v) < 19:
        return None
    try:
        return datetime.strptime(v, _EXIF_DT_FMT)
    except (ValueError, TypeError):
        return None


def extract_taken_at(src_path: str) -> datetime | None:
    """Aufnahmezeitpunkt aus den EXIF-Daten des Originals.

    Liefert einen naiven datetime oder None. Wirft nie — alle Fehler
    (kein EXIF, kaputtes EXIF, unbekanntes Format, pyexiv2 fehlt) führen
    zu None plus Log-Eintrag.
    """
    try:
        import pyexiv2  # type: ignore
    except Exception as err:  # pragma: no cover - nur falls Lib fehlt
        log.warning("exif.pyexiv2_unavailable", err=str(err))
        return None

    img = None
    try:
        img = pyexiv2.Image(src_path)
        exif = img.read_exif() or {}
    except Exception as err:
        # Kein/kaputtes EXIF oder nicht unterstütztes Format — kein Drama.
        log.info("exif.read_failed", err=str(err))
        return None
    finally:
        if img is not None:
            try:
                img.close()
            except Exception:
                pass

    for tag in _DATE_TAGS:
        raw = exif.get(tag)
        if not raw:
            continue
        dt = _parse_exif_datetime(str(raw))
        if dt is not None:
            return dt
    return None
