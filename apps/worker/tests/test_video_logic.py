"""
Tests für die rein-funktionalen Teile der Worker-Tasks.

Wir mocken die nativen Imports (pyvips, rawpy) auf Modul-Ebene, damit
die Tests in CI auch ohne installierte System-Bibliotheken laufen
(beim normalen Import würden sie sofort scheitern).
"""
from __future__ import annotations

import os
import sys
import types

import pytest


# Stub für native deps anlegen, BEVOR irgendwas aus tasks.process_video importiert
sys.modules.setdefault("pyvips", types.ModuleType("pyvips"))
sys.modules.setdefault("rawpy", types.ModuleType("rawpy"))

# Env-Vars, die `storage.py` beim Import erwartet
os.environ.setdefault("S3_ENDPOINT", "http://localhost:9000")
os.environ.setdefault("S3_BUCKET", "test")
os.environ.setdefault("S3_ACCESS_KEY", "test")
os.environ.setdefault("S3_SECRET_KEY", "test")
os.environ.setdefault("DATABASE_URL", "postgres://test:test@localhost/test")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")


# -----------------------------------------------------------------------------
# kbps-Parser
# -----------------------------------------------------------------------------
def test_kbps_to_int_strips_suffix():
    from tasks.process_video import _kbps_to_int
    assert _kbps_to_int("2500k") == 2500
    assert _kbps_to_int("96k") == 96
    assert _kbps_to_int("5000K") == 5000


# -----------------------------------------------------------------------------
# HLS-Variant-Auswahl: nichts upscalen, mindestens eine Variante zurückgeben
# -----------------------------------------------------------------------------
def test_hls_variant_selection_fhd():
    from tasks.process_video import HLS_VARIANTS
    chosen = [v for v in HLS_VARIANTS if v[0] <= 1080]
    assert [v[0] for v in chosen] == [480, 720, 1080]


def test_hls_variant_selection_hd():
    from tasks.process_video import HLS_VARIANTS
    chosen = [v for v in HLS_VARIANTS if v[0] <= 720]
    assert [v[0] for v in chosen] == [480, 720]


def test_hls_variant_selection_low_source():
    """Bei sehr kleinem Quellvideo (z.B. 360p) gibt's keine passende
    Variante — _make_hls fällt dann auf die 480p-Variante zurück. Das
    testen wir indirekt indem wir die Filterung allein anschauen."""
    from tasks.process_video import HLS_VARIANTS
    source_height = 360
    chosen = [v for v in HLS_VARIANTS if v[0] <= source_height]
    assert chosen == []  # leer → triggert den Fallback in _make_hls


# -----------------------------------------------------------------------------
# Rendition-Key-Generation (muss exakt zur API matchen)
# -----------------------------------------------------------------------------
def test_rendition_key_format():
    from storage import rendition_key
    key = rendition_key(
        tenant_id="t1",
        gallery_id="g1",
        file_id="f1",
        kind="thumb",
        extension="webp",
    )
    assert key == "t/t1/g/g1/r/f1/thumb.webp"


def test_rendition_key_hls_master():
    """Konsistenz-Check: das HLS-Upload-Layout muss mit dem API-Helper
    übereinstimmen (master.m3u8 unter .../r/<fileId>/hls/master.m3u8)."""
    from storage import rendition_key
    # process_video baut den Pfad selbst (nicht über rendition_key), deshalb
    # verifizieren wir hier nur das Standard-Schema. Der HLS-Pfad in
    # _upload_hls_tree ist: t/<tenant>/g/<gallery>/r/<file>/hls/master.m3u8 —
    # gleicher Präfix wie hier ohne Extension-Suffix.
    base = rendition_key("t1", "g1", "f1", "hls", "m3u8")
    assert base.startswith("t/t1/g/g1/r/f1/")
