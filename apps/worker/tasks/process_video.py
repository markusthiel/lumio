"""
Lumio Worker — process_video

Video-Verarbeitung via ffmpeg:
  - poster:   Frame bei ~10 % der Laufzeit als JPEG
  - hls:      Adaptive Bitrate HLS (480p / 720p / 1080p, je nach Quelle)
              mit Master-Playlist + Segmenten
  - sprite:   Scrubbing-Sprite-Sheet (1 Frame alle 10s, 10×10 Kacheln)

Codec: libx264 + AAC. Hardware-Beschleunigung (NVENC/QSV/VAAPI) ist in
einem späteren Sprint geplant; das CPU-Encoding ist überall portabel.

Storage-Layout:
  renditions/poster.jpg
  renditions/hls/<file_id>/master.m3u8
  renditions/hls/<file_id>/v0/...  v1/...  v2/...
  renditions/sprite.jpg

Wir tracken in der `renditions`-Tabelle nur den Hauptpfad pro kind:
  - 'poster'  → Poster-JPEG
  - 'hls'     → master.m3u8 (Browser fetcht den Rest relativ)
  - 'sprite'  → Sprite-JPEG
"""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path

import structlog

from app import app
from db import fetch_file, mark_file_ready, mark_file_failed, upsert_rendition
from storage import (
    download_to_file,
    upload_file,
    rendition_key,
    get_s3_client,
    get_bucket,
)


log = structlog.get_logger(__name__)


# HLS-Varianten — werden nur erzeugt, wenn das Source-Video mindestens diese
# Höhe hat. So vermeiden wir Upscaling (sieht schlecht aus und macht das
# File größer als das Original).
HLS_VARIANTS = [
    # (height, video_bitrate, audio_bitrate, name)
    (480, "1000k", "96k", "v0"),
    (720, "2500k", "128k", "v1"),
    (1080, "5000k", "192k", "v2"),
]

POSTER_QUALITY = 90  # ffmpeg JPEG-Qualität (1-31, niedriger = besser)
SPRITE_INTERVAL_S = 10
SPRITE_TILE_W = 160
SPRITE_TILE_COLS = 10
SPRITE_TILE_ROWS = 10  # max 100 Tiles → max 1000s = 16:40 abgedeckt


@app.task(
    name="tasks.process_video.transcode",
    bind=True,
    max_retries=1,
    default_retry_delay=120,
)
def transcode_video(self, file_id: str) -> dict:
    log.info("process_video.start", file_id=file_id)

    file_row = fetch_file(file_id)
    if not file_row:
        log.warning("process_video.file_missing", file_id=file_id)
        return {"file_id": file_id, "status": "missing"}

    try:
        _process(file_row)
        return {"file_id": file_id, "status": "ready"}
    except subprocess.CalledProcessError as err:
        msg = f"ffmpeg failed: {err.returncode}"
        log.exception("process_video.ffmpeg_failed", file_id=file_id)
        try:
            mark_file_failed(file_id, msg)
        except Exception:
            pass
        raise self.retry(exc=err)
    except Exception as err:
        log.exception("process_video.failed", file_id=file_id)
        try:
            mark_file_failed(file_id, str(err))
        except Exception:
            pass
        raise self.retry(exc=err)


