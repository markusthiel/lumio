"""
Lumio Worker — EXIF metadata

Reads the capture timestamp (DateTimeOriginal) from the original file via
exiftool (installed in the worker image). Best-effort: on missing/broken
EXIF or an unsupported format this returns None -- processing must NEVER
fail because of it.

Also reads the ORIGINAL-file content hash (and byte size) the Lightroom
Publish-Service plug-in embeds into a custom XMP field of the uploaded
JPEG (see apps/lightroom-plugin/lumio.lrdevplugin/JpegXmp.lua), so
Selection-Import can match a photo back to the Lightroom catalog by
content when the filename alone isn't enough (renamed file, or several
masters sharing a basename). The size is a cheap pre-filter Selection-
Import checks (a plain file-size stat) before hashing a rename-recovery
candidate's full content. Only ever present for files published that
way -- absent for everything else (browser uploads, upload-links, older
plug-in versions).

Used by process_file (JPEG/PNG/HEIC/TIFF) and process_raw (CR2/NEF/
ARW/CR3/...). exiftool reads EXIF from practically every RAW container too;
for unsupported formats it simply returns nothing -> None.

Why exiftool instead of pyexiv2: exiftool is a pure Perl-tool dependency
(multi-arch, in every Debian repo for amd64 AND arm64), whereas pyexiv2
only ships a precompiled x86_64 wheel and so blocked ARM builds. exiftool
also covers more formats (including CR3). Functionally identical: we read
the exact same date tags in the same priority order.

The returned datetime is NAIVE (local camera time, no timezone). For
sorting within a gallery -- typically one shoot, one camera -- that is
consistent and sufficient; timezone normalization would be over-engineering.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from datetime import datetime

import structlog

log = structlog.get_logger(__name__)

# Preferred tags: capture > digitization > file modification date.
# exiftool names (EXIF group made explicit, so no other group with the same
# tag name slips in):
#   EXIF:DateTimeOriginal  == Exif.Photo.DateTimeOriginal
#   EXIF:CreateDate        == Exif.Photo.DateTimeDigitized
#   EXIF:ModifyDate        == Exif.Image.DateTime
_DATE_TAGS = (
    "DateTimeOriginal",
    "CreateDate",
    "ModifyDate",
)

# EXIF date format after exiftool normalization: "YYYY:MM:DD HH:MM:SS".
_EXIF_DT_FMT = "%Y:%m:%d %H:%M:%S"

# exiftool must not hang forever on a pathological file.
_EXIFTOOL_TIMEOUT_S = 30

# Custom XMP tags written by JpegXmp.lua (namespace "lumio", see there).
# Verified empirically: exiftool exposes an unregistered/custom XMP
# namespace's flat properties out of the box -- no .ExifTool_config needed
# -- and with only one tag of each name in play, "-j" flattens them to
# these bare keys (group-qualified: "XMP-lumio:OriginalMD5",
# "XMP-lumio:OriginalSize").
_ORIGINAL_MD5_TAG_KEY = "OriginalMD5"
_ORIGINAL_MD5_RE = re.compile(r"^[0-9a-f]{32}$")
_ORIGINAL_SIZE_TAG_KEY = "OriginalSize"


def _parse_exif_datetime(value: str) -> datetime | None:
    if not value:
        return None
    # Only accept "YYYY:MM:DD HH:MM:SS"; some cameras append
    # sub-seconds/timezone offsets that strptime doesn't like.
    v = value.strip()[:19]
    # Filter out placeholder/empty values ("0000:00:00 00:00:00").
    if v.startswith("0000") or len(v) < 19:
        return None
    try:
        return datetime.strptime(v, _EXIF_DT_FMT)
    except (ValueError, TypeError):
        return None


def _run_exiftool(src_path: str) -> dict | None:
    """Single exiftool invocation gathering everything this module can
    extract: the date tags for _taken_at_from_record() and the custom
    Lumio content-hash/size tags for _original_md5_from_record() and
    _original_size_from_record(). Returns the raw JSON record, or None on
    any failure (missing exiftool, timeout, bad JSON, unsupported format)
    -- every extractor below treats that as "nothing available", never as
    an error.
    """
    if shutil.which("exiftool") is None:
        log.warning("exif.exiftool_unavailable")
        return None

    # One exiftool call, JSON output, date tags normalized to the
    # canonical format. -j only returns keys for tags that actually exist,
    # so we can pick unambiguously in priority order (unlike -s3, where the
    # mapping would be ambiguous).
    cmd = [
        "exiftool",
        "-j",                       # JSON
        "-n",                       # no "pretty" conversions
        "-d", _EXIF_DT_FMT,         # date tags to YYYY:MM:DD HH:MM:SS
        "-EXIF:DateTimeOriginal",
        "-EXIF:CreateDate",
        "-EXIF:ModifyDate",
        "-XMP-lumio:OriginalMD5",
        "-XMP-lumio:OriginalSize",
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
    except Exception as err:  # pragma: no cover - defensive
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
    return record if isinstance(record, dict) else None


def _taken_at_from_record(record: dict | None) -> datetime | None:
    if not record:
        return None
    for tag in _DATE_TAGS:
        raw = record.get(tag)
        if not raw:
            continue
        dt = _parse_exif_datetime(str(raw))
        if dt is not None:
            return dt
    return None


def _original_md5_from_record(record: dict | None) -> str | None:
    if not record:
        return None
    raw = record.get(_ORIGINAL_MD5_TAG_KEY)
    if not raw:
        return None
    value = str(raw).strip().lower()
    if not _ORIGINAL_MD5_RE.match(value):
        # Defensive: a stray/corrupt tag should never propagate as a
        # plausible-looking hash into exif.lumio.originalMd5.
        log.info("exif.original_md5_malformed", value=value[:64])
        return None
    return value


def _original_size_from_record(record: dict | None) -> int | None:
    if not record:
        return None
    raw = record.get(_ORIGINAL_SIZE_TAG_KEY)
    if raw is None:
        return None
    try:
        value = int(raw)
    except (TypeError, ValueError):
        log.info("exif.original_size_malformed", value=str(raw)[:64])
        return None
    if value <= 0:
        log.info("exif.original_size_malformed", value=value)
        return None
    return value


def extract_taken_at(src_path: str) -> datetime | None:
    """Capture timestamp from the original's EXIF data.

    Returns a naive datetime or None. Never throws -- every failure (no
    EXIF, broken EXIF, unknown format, exiftool missing) results in None
    plus a log entry.
    """
    return _taken_at_from_record(_run_exiftool(src_path))


def extract_original_md5(src_path: str) -> str | None:
    """MD5 of the ORIGINAL master file, as embedded by the Lightroom
    plug-in's Publish-Service into a custom XMP field of the uploaded
    JPEG. Only present for files published via that plug-in from this
    feature onward; None for everything else -- never throws.
    """
    return _original_md5_from_record(_run_exiftool(src_path))


def extract_original_size(src_path: str) -> int | None:
    """Byte size of the ORIGINAL master file, as embedded by the Lightroom
    plug-in's Publish-Service alongside extract_original_md5() (same custom
    XMP field, see JpegXmp.lua). Used as a cheap pre-filter by Selection-
    Import before hashing a rename-recovery candidate's full content. None
    for everything else -- never throws.
    """
    return _original_size_from_record(_run_exiftool(src_path))


def extract_metadata(src_path: str) -> tuple[datetime | None, str | None, int | None]:
    """Like calling extract_taken_at() and extract_original_md5() (plus the
    paired original file size, see _original_size_from_record) together,
    but with a SINGLE exiftool invocation. Use this at call sites that need
    more than one of these, so a file isn't run through exiftool twice.
    """
    record = _run_exiftool(src_path)
    return (
        _taken_at_from_record(record),
        _original_md5_from_record(record),
        _original_size_from_record(record),
    )
