"""
Lumio Worker — process_video

Video-Verarbeitung via ffmpeg:
  - poster:    Frame bei ~10 % der Laufzeit als JPEG
  - hls:       Adaptive Bitrate HLS (480p / 720p / 1080p, je nach Quelle)
               mit Master-Playlist + Segmenten — für Streaming im Browser
  - sprite:    Scrubbing-Sprite-Sheet (1 Frame alle 10s, 10×10 Kacheln)
  - video_mp4: Standalone-MP4 in 1080p (oder Quellauflösung wenn kleiner)
               für den Customer-Download als "Web-Version" — eine Datei,
               +faststart, libx264/HW je nach Encoder-Profil

Codec: H.264 + AAC. Encoder ist konfigurierbar via LUMIO_HW_ENCODER
(auto/nvenc/qsv/vaapi/software, default 'auto'). 'auto' probiert
Hardware in der Reihenfolge NVENC → QSV → VAAPI und fällt sonst auf
libx264 zurück — Self-Hoster ohne GPU müssen nichts konfigurieren.

Storage-Layout:
  renditions/poster.jpg
  renditions/hls/<file_id>/master.m3u8
  renditions/hls/<file_id>/v0/...  v1/...  v2/...
  renditions/sprite.jpg
  renditions/video_mp4.mp4

Wir tracken in der `renditions`-Tabelle den Hauptpfad pro kind:
  - 'poster'    → Poster-JPEG
  - 'hls'       → master.m3u8 (Browser fetcht den Rest relativ)
  - 'sprite'    → Sprite-JPEG
  - 'video_mp4' → standalone MP4 (Web-Download)
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
from hashing import sha256_file
from encoder_profile import profile_for
from rt import file_status as _publish_status
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
#
# Zwei Profile:
#   HLS_VARIANTS_STANDARD: 480p / 720p / 1080p — Default fuer alle Tenants
#   HLS_VARIANTS_4K:       + 1440p / 2160p — gegated durch Feature-Flag
#                          'video_streaming_4k'. Storage-Aufschlag erheblich:
#                          5 Min 2160p ~ 1.3 GB Bundle inkl. der niedrigeren
#                          Stufen. Super-Admin schaltet pro Tenant.
HLS_VARIANTS_STANDARD = [
    # (height, video_bitrate, audio_bitrate, name)
    (480,  "1000k",  "96k",  "v0"),
    (720,  "2500k",  "128k", "v1"),
    (1080, "5000k",  "192k", "v2"),
]

HLS_VARIANTS_4K = HLS_VARIANTS_STANDARD + [
    # 1440p (QHD): 16 Mbps reicht fuer h.264 Streaming. h.265 koennte das
    # bei ~50% Bitrate, aber Browser-Support fuer h.265 ist immer noch
    # luegnerisch (Safari ja, Chrome nur in HDR-Containern). h.264 bleibt
    # Kompatibilitaets-Default.
    (1440, "16000k", "192k", "v3"),
    # 2160p (4K UHD): 35 Mbps deckt 99% der Hochzeits-Cameras (typisch
    # 50-100 Mbps Source, das ist nicht streaming-tauglich). Wer wirklich
    # die Source-Bitrate als HLS will, muss Download anbieten — HLS ist
    # streaming, nicht Archiv.
    (2160, "35000k", "192k", "v4"),
]

# Legacy: vorhandener Code referenziert HLS_VARIANTS — wir behalten den
# Namen als Alias auf STANDARD damit nichts bricht. _make_hls waehlt jetzt
# dynamisch.
HLS_VARIANTS = HLS_VARIANTS_STANDARD

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
            _publish_status(file_row["gallery_id"], file_id, "failed")
        except Exception:
            pass
        raise self.retry(exc=err)
    except Exception as err:
        log.exception("process_video.failed", file_id=file_id)
        try:
            mark_file_failed(file_id, str(err))
            _publish_status(file_row["gallery_id"], file_id, "failed")
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

        # SHA-256 vom Video-Original — vor allem aufwendigem Probing
        # und Transcoding, damit ein Fehler dort den Hash nicht
        # verhindert. Bei groesseren Videos (mehrere GB) dauert das
        # ein paar Sekunden, ist aber gegenueber HLS-Transcoding
        # vernachlaessigbar.
        src_sha = sha256_file(str(src_path))

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
            tenant_id=tenant_id,
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
            sprite_meta = _make_sprite(src_path, sprite_path, duration)
            if sprite_meta is not None and sprite_path.exists():
                sprite_key = rendition_key(
                    tenant_id, gallery_id, file_id, "sprite", "jpg"
                )
                sprite_size = upload_file(
                    str(sprite_path), sprite_key, "image/jpeg"
                )
                upsert_rendition(
                    file_id=file_id, kind="sprite",
                    storage_key=sprite_key, fmt="jpeg",
                    width=sprite_meta["cols"] * sprite_meta["tileWidth"],
                    height=sprite_meta["rows"] * sprite_meta["tileHeight"],
                    size_bytes=sprite_size,
                    metadata=sprite_meta,
                )

        # 5) Web-MP4 — downloadbare Variante als 'Web-Version'. Eine
        #    einzelne MP4-Datei (nicht HLS-Segmente), 1080p oder
        #    Quellauflösung wenn kleiner, AAC-Audio, +faststart damit
        #    der Browser beim Klick sofort streamt statt erst alles
        #    runterzuziehen.
        #
        # Wichtig: wir erzeugen NUR dann eine Web-MP4 wenn sie auch
        # tatsächlich kleiner ist als das Original. Wenn die Quelle
        # schon kompakt komprimiert ist (z.B. 720p mit niedriger
        # Bitrate), würden wir mit unserem fixen 2800k/5000k-Target
        # eine GRÖSSERE Datei produzieren — das wäre für den Customer
        # irreführend ("Web-Version" sollte klein sein). In dem Fall
        # überspringen wir die Rendition; die API liefert dann beim
        # Download "Web" einen 404 zurück und das Frontend versteckt
        # den Button.
        src_bitrate_kbps = _estimate_bitrate_kbps(
            file_bytes=src_path.stat().st_size,
            duration_s=duration,
        )
        target_h = min(1080, height) if height > 0 else 1080
        target_video_kbps = _web_mp4_video_bitrate_kbps(target_h)
        # Audio (128k bei has_audio, sonst 0) zur Output-Gesamtbitrate
        target_total_kbps = target_video_kbps + (128 if has_audio else 0)

        if src_bitrate_kbps > 0 and target_total_kbps >= src_bitrate_kbps:
            log.info(
                "process_video.web_mp4_skipped",
                file_id=file_id,
                reason="source_already_compact",
                src_kbps=src_bitrate_kbps,
                target_kbps=target_total_kbps,
            )
        else:
            web_mp4_path = tmpdir / "web.mp4"
            try:
                _make_web_mp4(
                    src_path=src_path, out_path=web_mp4_path,
                    target_height=target_h, has_audio=has_audio,
                )
                if web_mp4_path.exists():
                    mp4_key = rendition_key(
                        tenant_id, gallery_id, file_id, "video_mp4", "mp4"
                    )
                    mp4_size = upload_file(
                        str(web_mp4_path), mp4_key, "video/mp4"
                    )
                    # Wir kennen die exakte Höhe der Ausgabe nicht ohne
                    # Re-Probe — target_h ist eine gute Approximation
                    # (ffmpeg hat scale=-2:target_h, also wird die Höhe
                    # exakt target_h sein).
                    upsert_rendition(
                        file_id=file_id, kind="video_mp4",
                        storage_key=mp4_key, fmt="mp4",
                        width=0, height=target_h,
                        size_bytes=mp4_size,
                    )
            except Exception as err:
                # Web-MP4-Fehler ist nicht fatal — HLS + Original
                # funktionieren weiter. Wir loggen und gehen weiter.
                log.warn("process_video.web_mp4_failed",
                         file_id=file_id, err=str(err))

        # 6) Status auf ready, Dimensions des Source-Videos
        mark_file_ready(file_id, width, height, sha256=src_sha)
        _publish_status(gallery_id, file_id, "ready",
                        width=width, height=height)
        log.info("process_video.complete", file_id=file_id, sha256=src_sha)


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
              has_audio: bool, tenant_id: str) -> None:
    """Erzeugt eine Master-Playlist + variant Playlists. Wir verwenden
    den eingebauten hls-Muxer von ffmpeg mit `var_stream_map`.

    Variant-Auswahl:
      - Default: HLS_VARIANTS_STANDARD (480p / 720p / 1080p)
      - Tenant mit Feature-Flag 'video_streaming_4k' aktiv:
        + 1440p (QHD) + 2160p (4K UHD) — werden nur erzeugt wenn die
        Source mindestens diese Hoehe hat (kein Upscaling).

    Encoder-Auswahl: software (libx264, default) oder Hardware (NVENC, QSV,
    VAAPI) je nach LUMIO_HW_ENCODER-Env. Bei Hardware-Encodern haben wir
    je nach Codec leicht andere Filter- und Encoder-Args, aber die HLS-
    Muxer-Args bleiben identisch.
    """
    out_dir.mkdir(parents=True, exist_ok=True)

    # Variant-Set je nach Tenant-Feature-Flag
    from feature_flags import is_feature_enabled  # lazy import vermeidet
    # Worker-Boot-Reihenfolge-Probleme
    if is_feature_enabled(tenant_id, "video_streaming_4k"):
        variants_pool = HLS_VARIANTS_4K
    else:
        variants_pool = HLS_VARIANTS_STANDARD

    # Welche Varianten machen wir? Nichts upscalen.
    chosen = [v for v in variants_pool if v[0] <= source_height]
    if not chosen:
        chosen = [variants_pool[0]]

    # Wir nehmen das Profil der ersten (also höchsten) Variante als Vorlage,
    # weil hwaccel-Init für ALLE Varianten gemeinsam läuft. Codec/Preset
    # können sich theoretisch pro Variante unterscheiden, in der Praxis
    # haben aber alle Stufen denselben Encoder.
    prof = profile_for(chosen[0][0])
    log.info("process_video.encoder_selected", name=prof.name, codec=prof.codec)

    # ffmpeg-Argumente bauen
    cmd: list[str] = ["ffmpeg", "-y"]
    cmd += prof.extra_input_args
    cmd += ["-i", str(src_path)]

    # filter_complex: split → scale pro Variante.
    # VAAPI muss vor dem Scale ein hwupload + format=nv12 machen.
    splits = "".join(f"[v{i}]" for i in range(len(chosen)))
    filter_complex = f"[0:v]split={len(chosen)}{splits};"
    for i, (h, _vbr, _abr, _name) in enumerate(chosen):
        if prof.name == "vaapi":
            # Auf der GPU skalieren — viel schneller als CPU-scale
            filter_complex += (
                f"[v{i}]format=nv12,hwupload,"
                f"scale_vaapi=-2:{h}[v{i}out];"
            )
        else:
            filter_complex += f"[v{i}]scale=-2:{h}[v{i}out];"
    filter_complex = filter_complex.rstrip(";")
    cmd += ["-filter_complex", filter_complex]

    # Per Variante: map + codec + bitrate
    var_stream_map_parts: list[str] = []
    for i, (h, vbr, abr, name) in enumerate(chosen):
        cmd += [
            "-map", f"[v{i}out]",
            f"-c:v:{i}", prof.codec,
        ]
        if prof.preset:
            cmd += [f"-preset:v:{i}", prof.preset]
        cmd += [
            f"-b:v:{i}", vbr,
            f"-maxrate:v:{i}", str(int(_kbps_to_int(vbr) * 1.07)) + "k",
            f"-bufsize:v:{i}", str(int(_kbps_to_int(vbr) * 1.5)) + "k",
            f"-g:v:{i}", "48",
            f"-keyint_min:v:{i}", "48",
        ]
        # sc_threshold gibt's nur bei libx264; NVENC/QSV/VAAPI ignorieren
        # bzw. brechen damit ab
        if prof.name == "software":
            # H.264-Profile dynamisch: 'main' reicht bis 1080p, ab 1440p+
            # erzeugt 'high' bei gleicher Bitrate spuerbar bessere Qualitaet
            # (bessere Entropy-Coding-Tools). 'main' wuerde bei 4K mit den
            # vorgesehenen 35 Mbps schwitzen.
            h264_profile = "high" if h >= 1440 else "main"
            cmd += [
                f"-profile:v:{i}", h264_profile,
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

    log.info("process_video.hls_start",
             variants=len(chosen), encoder=prof.name)
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
def _make_sprite(src: Path, dest: Path, duration_s: float) -> dict | None:
    """Sprite-Sheet: 1 Frame alle interval Sekunden, 160px breit, gekachelt
    bis zu 10×10. Gibt ein Metadaten-Dict zurück, das der Player für
    Scrubbing braucht, oder None bei ffmpeg-Fehler.

    Schema:
      { "interval": float (Sekunden zwischen Frames),
        "cols": int, "rows": int,
        "tileWidth": int, "tileHeight": int,
        "frames": int (tatsächlich enthaltene Frames, <= cols*rows) }
    """
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
        return None  # Sprite ist optional — nicht den ganzen Job killen

    if not dest.exists():
        return None

    # Tile-Höhe aus dem fertigen Sprite ablesen (ffmpeg-scale ":-2"
    # gibt das Aspect-Ratio her, das wir vorher nicht exakt kennen)
    try:
        out = subprocess.check_output(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height",
             "-of", "csv=p=0:s=x", str(dest)],
            text=True,
        ).strip()
        sheet_w, sheet_h = (int(x) for x in out.split("x"))
        tile_h = sheet_h // SPRITE_TILE_ROWS
    except Exception as err:
        log.warning("process_video.sprite_probe_failed", err=str(err))
        return None

    # Anzahl tatsächlich befüllter Frames — bei kurzen Videos rest leer
    frames = min(max_tiles, max(1, int(duration_s // interval)))

    return {
        "interval": round(interval, 3),
        "cols": SPRITE_TILE_COLS,
        "rows": SPRITE_TILE_ROWS,
        "tileWidth": SPRITE_TILE_W,
        "tileHeight": tile_h,
        "frames": frames,
    }


# ---------------------------------------------------------------------------
# Web-MP4 (downloadbare Variante)
# ---------------------------------------------------------------------------
def _make_web_mp4(
    *, src_path: Path, out_path: Path,
    target_height: int, has_audio: bool,
) -> None:
    """Erzeugt eine einzelne MP4-Datei in 1080p (oder Quellauflösung
    wenn niedriger). Wird als 'Web-Version' zum Download angeboten —
    Kunden bekommen damit eine deutlich kleinere Datei als das Original,
    die im Browser direkt abspielbar ist und überall hin geteilt werden
    kann.

    Wichtige Unterschiede zur HLS-Pipeline:
      - Single-File, keine Segmente (nicht für adaptives Streaming)
      - +faststart Flag (moov-atom an den Anfang) → Browser startet
        sofort beim Klick statt zu warten bis alles geladen ist
      - Bitrate konservativ (~5 Mbit/s bei 1080p) — Tradeoff zwischen
        Dateigröße und sichtbarer Qualität. Bei niedriger aufgelöstem
        Source skalieren wir die Bitrate runter.
      - yuv420p, weil's überall abgespielt wird (auch Quicktime, ältere
        Browser, Mobile)

    Encoder via select_encoder() wie bei HLS — Hardware wenn verfügbar.
    """
    profile = profile_for(target_height)

    # Bitrate-Mapping: zentral im Helper, damit der "skip-wenn-source-
    # schon-klein"-Check oben in _process die gleiche Tabelle nutzen
    # kann und nicht out-of-sync läuft.
    v_bitrate_kbps = _web_mp4_video_bitrate_kbps(target_height)
    v_bitrate = f"{v_bitrate_kbps}k"

    args: list[str] = [
        "ffmpeg", "-hide_banner", "-loglevel", "warning", "-y",
        *profile.extra_input_args,
        "-i", str(src_path),
    ]

    # Filter-Graph: skalieren auf target_height (breite mit -2 → gerade,
    # Aspect-Ratio bleibt). Bei VAAPI brauchen wir hwupload+format=nv12,
    # weil der Encoder GPU-Memory erwartet.
    if profile.name == "vaapi":
        vf = (
            f"scale_vaapi=w=-2:h={target_height}:format=nv12"
        )
    else:
        vf = f"scale=-2:{target_height}:flags=lanczos,format=yuv420p"

    args += ["-vf", vf]

    # Video-Codec + Preset + Bitrate
    args += ["-c:v", profile.codec]
    if profile.preset:
        # NVENC nutzt -preset für p1..p7, libx264 ebenso. VAAPI hat
        # kein klassisches Preset (profile.preset ist leer).
        args += ["-preset", profile.preset]
    args += [
        "-b:v", v_bitrate,
        "-maxrate", v_bitrate,
        "-bufsize", _double_bitrate(v_bitrate),
    ]
    args += profile.extra_video_args

    # Audio
    if has_audio:
        args += [
            "-c:a", "aac",
            "-b:a", "128k",
            "-ac", "2",
        ]
    else:
        args += ["-an"]

    # Container-Tuning für Web-Playback
    args += [
        "-movflags", "+faststart",
        "-pix_fmt", "yuv420p" if profile.name != "vaapi" else "nv12",
        str(out_path),
    ]

    log.info("process_video.web_mp4.start",
             encoder=profile.name, target_height=target_height,
             bitrate=v_bitrate)

    subprocess.run(args, check=True)


def _double_bitrate(rate: str) -> str:
    """ '5000k' -> '10000k' — bufsize wird typischerweise als 2× bitrate
    gesetzt damit kurze Spitzen abgefedert werden."""
    if rate.endswith("k"):
        return f"{int(rate[:-1]) * 2}k"
    if rate.endswith("M"):
        return f"{int(rate[:-1]) * 2}M"
    return rate


def _web_mp4_video_bitrate_kbps(target_height: int) -> int:
    """Bitrate-Tabelle für die Web-MP4. Entspricht in etwa der HLS-Top-
    Variante für die jeweilige Höhe, leicht großzügiger weil's eine
    Download-Datei ist und der Browser nicht adaptive switchen kann.

    Eine reine Funktion damit der "skip-wenn-source-schon-klein"-Check
    in _process die gleiche Tabelle nutzt wie der eigentliche
    Encoding-Aufruf. Sonst läuft beides out-of-sync sobald jemand die
    Bitrates anpasst.
    """
    if target_height >= 1080:
        return 5000
    if target_height >= 720:
        return 2800
    return 1400


def _estimate_bitrate_kbps(*, file_bytes: int, duration_s: float) -> int:
    """Schätzt die Average-Bitrate eines Videos aus Dateigröße + Dauer.

    Wir nutzen das statt ffprobe's 'bit_rate'-Feld, weil das nicht
    immer im Format-Header steht (besonders bei manchen MOV/MKV-
    Containern) und wenn doch, dann teilweise nur den Video-Stream
    misst, nicht das Container-Total.

    Rückgabe 0 wenn duration unbekannt — Caller behandelt das als
    "Bitrate-Check übersprungen, immer encodieren".
    """
    if duration_s <= 0:
        return 0
    # bits / sec → kbit/s
    return int((file_bytes * 8) / duration_s / 1000)