def _process(file_row: dict) -> None:
    file_id = file_row["id"]
    tenant_id = file_row["tenant_id"]
    gallery_id = file_row["gallery_id"]
    storage_key = file_row["storage_key"]

    with tempfile.TemporaryDirectory(prefix="lumio_vid_") as tmp:
        tmpdir = Path(tmp)
        src_path = tmpdir / "source"
        download_to_file(storage_key, str(src_path))
        log.info("process_video.downloaded",
                 file_id=file_id, size=src_path.stat().st_size)

        # 1) Probing
        info = _probe(src_path)
        duration = info["duration_s"]
        width = info["width"]
        height = info["height"]
        has_audio = info["has_audio"]
        log.info("process_video.probed", file_id=file_id,
                 duration=duration, width=width, height=height,
                 audio=has_audio)

        # 2) Poster
        _make_poster(
            src_path,
            tmpdir / "poster.jpg",
            timestamp_s=max(0.1, duration * 0.1),
        )
        poster_key = rendition_key(
            tenant_id, gallery_id, file_id, "poster", "jpg"
        )
        poster_size = upload_file(
            str(tmpdir / "poster.jpg"), poster_key, "image/jpeg"
        )
        upsert_rendition(
            file_id=file_id, kind="poster", storage_key=poster_key,
            fmt="jpeg", width=None, height=None, size_bytes=poster_size,
        )

        # Poster duplizieren als "thumb" + "preview" damit die Grid-Ansicht
        # und Lightbox sofort etwas zu zeigen haben. Wir resizen mit pyvips.
        _publish_video_image_renditions(
            poster_jpg=tmpdir / "poster.jpg",
            tenant_id=tenant_id, gallery_id=gallery_id, file_id=file_id,
            tmpdir=tmpdir,
        )

        # 3) HLS — adaptive bitrate
        _make_hls(
            src_path=src_path,
            out_dir=tmpdir / "hls",
            source_height=height,
            has_audio=has_audio,
        )
        # Alle HLS-Dateien einzeln nach S3 hochladen (master.m3u8 +
        # variant playlists + segments). Wir behalten die Struktur bei.
        master_key = _upload_hls_tree(
            tmpdir / "hls",
            tenant_id=tenant_id, gallery_id=gallery_id, file_id=file_id,
        )
        # Master-m3u8 ist der "Eintrag" — wir tracken diesen Key als hls-Rendition
        upsert_rendition(
            file_id=file_id, kind="hls", storage_key=master_key,
            fmt="m3u8", width=width, height=height,
            size_bytes=0,  # Größe ist nicht aussagekräftig (verteiltes Bundle)
        )

        # 4) Sprite-Sheet — optional, nur wenn Video lang genug
        if duration >= SPRITE_INTERVAL_S * 2:
            sprite_path = tmpdir / "sprite.jpg"
            _make_sprite(src_path, sprite_path, duration)
            if sprite_path.exists():
                sprite_key = rendition_key(
                    tenant_id, gallery_id, file_id, "sprite", "jpg"
                )
                sprite_size = upload_file(
                    str(sprite_path), sprite_key, "image/jpeg"
                )
                upsert_rendition(
                    file_id=file_id, kind="sprite",
                    storage_key=sprite_key, fmt="jpeg",
                    width=None, height=None, size_bytes=sprite_size,
                )

        # 5) Status auf ready, Dimensions des Source-Videos
        mark_file_ready(file_id, width, height)
        log.info("process_video.complete", file_id=file_id)


# ---------------------------------------------------------------------------
# ffprobe
# ---------------------------------------------------------------------------
def _probe(path: Path) -> dict:
    """Gibt {duration_s, width, height, has_audio} zurück."""
    result = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_format", "-show_streams",
            "-of", "json", str(path),
        ],
        capture_output=True, text=True, check=True,
    )
    data = json.loads(result.stdout)
    streams = data.get("streams", [])
    fmt = data.get("format", {})

    video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)

    duration_s = float(fmt.get("duration", "0"))
    width = int(video_stream.get("width", 0)) if video_stream else 0
    height = int(video_stream.get("height", 0)) if video_stream else 0

    return {
        "duration_s": duration_s,
        "width": width,
        "height": height,
        "has_audio": audio_stream is not None,
    }


# ---------------------------------------------------------------------------
# Poster
# ---------------------------------------------------------------------------
def _make_poster(src: Path, dest: Path, timestamp_s: float) -> None:
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-ss", f"{timestamp_s:.2f}",
            "-i", str(src),
            "-frames:v", "1",
            "-q:v", "3",
            "-loglevel", "error",
            str(dest),
        ],
        check=True,
    )


def _publish_video_image_renditions(
    *, poster_jpg: Path, tenant_id: str, gallery_id: str,
    file_id: str, tmpdir: Path,
) -> None:
    """Aus dem Poster machen wir thumb (400px), preview (1600px), web (2560px)
    als WebPs, damit Video-Tiles in der Galerie wie Bilder erscheinen."""
    from imaging import render_webp_sizes

    SPECS = [("thumb", 400, 75), ("preview", 1600, 82), ("web", 2560, 85)]

    def _persist(kind: str, out_path: str, w: int, h: int) -> None:
        key = rendition_key(tenant_id, gallery_id, file_id, kind, "webp")
        size = upload_file(out_path, key, "image/webp")
        upsert_rendition(
            file_id=file_id, kind=kind, storage_key=key, fmt="webp",
            width=w, height=h, size_bytes=size,
        )

    # autorotate=False, weil der Poster-Frame aus ffmpeg eh schon korrekt
    # orientiert ist (ffmpeg respektiert Video-Rotation via Display Matrix).
    render_webp_sizes(
        src_path=poster_jpg, specs=SPECS, out_dir=tmpdir,
        on_rendition=_persist, autorotate=False,
    )


