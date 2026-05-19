"use client";

import { useEffect, useRef } from "react";

/**
 * Adaptive HLS Video Player.
 *
 * - Safari (mit nativem HLS-Support) bekommt einfach das m3u8 als src.
 * - Chrome/Firefox/Edge laden hls.js dynamisch und attachen es ans <video>.
 *
 * src kommt von der Lumio API als relativer Pfad
 * (`/api/v1/g/.../hls/master.m3u8`); damit der Browser Cookies mitschickt,
 * muss die Anfrage same-origin sein. In dev läuft Frontend auf 3000 und
 * API auf 3001 — wir bauen die Vollurl aus NEXT_PUBLIC_API_URL.
 */
export function VideoPlayer({
  src,
  poster,
  className,
}: {
  src: string;
  poster?: string | null;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

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
        // Letzter Fallback: m3u8 direkt ans Video — Browser wird scheitern,
        // aber wenigstens kein Crash.
        video.src = fullSrc;
        return;
      }
      hls = new HlsMod({
        // Cookies bei XHR mitschicken — sonst kein Visitor-Auth
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

  return (
    <video
      ref={videoRef}
      controls
      playsInline
      poster={poster ?? undefined}
      className={className}
    />
  );
}
