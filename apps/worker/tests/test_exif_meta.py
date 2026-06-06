"""Tests für die EXIF-Aufnahmezeit-Extraktion (exif_meta.extract_taken_at).

Seit dem Wechsel von pyexiv2 auf exiftool (Multi-Arch, ARM-Support) lesen
wir die Date-Tags via exiftool-Subprocess. Diese Tests legen ein echtes
JPEG an, schreiben die EXIF-Date-Tags mit exiftool und prüfen Priorität,
Fallback-Kette und das defensive Verhalten.

Die Guard-Tests für _parse_exif_datetime brauchen weder exiftool noch
Pillow und laufen immer. Die End-to-End-Tests werden übersprungen, wenn
exiftool/Pillow im Test-Environment fehlen (lokale Sandbox); in CI ist
exiftool installiert.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from datetime import datetime

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from exif_meta import _parse_exif_datetime, extract_taken_at  # noqa: E402

_HAS_EXIFTOOL = shutil.which("exiftool") is not None
try:
    from PIL import Image  # noqa: F401

    _HAS_PIL = True
except Exception:
    _HAS_PIL = False

needs_tools = pytest.mark.skipif(
    not (_HAS_EXIFTOOL and _HAS_PIL),
    reason="exiftool und/oder Pillow nicht verfügbar",
)


def _make_jpeg(path, **date_tags):
    """Erzeugt ein winziges JPEG und schreibt die übergebenen EXIF-Date-Tags.

    date_tags: z.B. DateTimeOriginal="2023:05:01 14:30:15"
    """
    from PIL import Image

    Image.new("RGB", (8, 8), (100, 100, 100)).save(str(path), "JPEG")
    if date_tags:
        args = ["exiftool", "-overwrite_original"]
        args += [f"-EXIF:{k}={v}" for k, v in date_tags.items()]
        args.append(str(path))
        subprocess.run(args, capture_output=True, check=True)
    return str(path)


# ---------------------------------------------------------------------------
# Guard-Logik (immer aktiv, kein exiftool nötig)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "value,expected",
    [
        ("2023:05:01 14:30:15", datetime(2023, 5, 1, 14, 30, 15)),
        ("2023:05:01 14:30:15.123", datetime(2023, 5, 1, 14, 30, 15)),
        ("2023:05:01 14:30:15+02:00", datetime(2023, 5, 1, 14, 30, 15)),
        ("0000:00:00 00:00:00", None),
        ("", None),
        ("2023:05:01", None),
        ("garbage", None),
    ],
)
def test_parse_exif_datetime(value, expected):
    assert _parse_exif_datetime(value) == expected


# ---------------------------------------------------------------------------
# End-to-End über exiftool
# ---------------------------------------------------------------------------

@needs_tools
def test_priority_datetimeoriginal_wins(tmp_path):
    p = _make_jpeg(
        tmp_path / "a.jpg",
        DateTimeOriginal="2023:05:01 14:30:15",
        CreateDate="2023:05:01 14:30:10",
        ModifyDate="2023:05:02 09:00:00",
    )
    assert extract_taken_at(p) == datetime(2023, 5, 1, 14, 30, 15)


@needs_tools
def test_fallback_to_createdate(tmp_path):
    p = _make_jpeg(
        tmp_path / "b.jpg",
        CreateDate="2023:05:01 14:30:10",
        ModifyDate="2023:05:02 09:00:00",
    )
    assert extract_taken_at(p) == datetime(2023, 5, 1, 14, 30, 10)


@needs_tools
def test_fallback_to_modifydate(tmp_path):
    p = _make_jpeg(tmp_path / "c.jpg", ModifyDate="2023:05:02 09:00:00")
    assert extract_taken_at(p) == datetime(2023, 5, 2, 9, 0, 0)


@needs_tools
def test_no_date_tags_returns_none(tmp_path):
    p = _make_jpeg(tmp_path / "d.jpg")
    assert extract_taken_at(p) is None


@needs_tools
def test_non_image_returns_none(tmp_path):
    f = tmp_path / "note.txt"
    f.write_text("kein Bild")
    assert extract_taken_at(str(f)) is None


def test_missing_file_returns_none():
    # Wirft nie, auch wenn exiftool fehlt oder die Datei nicht existiert.
    assert extract_taken_at("/tmp/lumio-does-not-exist-xyz.jpg") is None
