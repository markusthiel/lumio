"""Tests für die PSD-Erkennung (psd.is_psd).

Logik-only. Das eigentliche Composite-Flattening (flatten_psd_to_png)
wird hier nicht getestet, weil Pillow keine PSD schreiben kann und somit
keine Fixture ohne Binär-Blob erzeugbar ist — das deckt der Integration-
Test mit echtem Sample-Material ab.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from psd import is_psd, PSD_MAGIC  # noqa: E402


def test_psd_magic_detected(tmp_path):
    f = tmp_path / "layered.psd"
    # PSD-Header: Signatur + Version 1 + Reserved + Channels …
    f.write_bytes(PSD_MAGIC + b"\x00\x01" + b"\x00" * 32)
    assert is_psd(str(f)) is True


def test_psb_magic_detected(tmp_path):
    f = tmp_path / "huge.psb"
    f.write_bytes(PSD_MAGIC + b"\x00\x02" + b"\x00" * 32)
    assert is_psd(str(f)) is True


def test_non_psd_rejected(tmp_path):
    f = tmp_path / "photo.jpg"
    f.write_bytes(b"\xff\xd8\xff\xe0JFIF")  # JPEG-Header
    assert is_psd(str(f)) is False


def test_missing_file_is_false():
    assert is_psd("/nope/does-not-exist.psd") is False
