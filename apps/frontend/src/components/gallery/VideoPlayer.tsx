"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Adaptive HLS Video Player mit Sprite-Sheet-Scrubbing.
 *
 * - Safari (mit nativem HLS-Support) bekommt einfach das m3u8 als src.
 * - Chrome/Firefox/Edge laden hls.js dynamisch und attachen es ans <video>.
 *
 * Sprite-Scrubbing: wenn der Worker ein sprite-Rendition erzeugt hat,
 * legen wir eine schmale Hover-Bar über den Video-Controls. Beim Hover
 * zeigt sich eine 160px-Thumbnail des Frames an der entsprechenden
 * Position — wie YouTube/Vimeo.
 *
 * Wir verstecken die NATIVEN controls NICHT — die Default-Controls bleiben
 * für Play/Pause/Volume/Fullscreen aktiv. Die Sprite-Bar liegt oben drüber
 * und hat pointer-events nur auf den oberen ~25px (über der Progress-Bar
 * der nativen Controls, vergleichbar mit YouTubes Tooltip-Position).
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

export function VideoPlayer({
  src,
  poster,
  sprite,
  className,
}: {
  src: string;
  poster?: string | null;
  sprite?: SpriteSheet | null;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [duration, setDuration] = useState<number>(0);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);

  // Wenn src relativ ist und ein API_URL gesetzt ist, prefixen
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
  const fullSrc = src.startsWith("http") ? src : `${apiUrl}${src}`;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Safari kann HLS nativ
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = fullSrc;
      return;
    }

    // Sonst: hls.js dynamisch laden
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
  }, [fullSrc]);

  // Dauer mitschneiden (für die Sprite-Bar — Mapping x-Position → Zeit)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onMeta = () => setDuration(video.duration);
    video.addEventListener("loadedmetadata", onMeta);
    return () => video.removeEventListener("loadedmetadata", onMeta);
  }, []);

  // Hover-Berechnung über der Sprite-Bar
  function onBarMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!sprite || duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const t = (x / rect.width) * duration;
    setHover({ x, t });
  }
  function onBarLeave() {
    setHover(null);
  }
  function onBarClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!videoRef.current || duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    videoRef.current.currentTime = (x / rect.width) * duration;
  }

  // Welche Sprite-Kachel gehört zur aktuellen Hover-Zeit?
  const tile =
    sprite && hover
      ? Math.min(sprite.frames - 1, Math.floor(hover.t / sprite.interval))
      : -1;
  const tileCol = tile >= 0 ? tile % sprite!.cols : 0;
  const tileRow = tile >= 0 ? Math.floor(tile / sprite!.cols) : 0;

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`}>
      <video
        ref={videoRef}
        controls
        playsInline
        poster={poster ?? undefined}
        className="w-full h-full"
      />

      {sprite && duration > 0 && (
        <>
          {/* Hover-Zone: schmaler Strip über der nativen Progress-Bar.
              Höhe und Bottom-Offset sind grob auf Chrome/Safari getunt;
              auf Firefox kann's um ein paar Pixel daneben sein. */}
          <div
            className="absolute left-0 right-0 cursor-pointer"
            style={{ bottom: 35, height: 20 }}
            onMouseMove={onBarMove}
            onMouseLeave={onBarLeave}
            onClick={onBarClick}
          />

          {/* Sprite-Tooltip — über dem Hover-Punkt, Pfeil nach unten */}
          {hover && tile >= 0 && (
            <div
              className="absolute pointer-events-none flex flex-col items-center"
              style={{
                left: hover.x,
                bottom: 60,
                transform: "translateX(-50%)",
              }}
            >
              <div
                className="rounded shadow-lg border-2 border-white/80 overflow-hidden bg-black"
                style={{
                  width: sprite.tileWidth,
                  height: sprite.tileHeight,
                  backgroundImage: `url(${sprite.url})`,
                  backgroundPosition: `-${tileCol * sprite.tileWidth}px -${tileRow * sprite.tileHeight}px`,
                  backgroundSize: `${sprite.cols * sprite.tileWidth}px ${sprite.rows * sprite.tileHeight}px`,
                  backgroundRepeat: "no-repeat",
                }}
              />
              <div className="mt-1 text-[11px] font-mono text-white bg-black/80 px-1.5 py-0.5 rounded">
                {formatTime(hover.t)}
              </div>
            </div>
          )}
        </>
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
