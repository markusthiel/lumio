"use client";

import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Adaptive Video-Player mit sichtbarer Filmstrip-Scrub-Leiste.
 *
 * Quellen:
 *   - HLS (.m3u8): Safari nativ, sonst hls.js dynamisch.
 *   - MP4: direkt als <video src> (Studio-Proofing nutzt die
 *     video_mp4-Rendition; HLS ist dort visitor-gebunden und nicht
 *     erreichbar). srcType wird aus der Endung abgeleitet, kann aber
 *     explizit gesetzt werden.
 *
 * Scrubbing (frühere Version: unsichtbare 20px-Zone blind über den
 * nativen Controls, Position „grob getunt", Sprite erst bei Hover
 * geladen → wirkte als ob nichts lädt):
 *   - Native Controls bleiben für Play/Pause/Lautstärke/Vollbild aktiv.
 *   - DARUNTER eine IMMER SICHTBARE Leiste: eine Reihe Sprite-Frames
 *     (die „Bilderleiste"), ein Playhead an der aktuellen Position und
 *     beim Überfahren ein großes Vorschau-Thumbnail + Zeit. Klick/Drag
 *     (Maus & Touch) springt im Video. Dadurch ist sofort sichtbar, wo
 *     gescrubbt wird.
 *   - Das Sprite-Sheet wird beim Mount vorgeladen, damit die erste
 *     Vorschau ohne Verzögerung erscheint.
 *   - Ohne Sprite (sehr kurze Videos) bleibt die Leiste als schlichte,
 *     sichtbare Seek-Spur erhalten.
 */
export interface SpriteSheet {
  url: string;
  interval: number;
  cols: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  frames: number;
}

const STRIP_HEIGHT = 46; // px — Höhe der Filmstrip-Leiste

export function VideoPlayer({
  src,
  poster,
  sprite,
  srcType,
  className,
}: {
  src: string;
  poster?: string | null;
  sprite?: SpriteSheet | null;
  /** Erzwingt den Quelltyp. Default: aus der Endung (.m3u8 → hls). */
  srcType?: "hls" | "mp4";
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  const [duration, setDuration] = useState<number>(0);
  const [current, setCurrent] = useState<number>(0);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [spriteReady, setSpriteReady] = useState(false);
  const [barWidth, setBarWidth] = useState<number>(0);

  // src normalisieren + Typ bestimmen
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
  const fullSrc = src.startsWith("http") ? src : `${apiUrl}${src}`;
  const kind: "hls" | "mp4" =
    srcType ?? (fullSrc.includes(".m3u8") ? "hls" : "mp4");

  // ---- Quelle anhängen -----------------------------------------------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (kind === "mp4") {
      video.src = fullSrc;
      return;
    }

    // HLS: Safari nativ
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = fullSrc;
      return;
    }
    // Sonst hls.js dynamisch
    let hls: import("hls.js").default | null = null;
    let cancelled = false;
    (async () => {
      const HlsMod = (await import("hls.js")).default;
      if (cancelled) return;
      if (!HlsMod.isSupported()) {
        video.src = fullSrc;
        return;
      }
      hls = new HlsMod({
        xhrSetup: (xhr) => {
          xhr.withCredentials = true;
        },
      });
      hls.loadSource(fullSrc);
      hls.attachMedia(video);
    })();
    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [fullSrc, kind]);

  // ---- Dauer + laufende Zeit -----------------------------------------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onMeta = () => setDuration(video.duration || 0);
    const onTime = () => setCurrent(video.currentTime || 0);
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("durationchange", onMeta);
    video.addEventListener("timeupdate", onTime);
    return () => {
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("durationchange", onMeta);
      video.removeEventListener("timeupdate", onTime);
    };
  }, []);

  // ---- Sprite vorladen (gegen "lädt nicht beim ersten Hover") --------------
  useEffect(() => {
    if (!sprite) {
      setSpriteReady(false);
      return;
    }
    setSpriteReady(false);
    const img = new Image();
    img.onload = () => setSpriteReady(true);
    img.onerror = () => setSpriteReady(false);
    img.src = sprite.url;
  }, [sprite]);

  // ---- Leistenbreite messen (für die Frame-Anzahl im Filmstrip) ------------
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const update = () => setBarWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- Scrub-Interaktion (Maus + Touch via Pointer Events) -----------------
  const timeAtClientX = useCallback(
    (clientX: number): { x: number; t: number } | null => {
      const el = barRef.current;
      if (!el || duration <= 0) return null;
      const rect = el.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const t = (x / rect.width) * duration;
      return { x, t };
    },
    [duration]
  );

  function seekTo(t: number) {
    const v = videoRef.current;
    if (v && Number.isFinite(t)) v.currentTime = t;
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const hit = timeAtClientX(e.clientX);
    if (!hit) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrubbing(true);
    setHover(hit);
    seekTo(hit.t);
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const hit = timeAtClientX(e.clientX);
    if (!hit) return;
    setHover(hit);
    if (scrubbing) seekTo(hit.t);
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    setScrubbing(false);
  }
  function onPointerLeave() {
    if (!scrubbing) setHover(null);
  }

  // ---- Sprite-Kachel-Helfer ------------------------------------------------
  function tileStyle(frame: number, w: number, h: number): React.CSSProperties {
    if (!sprite) return {};
    const f = Math.max(0, Math.min(sprite.frames - 1, frame));
    const col = f % sprite.cols;
    const row = Math.floor(f / sprite.cols);
    // Sheet so skalieren, dass eine Kachel exakt w×h füllt.
    return {
      backgroundImage: `url(${sprite.url})`,
      backgroundRepeat: "no-repeat",
      backgroundSize: `${sprite.cols * w}px ${sprite.rows * h}px`,
      backgroundPosition: `-${col * w}px -${row * h}px`,
    };
  }

  // Anzahl Filmstrip-Frames an die Breite anpassen (dezent, nicht zu dicht).
  const frameAspect =
    sprite && sprite.tileHeight > 0 ? sprite.tileWidth / sprite.tileHeight : 16 / 9;
  const stripTileW = STRIP_HEIGHT * frameAspect;
  const sampleCount =
    sprite && barWidth > 0
      ? Math.max(4, Math.min(sprite.frames, Math.round(barWidth / stripTileW)))
      : 0;

  const hoverTile =
    sprite && hover ? Math.floor(hover.t / sprite.interval) : -1;
  const progressPct = duration > 0 ? (current / duration) * 100 : 0;

  // Vorschau-Tooltip horizontal klemmen, damit er nicht aus der Leiste läuft.
  const previewW = sprite ? Math.min(180, sprite.tileWidth) : 0;
  const previewH = sprite
    ? Math.round(previewW / frameAspect)
    : 0;
  const clampedLeft =
    hover && barWidth > 0
      ? Math.max(previewW / 2 + 4, Math.min(barWidth - previewW / 2 - 4, hover.x))
      : 0;

  return (
    <div ref={containerRef} className={`relative flex flex-col ${className ?? ""}`}>
      <video
        ref={videoRef}
        controls
        playsInline
        poster={poster ?? undefined}
        className="w-full min-h-0 flex-1 bg-black"
      />

      {/* Sichtbare Filmstrip-Scrub-Leiste */}
      {duration > 0 && (
        <div className="relative select-none">
          {/* großes Vorschau-Thumbnail beim Überfahren */}
          {sprite && spriteReady && hover && hoverTile >= 0 && (
            <div
              className="absolute z-20 pointer-events-none flex flex-col items-center"
              style={{
                left: clampedLeft,
                bottom: STRIP_HEIGHT + 10,
                transform: "translateX(-50%)",
              }}
            >
              <div
                className="rounded-md shadow-xl border-2 border-white/80 overflow-hidden bg-black"
                style={{
                  width: previewW,
                  height: previewH,
                  ...tileStyle(hoverTile, previewW, previewH),
                }}
              />
              <div className="mt-1 text-[11px] font-mono text-white bg-black/85 px-1.5 py-0.5 rounded">
                {formatTime(hover.t)}
              </div>
            </div>
          )}

          {/* die Leiste selbst */}
          <div
            ref={barRef}
            className="relative w-full overflow-hidden rounded-md bg-neutral-900 cursor-pointer ring-1 ring-white/10"
            style={{ height: STRIP_HEIGHT, touchAction: "none" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={onPointerLeave}
            role="slider"
            aria-label="Video-Position"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(current)}
          >
            {/* Frame-Reihe (die „Bilderleiste") */}
            {sprite && spriteReady && sampleCount > 0 ? (
              <div className="absolute inset-0 flex">
                {Array.from({ length: sampleCount }, (_, i) => {
                  const frame = Math.round(
                    (i / Math.max(1, sampleCount - 1)) * (sprite.frames - 1)
                  );
                  const w = barWidth / sampleCount;
                  return (
                    <div
                      key={i}
                      className="h-full shrink-0 border-r border-black/40 last:border-r-0"
                      style={{ width: w, ...tileStyle(frame, w, STRIP_HEIGHT) }}
                    />
                  );
                })}
              </div>
            ) : (
              // Ohne Sprite: dezenter Farbverlauf, damit die Spur sichtbar ist
              <div className="absolute inset-0 bg-gradient-to-b from-neutral-800 to-neutral-900" />
            )}

            {/* abgespielter Bereich abdunkeln */}
            <div
              className="absolute inset-y-0 left-0 bg-black/45 pointer-events-none"
              style={{ width: `${progressPct}%` }}
            />
            {/* Playhead */}
            <div
              className="absolute inset-y-0 w-0.5 bg-white shadow pointer-events-none"
              style={{ left: `${progressPct}%` }}
            />
            {/* Hover-Linie */}
            {hover && (
              <div
                className="absolute inset-y-0 w-px bg-white/70 pointer-events-none"
                style={{ left: hover.x }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}
