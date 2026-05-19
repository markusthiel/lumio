"""
Lumio Worker — process_video

Video-Verarbeitung via ffmpeg:
  - Poster-Frame (10% Laufzeit) als JPEG
  - HLS Adaptive Bitrate Streaming (480p / 720p / 1080p, optional 4K)
  - Scrubbing-Sprite-Sheet (alle 10 Sek ein Frame)

Hardware-Beschleunigung via NVENC (NVIDIA), QSV (Intel) oder VAAPI (AMD/Intel)
wird automatisch detektiert, wenn der Container Zugriff auf /dev/dri hat.
"""
from __future__ import annotations

import subprocess

import structlog
from app import app

log = structlog.get_logger(__name__)


HLS_VARIANTS = [
    # (height, video_bitrate, audio_bitrate)
    (480, "1000k", "96k"),
    (720, "2500k", "128k"),
    (1080, "5000k", "192k"),
]


@app.task(name="tasks.process_video.transcode", bind=True, max_retries=2)
def transcode_video(self, file_id: str) -> dict:
    """Vollständige Video-Pipeline: Poster + HLS + Sprite."""
    log.info("process_video.start", file_id=file_id)

    # TODO:
    #   1. Original aus S3 laden
    #   2. ffprobe → Dauer, Auflösung, Codec
    #   3. Poster: ffmpeg -ss 10% -i src -frames:v 1 -q:v 2 poster.jpg
    #   4. HLS: ffmpeg -i src \
    #          -filter_complex "[0:v]split=3[v1][v2][v3]; \
    #                          [v1]scale=-2:480[v1out]; ... " \
    #          -map [v1out] -b:v:0 1000k -c:v:0 libx264 -preset veryfast \
    #          ... \
    #          -hls_time 6 -hls_playlist_type vod -master_pl_name master.m3u8
    #   5. Sprite: ffmpeg -i src -vf "fps=1/10,scale=160:-1,tile=10x10" sprite.jpg
    #   6. Alles nach S3, Rendition-Records anlegen

    return {"file_id": file_id, "status": "stub"}


def detect_hw_acceleration() -> str | None:
    """Detektiert verfügbare HW-Beschleunigung via ffmpeg -hwaccels."""
    try:
        result = subprocess.run(
            ["ffmpeg", "-hide_banner", "-hwaccels"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        accels = result.stdout.lower()
        for accel in ("cuda", "qsv", "vaapi", "videotoolbox"):
            if accel in accels:
                return accel
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass
    return None
