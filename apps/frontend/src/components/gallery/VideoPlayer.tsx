"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Adaptive Video-Player mit sichtbarer Filmstrip-Scrub-Leiste,
 * Zeit-Markern und optionalem Annotation-Overlay.
 *
 * Quellen:
 *   - HLS (.m3u8): Safari nativ, sonst hls.js dynamisch.
 *   - MP4: direkt als <video src> (Studio nutzt die video_mp4-Rendition;
 *     HLS ist dort visitor-gebunden). srcType wird aus der Endung
 *     abgeleitet, kann aber explizit gesetzt werden.
 *
 * Scrubbing: native Controls bleiben für Play/Pause/Lautstärke/Vollbild,
 * darunter eine IMMER sichtbare Filmstrip-Leiste (Sprite-Frames) mit
 * Playhead und großer Hover-Vorschau. Sprite wird vorgeladen.
 *
 * Marker: `markers` rendert Ticks auf der Leiste (z.B. Kommentar-
 * Markierungen). Klick → onMarkerClick.
 *
 * Annotation: `overlay` wird passgenau über die SICHTBARE Videofläche
 * gelegt (Content-Rect, letterbox-korrekt berechnet). Damit landen
 * normalisierte [0..1]-Koordinaten exakt auf dem Frame. Über das
 * Imperative-Handle (ref) kann der Parent pausieren/springen.
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

export interface VideoMarkerTick {
  id: string;
  t: number;
  /** CSS-Farbe des Ticks. Default: weiß. */
  color?: string;
}

export interface VideoPlayerHandle {
  seekTo(t: number): void;
  pause(): void;
  play(): void;
  getCurrentTime(): number;
  isPaused(): boolean;
}

const STRIP_HEIGHT = 46; // px — Höhe der Filmstrip-Leiste

export interface VideoPlayerProps {
  src: string;
  poster?: string | null;
  sprite?: SpriteSheet | null;
  /** Erzwingt den Quelltyp. Default: aus der Endung (.m3u8 → hls). */
  srcType?: "hls" | "mp4";
  className?: string;
  /** Zeit-Ticks auf der Scrub-Leiste. */
  markers?: VideoMarkerTick[];
  /** Hervorgehobener Tick. */
  activeMarkerId?: string | null;
  onMarkerClick?: (id: string) => void;
  /** Overlay passgenau über der sichtbaren Videofläche (z.B. das
   *  AnnotationOverlay). */
  overlay?: ReactNode;
  /** Ob das Overlay Pointer-Events fängt. false (Default) ⇒ das Overlay
   *  ist durchklickbar, die nativen Video-Controls bleiben bedienbar.
   *  true nur beim aktiven Zeichnen. */
  overlayInteractive?: boolean;
  onTimeUpdate?: (t: number) => void;
  onPlayingChange?: (playing: boolean) => void;
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer(
    {
      src,
      poster,
      sprite,
      srcType,
      className,
      markers,
      activeMarkerId,
      onMarkerClick,
      overlay,
      overlayInteractive,
      onTimeUpdate,
      onPlayingChange,
    },
    ref
  ) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const mediaRef = useRef<HTMLDivElement | null>(null);
    const barRef = useRef<HTMLDivElement | null>(null);

    const [duration, setDuration] = useState<number>(0);
    const [current, setCurrent] = useState<number>(0);
    const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
    const [scrubbing, setScrubbing] = useState(false);
    const [spriteReady, setSpriteReady] = useState(false);
    const [barWidth, setBarWidth] = useState<number>(0);
    const [natural, setNatural] = useState<{ w: number; h: number } | null>(
      null
    );
    const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
    const fullSrc = src.startsWith("http") ? src : `${apiUrl}${src}`;
    const kind: "hls" | "mp4" =
      srcType ?? (fullSrc.includes(".m3u8") ? "hls" : "mp4");

