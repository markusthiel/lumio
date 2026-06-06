"""
Lumio Worker — EXIF-Metadaten

Liest den Aufnahmezeitpunkt (DateTimeOriginal) aus dem Original-File via
exiftool (im Worker-Image installiert). Best-effort: bei fehlendem/kaputtem
EXIF oder nicht unterstütztem Format gibt es None zurück — die Verarbeitung
darf deswegen NIE scheitern.

Genutzt von process_file (JPEG/PNG/HEIC/TIFF) und process_raw (CR2/NEF/
ARW/CR3/...). exiftool liest EXIF auch aus praktisch allen RAW-Containern;
bei nicht unterstützten Formaten kommt schlicht nichts → None.

Warum exiftool statt pyexiv2: exiftool ist eine reine Perl-Tool-Abhängigkeit
(Multi-Arch, in jedem Debian-Repo für amd64 UND arm64), während pyexiv2 nur
ein vorkompiliertes x86_64-Wheel ausliefert und damit ARM-Builds blockiert
hat. exiftool deckt zudem mehr Formate ab (u.a. CR3). Funktional identisch:
wir lesen genau dieselben Date-Tags in derselben Priorität.

Der zurückgegebene datetime ist NAIV (lokale Kamerazeit, ohne Zeitzone).
Für das Sortieren innerhalb einer Galerie — typischerweise ein Shooting,
eine Kamera — ist das konsistent und ausreichend; eine
Zeitzonen-Normalisierung wäre Over-Engineering.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from datetime import datetime

import structlog

log = structlog.get_logger(__name__)

# Bevorzugte Tags: Aufnahme > Digitalisierung > Datei-Änderungsdatum.
# exiftool-Namen (EXIF-Gruppe explizit, damit keine fremden Gruppen mit
# gleichem Tag-Namen reinrutschen):
#   EXIF:DateTimeOriginal  == Exif.Photo.DateTimeOriginal
#   EXIF:CreateDate        == Exif.Photo.DateTimeDigitized
#   EXIF:ModifyDate        == Exif.Image.DateTime
_DATE_TAGS = (
    "DateTimeOriginal",
    "CreateDate",
    "ModifyDate",
)

# EXIF-Datumsformat nach exiftool-Normalisierung: "YYYY:MM:DD HH:MM:SS".
_EXIF_DT_FMT = "%Y:%m:%d %H:%M:%S"

# exiftool darf bei pathologischen Dateien nicht ewig hängen.
_EXIFTOOL_TIMEOUT_S = 30


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
    (kein EXIF, kaputtes EXIF, unbekanntes Format, exiftool fehlt) führen
    zu None plus Log-Eintrag.
    """
    if shutil.which("exiftool") is None:
        log.warning("exif.exiftool_unavailable")
        return None

    # Ein einziger exiftool-Aufruf, JSON-Ausgabe, alle Date-Tags auf das
    # kanonische Format normalisiert. -j liefert die Keys nur für tatsächlich
    # vorhandene Tags, also können wir eindeutig in Prioritätsreihenfolge
    # auswählen (anders als bei -s3, wo die Zuordnung uneindeutig wäre).
    cmd = [
        "exiftool",
        "-j",                       # JSON
        "-n",                       # keine "pretty"-Konvertierungen
        "-d", _EXIF_DT_FMT,         # Datums-Tags auf YYYY:MM:DD HH:MM:SS
        "-EXIF:DateTimeOriginal",
        "-EXIF:CreateDate",
        "-EXIF:ModifyDate",
        src_path,
    ]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=_EXIFTOOL_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired:
        log.info("exif.exiftool_timeout", path=src_path)
        return None
    except Exception as err:  # pragma: no cover - defensiv
        log.info("exif.exiftool_failed", err=str(err))
        return None

    if not proc.stdout.strip():
        return None

    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError as err:
        log.info("exif.json_parse_failed", err=str(err))
        return None

    if not isinstance(data, list) or not data:
        return None
    record = data[0]
    if not isinstance(record, dict):
        return None

    for tag in _DATE_TAGS:
        raw = record.get(tag)
        if not raw:
            continue
        dt = _parse_exif_datetime(str(raw))
        if dt is not None:
            return dt
    return None
