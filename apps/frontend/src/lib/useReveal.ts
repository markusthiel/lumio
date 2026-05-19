"use client";

/**
 * useReveal — IntersectionObserver-basiertes Reveal-Pattern.
 *
 * Anwendung:
 *
 *   function FileTile({ file }) {
 *     const { ref, revealed } = useReveal();
 *     return (
 *       <li ref={ref} className={revealed ? "animate-reveal" : "opacity-0"}>
 *         <img src={file.thumbUrl} />
 *       </li>
 *     );
 *   }
 *
 * Die Animation selbst läuft als CSS-Klasse `animate-reveal` (in
 * tailwind.config.mjs definiert), die wiederum die Tokens aus globals.css
 * benutzt — bei motion=off sind die Werte 0 und wir sehen sofort das Bild.
 *
 * `once: true` (Default): einmal sichtbar = bleibt sichtbar. Wer einen
 * Re-Trigger beim Wiederrein-Scrollen will, setzt `once: false`.
 */
import { useEffect, useRef, useState } from "react";

interface RevealOptions {
  once?: boolean;
  threshold?: number;
  rootMargin?: string;
}

export function useReveal<T extends HTMLElement>(
  opts: RevealOptions = {}
): { ref: React.RefObject<T | null>; revealed: boolean } {
  const { once = true, threshold = 0.15, rootMargin = "0px 0px -10% 0px" } = opts;
  const ref = useRef<T>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // SSR-Safety: IntersectionObserver kann fehlen oder beim Pre-Render
    // null sein
    if (typeof IntersectionObserver === "undefined") {
      setRevealed(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setRevealed(true);
            if (once) observer.unobserve(entry.target);
          } else if (!once) {
            setRevealed(false);
          }
        }
      },
      { threshold, rootMargin }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [once, threshold, rootMargin]);

  return { ref, revealed };
}