    // ---- Imperative Handle -------------------------------------------------
    useImperativeHandle(
      ref,
      () => ({
        seekTo(t: number) {
          const v = videoRef.current;
          if (v && Number.isFinite(t))
            v.currentTime = Math.max(0, Math.min(v.duration || t, t));
        },
        pause() {
          videoRef.current?.pause();
        },
        play() {
          void videoRef.current?.play();
        },
        getCurrentTime() {
          return videoRef.current?.currentTime ?? 0;
        },
        isPaused() {
          return videoRef.current?.paused ?? true;
        },
      }),
      []
    );

    // ---- Quelle anhängen ---------------------------------------------------
    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      if (kind === "mp4") {
        video.src = fullSrc;
        return;
      }
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = fullSrc;
        return;
      }
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

    // Callbacks in Refs halten, damit der Listener-Effect NICHT bei
    // jeder Parent-Render-Iteration neu subscriben muss (beim Zeichnen
    // feuert setStrokes häufig → viele Re-Renders).
    const onTimeUpdateRef = useRef(onTimeUpdate);
    const onPlayingChangeRef = useRef(onPlayingChange);
    onTimeUpdateRef.current = onTimeUpdate;
    onPlayingChangeRef.current = onPlayingChange;

    // ---- Dauer / Zeit / Natural-Size / Play-State --------------------------
    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;
      const onMeta = () => {
        setDuration(video.duration || 0);
        if (video.videoWidth && video.videoHeight)
          setNatural({ w: video.videoWidth, h: video.videoHeight });
      };
      const onTime = () => {
        setCurrent(video.currentTime || 0);
        onTimeUpdateRef.current?.(video.currentTime || 0);
      };
      const onPlay = () => onPlayingChangeRef.current?.(true);
      const onPause = () => onPlayingChangeRef.current?.(false);
      video.addEventListener("loadedmetadata", onMeta);
      video.addEventListener("durationchange", onMeta);
      video.addEventListener("timeupdate", onTime);
      video.addEventListener("play", onPlay);
      video.addEventListener("pause", onPause);
      return () => {
        video.removeEventListener("loadedmetadata", onMeta);
        video.removeEventListener("durationchange", onMeta);
        video.removeEventListener("timeupdate", onTime);
        video.removeEventListener("play", onPlay);
        video.removeEventListener("pause", onPause);
      };
    }, []);

    // ---- Sprite vorladen ---------------------------------------------------
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

    // ---- Maße messen: Leiste + Videobox ------------------------------------
    // WICHTIG: hängt an `duration`, weil die Scrub-Leiste (barRef) erst
    // gerendert wird sobald duration > 0. Ohne diese Abhängigkeit würde
    // der Observer beim Mount laufen, wenn barRef noch null ist →
    // barWidth bliebe 0 und der Filmstrip fiele auf den Fallback zurück.
    useEffect(() => {
      const bar = barRef.current;
      const media = mediaRef.current;
      const update = () => {
        if (barRef.current) setBarWidth(barRef.current.clientWidth);
        if (mediaRef.current)
          setBox({
            w: mediaRef.current.clientWidth,
            h: mediaRef.current.clientHeight,
          });
      };
      update();
      const ro = new ResizeObserver(update);
      if (bar) ro.observe(bar);
      if (media) ro.observe(media);
      return () => ro.disconnect();
    }, [duration]);

    // ---- Content-Rect (letterbox-korrekt) für das Overlay ------------------
    const contentRect = (() => {
      if (!natural || box.w <= 0 || box.h <= 0)
        return { left: 0, top: 0, width: box.w, height: box.h };
      const arV = natural.w / natural.h;
      const arBox = box.w / box.h;
      if (arV > arBox) {
        const width = box.w;
        const height = width / arV;
        return { left: 0, top: (box.h - height) / 2, width, height };
      }
      const height = box.h;
      const width = height * arV;
      return { left: (box.w - width) / 2, top: 0, width, height };
    })();

    // ---- Scrub-Interaktion -------------------------------------------------
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

    // ---- Sprite-Kachel-Helfer ----------------------------------------------
    function tileStyle(
      frame: number,
      w: number,
      h: number
    ): React.CSSProperties {
      if (!sprite) return {};
      const f = Math.max(0, Math.min(sprite.frames - 1, frame));
      const col = f % sprite.cols;
      const row = Math.floor(f / sprite.cols);
      return {
        backgroundImage: `url(${sprite.url})`,
        backgroundRepeat: "no-repeat",
        backgroundSize: `${sprite.cols * w}px ${sprite.rows * h}px`,
        backgroundPosition: `-${col * w}px -${row * h}px`,
      };
    }

    const frameAspect =
      sprite && sprite.tileHeight > 0
        ? sprite.tileWidth / sprite.tileHeight
        : 16 / 9;
    const stripTileW = STRIP_HEIGHT * frameAspect;
    const sampleCount =
      sprite && barWidth > 0
        ? Math.max(4, Math.min(sprite.frames, Math.round(barWidth / stripTileW)))
        : 0;

    const hoverTile =
      sprite && hover ? Math.floor(hover.t / sprite.interval) : -1;
    const progressPct = duration > 0 ? (current / duration) * 100 : 0;

    const previewW = sprite ? Math.min(180, sprite.tileWidth) : 0;
    const previewH = sprite ? Math.round(previewW / frameAspect) : 0;
    const clampedLeft =
      hover && barWidth > 0
        ? Math.max(
            previewW / 2 + 4,
            Math.min(barWidth - previewW / 2 - 4, hover.x)
          )
        : 0;

    return (
      <div className={`flex flex-col ${className ?? ""}`}>
        <div ref={mediaRef} className="relative flex-1 min-h-0">
          <video
            ref={videoRef}
            controls
            playsInline
            poster={poster ?? undefined}
            className="w-full h-full object-contain bg-black block"
          />
          {overlay && (
            <div
              className="absolute"
              style={{
                left: contentRect.left,
                top: contentRect.top,
                width: contentRect.width,
                height: contentRect.height,
                zIndex: 10,
                pointerEvents: overlayInteractive ? undefined : "none",
              }}
            >
              {overlay}
            </div>
          )}
        </div>

        {duration > 0 && (
          <div className="relative select-none mt-1">
            {/* große Hover-Vorschau */}
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
                <div className="absolute inset-0 bg-gradient-to-b from-neutral-800 to-neutral-900" />
              )}

              <div
                className="absolute inset-y-0 left-0 bg-black/45 pointer-events-none"
                style={{ width: `${progressPct}%` }}
              />
              <div
                className="absolute inset-y-0 w-0.5 bg-white shadow pointer-events-none"
                style={{ left: `${progressPct}%` }}
              />
              {hover && (
                <div
                  className="absolute inset-y-0 w-px bg-white/70 pointer-events-none"
                  style={{ left: hover.x }}
                />
              )}

              {/* Zeit-Marker (Kommentar-Markierungen) */}
              {duration > 0 &&
                markers?.map((m) => {
                  const left = `${Math.max(
                    0,
                    Math.min(100, (m.t / duration) * 100)
                  )}%`;
                  const active = m.id === activeMarkerId;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        seekTo(m.t);
                        onMarkerClick?.(m.id);
                      }}
                      title={formatTime(m.t)}
                      className="absolute -translate-x-1/2 top-0 z-10"
                      style={{ left }}
                      aria-label={`Markierung bei ${formatTime(m.t)}`}
                    >
                      <span
                        className={`block rounded-b-sm ${
                          active ? "w-1.5" : "w-1"
                        }`}
                        style={{
                          height: STRIP_HEIGHT,
                          background: m.color ?? "#ffffff",
                          boxShadow: active
                            ? "0 0 0 1px rgba(0,0,0,.6)"
                            : "0 0 0 1px rgba(0,0,0,.4)",
                          opacity: active ? 1 : 0.85,
                        }}
                      />
                    </button>
                  );
                })}
            </div>
          </div>
        )}
      </div>
    );
  }
);

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}
