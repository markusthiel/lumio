"""Tests for exif_meta.py: capture timestamp (extract_taken_at) and the
original hash/size embedded by the Lightroom plug-in (extract_original_md5,
extract_original_size).

Since the switch from pyexiv2 to exiftool (multi-arch, ARM support) we
read all values via an exiftool subprocess. These tests create a real
JPEG, write the EXIF date tags with exiftool resp. embed the original
hash directly as an APP1-XMP segment (see _stamp_original_md5 -- mirrors
the byte format of apps/lightroom-plugin/.../JpegXmp.lua, without testing
its APP0 special case; that belongs to the Lua side) and check priority,
fallback chain, and defensive behaviour.

The guard tests for _parse_exif_datetime need neither exiftool nor Pillow
and always run. The end-to-end tests are skipped when exiftool/Pillow are
missing from the test environment (local sandbox); exiftool is installed
in CI.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from datetime import datetime

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from exif_meta import (  # noqa: E402
    _parse_exif_datetime,
    extract_metadata,
    extract_original_md5,
    extract_original_size,
    extract_taken_at,
)

_HAS_EXIFTOOL = shutil.which("exiftool") is not None
try:
    from PIL import Image  # noqa: F401

    _HAS_PIL = True
except Exception:
    _HAS_PIL = False

needs_tools = pytest.mark.skipif(
    not (_HAS_EXIFTOOL and _HAS_PIL),
    reason="exiftool and/or Pillow not available",
)


def _make_jpeg(path, **date_tags):
    """Creates a tiny JPEG and writes the given EXIF date tags.

    date_tags: e.g. DateTimeOriginal="2023:05:01 14:30:15"
    """
    from PIL import Image

    Image.new("RGB", (8, 8), (100, 100, 100)).save(str(path), "JPEG")
    if date_tags:
        args = ["exiftool", "-overwrite_original"]
        args += [f"-EXIF:{k}={v}" for k, v in date_tags.items()]
        args.append(str(path))
        subprocess.run(args, capture_output=True, check=True)
    return str(path)


def _stamp_original_md5(path, md5_hex, size=None):
    """Inserts a minimal APP1-XMP segment carrying <lumio:OriginalMD5> (and,
    when given, <lumio:OriginalSize>) right after SOI -- exiftool has no way
    to WRITE an unregistered custom XMP tag without a .ExifTool_config, so
    this constructs the exact bytes by hand instead (mirrors JpegXmp.lua's
    format, not its APP0-aware insertion point, which is out of scope for a
    worker-side test)."""
    xmp_header = b"http://ns.adobe.com/xap/1.0/\x00"
    size_field = (
        b"<lumio:OriginalSize>" + str(size).encode("ascii") + b"</lumio:OriginalSize>"
        if size is not None
        else b""
    )
    packet = (
        b'<?xpacket begin="\xef\xbb\xbf" id="W5M0MpCehiHzreSzNTczkc9d"?>'
        b'<x:xmpmeta xmlns:x="adobe:ns:meta/">'
        b'<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
        b'<rdf:Description rdf:about="" xmlns:lumio="https://lumio.app/ns/1.0/">'
        b"<lumio:OriginalMD5>" + md5_hex.encode("ascii") + b"</lumio:OriginalMD5>"
        + size_field
        + b'</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>'
    )
    payload = xmp_header + packet
    segment = bytes([0xFF, 0xE1]) + (len(payload) + 2).to_bytes(2, "big") + payload
    data = open(path, "rb").read()
    with open(path, "wb") as f:
        f.write(data[:2] + segment + data[2:])
    return str(path)


# ---------------------------------------------------------------------------
# Guard logic (always active, no exiftool needed)
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
# End-to-end via exiftool
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
    # Never throws, even if exiftool is missing or the file doesn't exist.
    assert extract_taken_at("/tmp/lumio-does-not-exist-xyz.jpg") is None


# ---------------------------------------------------------------------------
# Original-MD5 (custom XMP tag, embedded by the Lightroom plug-in)
# ---------------------------------------------------------------------------

@needs_tools
def test_original_md5_read_back(tmp_path):
    p = _make_jpeg(tmp_path / "e.jpg")
    _stamp_original_md5(p, "d41d8cd98f00b204e9800998ecf8427e")
    assert extract_original_md5(p) == "d41d8cd98f00b204e9800998ecf8427e"


@needs_tools
def test_original_md5_absent_returns_none(tmp_path):
    p = _make_jpeg(tmp_path / "f.jpg")
    assert extract_original_md5(p) is None


@needs_tools
def test_original_md5_malformed_value_rejected(tmp_path):
    # Defensive: a stray/corrupt tag should never be trusted as a hash --
    # only a well-formed 32-char hex string is accepted.
    p = _make_jpeg(tmp_path / "g.jpg")
    _stamp_original_md5(p, "not-a-valid-hash")
    assert extract_original_md5(p) is None


@needs_tools
def test_original_md5_is_lowercased(tmp_path):
    p = _make_jpeg(tmp_path / "h.jpg")
    _stamp_original_md5(p, "D41D8CD98F00B204E9800998ECF8427E")
    assert extract_original_md5(p) == "d41d8cd98f00b204e9800998ecf8427e"


def test_original_md5_missing_file_returns_none():
    assert extract_original_md5("/tmp/lumio-does-not-exist-xyz.jpg") is None


# ---------------------------------------------------------------------------
# Original-Size (custom XMP tag, embedded alongside the hash -- cheap
# pre-filter for the Selection-Import rename-recovery pass)
# ---------------------------------------------------------------------------

@needs_tools
def test_original_size_read_back(tmp_path):
    p = _make_jpeg(tmp_path / "j.jpg")
    _stamp_original_md5(p, "d41d8cd98f00b204e9800998ecf8427e", size=25_600_000)
    assert extract_original_size(p) == 25_600_000


@needs_tools
def test_original_size_absent_returns_none(tmp_path):
    # Stamped WITHOUT a size (size=None) -- older/partial embeddings must
    # not be misread as size 0 or crash.
    p = _make_jpeg(tmp_path / "k.jpg")
    _stamp_original_md5(p, "d41d8cd98f00b204e9800998ecf8427e")
    assert extract_original_size(p) is None


@needs_tools
def test_original_size_zero_or_negative_rejected(tmp_path):
    p = _make_jpeg(tmp_path / "l.jpg")
    _stamp_original_md5(p, "d41d8cd98f00b204e9800998ecf8427e", size=0)
    assert extract_original_size(p) is None


def test_original_size_missing_file_returns_none():
    assert extract_original_size("/tmp/lumio-does-not-exist-xyz.jpg") is None


@needs_tools
def test_extract_metadata_returns_all_three_from_a_single_exiftool_call(tmp_path, monkeypatch):
    # process_file.py/process_raw.py call extract_metadata() specifically
    # to avoid running exiftool multiple times per file -- assert that
    # invariant directly, not just the returned values.
    p = _make_jpeg(tmp_path / "i.jpg", DateTimeOriginal="2023:05:01 14:30:15")
    _stamp_original_md5(p, "d41d8cd98f00b204e9800998ecf8427e", size=25_600_000)

    real_run = subprocess.run
    calls = []

    def counting_run(*args, **kwargs):
        calls.append(1)
        return real_run(*args, **kwargs)

    monkeypatch.setattr(subprocess, "run", counting_run)

    taken_at, original_md5, original_size = extract_metadata(p)
    assert taken_at == datetime(2023, 5, 1, 14, 30, 15)
    assert original_md5 == "d41d8cd98f00b204e9800998ecf8427e"
    assert original_size == 25_600_000
    assert len(calls) == 1