# ---------------------------------------------------------------------------
# HLS
# ---------------------------------------------------------------------------
def _make_hls(*, src_path: Path, out_dir: Path, source_height: int,
              has_audio: bool) -> None:
    """Erzeugt eine Master-Playlist + variant Playlists. Wir verwenden
    den eingebauten hls-Muxer von ffmpeg mit `var_stream_map`."""
    out_dir.mkdir(parents=True, exist_ok=True)

    # Welche Varianten machen wir? Nichts upscalen.
    chosen = [v for v in HLS_VARIANTS if v[0] <= source_height]
    if not chosen:
        # Sehr kleines Quellvideo — wir machen wenigstens eine 480p-Variante
        chosen = [HLS_VARIANTS[0]]

    # ffmpeg-Argumente bauen
    cmd: list[str] = ["ffmpeg", "-y", "-i", str(src_path)]

    # filter_complex: split → scale pro Variante
    splits = "".join(f"[v{i}]" for i in range(len(chosen)))
    filter_complex = f"[0:v]split={len(chosen)}{splits};"
    for i, (h, _vbr, _abr, _name) in enumerate(chosen):
        filter_complex += f"[v{i}]scale=-2:{h}[v{i}out];"
    filter_complex = filter_complex.rstrip(";")
    cmd += ["-filter_complex", filter_complex]

    # Per Variante: map + codec + bitrate
    var_stream_map_parts: list[str] = []
    for i, (h, vbr, abr, name) in enumerate(chosen):
        cmd += [
            "-map", f"[v{i}out]",
            f"-c:v:{i}", "libx264",
            f"-preset:v:{i}", "veryfast",
            f"-profile:v:{i}", "main",
            f"-b:v:{i}", vbr,
            f"-maxrate:v:{i}", str(int(_kbps_to_int(vbr) * 1.07)) + "k",
            f"-bufsize:v:{i}", str(int(_kbps_to_int(vbr) * 1.5)) + "k",
            f"-g:v:{i}", "48",
            f"-keyint_min:v:{i}", "48",
            f"-sc_threshold:v:{i}", "0",
        ]
        stream_part = f"v:{i}"
        if has_audio:
            cmd += ["-map", "0:a:0", f"-c:a:{i}", "aac",
                    f"-b:a:{i}", abr, f"-ac:{i}", "2"]
            stream_part += f",a:{i}"
        stream_part += f",name:{name}"
        var_stream_map_parts.append(stream_part)

    cmd += [
        "-f", "hls",
        "-hls_time", "6",
        "-hls_playlist_type", "vod",
        "-hls_segment_filename",
        str(out_dir / "%v" / "seg_%03d.ts"),
        "-master_pl_name", "master.m3u8",
        "-var_stream_map", " ".join(var_stream_map_parts),
        "-loglevel", "error",
        str(out_dir / "%v" / "index.m3u8"),
    ]

    log.info("process_video.hls_start", variants=len(chosen))
    subprocess.run(cmd, check=True)


def _kbps_to_int(s: str) -> int:
    """ '2500k' → 2500 """
    return int(s.rstrip("kK"))


def _upload_hls_tree(local_dir: Path, *, tenant_id: str,
                     gallery_id: str, file_id: str) -> str:
    """Lädt das gesamte HLS-Verzeichnis nach S3. Gibt den Storage-Key
    der master.m3u8 zurück."""
    s3 = get_s3_client()
    bucket = get_bucket()
    base = f"t/{tenant_id}/g/{gallery_id}/r/{file_id}/hls"

    master_key = f"{base}/master.m3u8"
    for path in sorted(local_dir.rglob("*")):
        if path.is_dir():
            continue
        rel = path.relative_to(local_dir).as_posix()
        key = f"{base}/{rel}"
        content_type = (
            "application/vnd.apple.mpegurl" if path.suffix == ".m3u8"
            else "video/MP2T" if path.suffix == ".ts"
            else "application/octet-stream"
        )
        s3.upload_file(
            str(path), bucket, key,
            ExtraArgs={"ContentType": content_type},
        )

    return master_key


# ---------------------------------------------------------------------------
# Sprite
# ---------------------------------------------------------------------------
def _make_sprite(src: Path, dest: Path, duration_s: float) -> None:
    """Sprite-Sheet: 1 Frame alle SPRITE_INTERVAL_S Sekunden,
    160px breit, gekachelt 10×10."""
    max_tiles = SPRITE_TILE_COLS * SPRITE_TILE_ROWS
    interval = max(SPRITE_INTERVAL_S, duration_s / max_tiles)
    fps_expr = f"1/{interval:.4f}"

    vf = (
        f"fps={fps_expr},"
        f"scale={SPRITE_TILE_W}:-2,"
        f"tile={SPRITE_TILE_COLS}x{SPRITE_TILE_ROWS}"
    )
    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", str(src),
                "-vf", vf,
                "-frames:v", "1",
                "-q:v", "4",
                "-loglevel", "error",
                str(dest),
            ],
            check=True,
        )
    except subprocess.CalledProcessError:
        log.warning("process_video.sprite_failed")
        # Sprite ist optional — nicht den ganzen Job killen
