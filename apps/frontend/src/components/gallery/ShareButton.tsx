"use client";

/**
 * ShareButton — nutzt die native Web-Share-API auf Mobile, fällt auf
 * Clipboard-Copy zurück wenn nicht verfügbar.
 *
 * Was geteilt wird: URL + Titel. Die OG-Tags in der Layout-Komponente
 * sorgen für die schöne Vorschau im Empfänger-Client (WhatsApp,
 * iMessage, Slack, Mail).
 *
 * Animation: dezenter "Kopiert!"-Hinweis, wenn der Fallback greift —
 * sonst weiß der Nutzer nicht, dass was passiert ist.
 */
import { useState } from "react";
import { useT } from "@/lib/i18n";

interface Props {
  title: string;
  /** Wenn null/undefined → wir nehmen window.location.href */
  url?: string;
}

export function ShareButton({ title, url }: Props) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  async function share() {
    const shareUrl = url ?? window.location.href;
    const navAny = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };

    if (navAny.share) {
      try {
        await navAny.share({ title, url: shareUrl });
        return;
      } catch (err) {
        // User canceled or share failed — kein Fallback nötig, das ist
        // intentionales Verhalten.
        if (err instanceof Error && err.name === "AbortError") return;
        // Anderer Fehler → Clipboard versuchen.
      }
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Wenn auch das nicht geht (z.B. Permission-Block), Nutzer
      // weiterzeigen — der kann den URL aus der Adressleiste kopieren.
      window.prompt(t("gallery.shareCopyManual"), shareUrl);
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      className="text-ui-xs h-8 px-3 rounded inline-flex items-center gap-1.5 text-white/70 hover:text-white hover:bg-white/10 transition-colors duration-motion"
      title={t("gallery.share")}
      aria-label={t("gallery.share")}
    >
      <svg
        viewBox="0 0 24 24"
        className="w-4 h-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
        <polyline points="16 6 12 2 8 6" />
        <line x1="12" y1="2" x2="12" y2="15" />
      </svg>
      <span className="hidden sm:inline">
        {copied ? t("gallery.shareCopied") : t("gallery.share")}
      </span>
    </button>
  );
}
