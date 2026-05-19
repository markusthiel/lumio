"""
Lumio Worker — Encoder-Profil-Auswahl

Wählt Hardware- oder Software-Encoding für den HLS-Transcoder.
Konfiguration via Env-Variable LUMIO_HW_ENCODER:

  auto       — versucht NVENC, dann QSV, dann VAAPI, fällt sonst auf libx264
               zurück (default, fail-safe)
  nvenc      — NVIDIA GPU (Quadro/RTX/etc., braucht --gpus all am Container)
  qsv        — Intel QuickSync (Linux mit /dev/dri/renderD128 durchgereicht)
  vaapi      — VA-API (AMD oder Intel, ebenfalls /dev/dri/renderD128)
  software   — explizit libx264, kein Probing

Pro Variante (verschiedene HLS-Stufen) werden die richtigen Codec-Args
plus Preset/Bitrate-Args generiert. Die ffmpeg-Befehlsstruktur bleibt
sonst gleich.

Probing passiert beim ersten Aufruf via `ffmpeg -encoders`, das Ergebnis
wird gecached — wir wollen nicht für jedes Video neu testen.
"""
from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import structlog

log = structlog.get_logger(__name__)

EncoderName = Literal["nvenc", "qsv", "vaapi", "software"]

# Welche Hardware-Encoder gibt's überhaupt im aktuellen ffmpeg-Build?
_available_encoders: set[str] | None = None


def _detect_available() -> set[str]:
    global _available_encoders
    if _available_encoders is not None:
        return _available_encoders
    try:
        out = subprocess.check_output(
            ["ffmpeg", "-hide_banner", "-encoders"],
            text=True, stderr=subprocess.DEVNULL,
        )
    except Exception as err:
        log.warn("encoder.probe_failed", err=str(err))
        out = ""

    found: set[str] = set()
    if "h264_nvenc" in out:
        found.add("nvenc")
    if "h264_qsv" in out:
        found.add("qsv")
    if "h264_vaapi" in out:
        found.add("vaapi")
    # libx264 ist quasi immer drin, aber sicherheitshalber prüfen
    if "libx264" in out:
        found.add("software")

    _available_encoders = found
    log.info("encoder.detected", available=sorted(found))
    return found


def _vaapi_device_present() -> bool:
    """VAAPI braucht ein /dev/dri/renderD128-Device. Nur wenn das durch-
    gereicht ist, ist VAAPI sinnvoll auch wenn libavcodec den Encoder hat."""
    return Path("/dev/dri/renderD128").exists()


@dataclass(frozen=True)
class EncoderProfile:
    """Fertige ffmpeg-Argumente für genau eine HLS-Variante."""
    name: EncoderName
    codec: str                # 'libx264' | 'h264_nvenc' | ...
    preset: str               # 'veryfast' bei libx264, 'p4' bei NVENC, ...
    extra_input_args: list[str]   # vor '-i', z.B. VAAPI-Init
    extra_video_args: list[str]   # nach -c:v, vor -map, z.B. -hwaccel-Filter


def select_encoder() -> EncoderName:
    """Welcher Encoder wird verwendet? Cached über den Process-Lifetime."""
    requested = (os.environ.get("LUMIO_HW_ENCODER") or "auto").lower()
    available = _detect_available()

    if requested == "software":
        return "software"

    # Explizit angefragt? Dann nur den nutzen, wenn er auch da ist.
    if requested in ("nvenc", "qsv"):
        if requested in available:
            return requested  # type: ignore[return-value]
        log.warn("encoder.requested_unavailable", requested=requested,
                 fallback="software")
        return "software"

    if requested == "vaapi":
        if "vaapi" in available and _vaapi_device_present():
            return "vaapi"
        log.warn("encoder.requested_unavailable", requested="vaapi",
                 reason="device_or_codec_missing", fallback="software")
        return "software"

    # 'auto': probieren in Reihenfolge
    if "nvenc" in available:
        return "nvenc"
    if "qsv" in available:
        return "qsv"
    if "vaapi" in available and _vaapi_device_present():
        return "vaapi"
    return "software"


def profile_for(variant_height: int) -> EncoderProfile:
    """Gibt das Encoder-Profil zurück. variant_height ist die HLS-Stufe
    (480/720/1080/2160) — manche Encoder profitieren von stufenspezifischen
    Presets, derzeit nutzen wir das aber nicht."""
    _ = variant_height  # reserviert für künftige Tuning-Logik
    name = select_encoder()

    if name == "nvenc":
        return EncoderProfile(
            name="nvenc",
            codec="h264_nvenc",
            # p4 = "Medium" auf der p1..p7-Skala, ähnlich libx264 'veryfast'
            preset="p4",
            extra_input_args=[],
            extra_video_args=[],
        )
    if name == "qsv":
        return EncoderProfile(
            name="qsv",
            codec="h264_qsv",
            preset="medium",
            extra_input_args=[],
            extra_video_args=[],
        )
    if name == "vaapi":
        # VAAPI braucht zusätzlich eine -vaapi_device-Angabe als Input-Arg
        # und ein hwupload+format=nv12 vor dem Scaler. Letzteres ist
        # variantenspezifisch und wird im Filter-Graph eingebaut, nicht hier.
        return EncoderProfile(
            name="vaapi",
            codec="h264_vaapi",
            preset="",  # VAAPI hat kein klassisches Preset; Quality via -qp
            extra_input_args=[
                "-vaapi_device", "/dev/dri/renderD128",
            ],
            extra_video_args=[],
        )
    # Software-Fallback
    return EncoderProfile(
        name="software",
        codec="libx264",
        preset="veryfast",
        extra_input_args=[],
        extra_video_args=[],
    )
