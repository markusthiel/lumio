"use client";

/**
 * GalleryHero — der personalisierbare Header der Customer-Galerie.
 *
 * Zwei Schichten:
 *   1. Backdrop — Hero-Bild ODER Solid-Hintergrundfarbe.
 *      Bei Hero-Bild kann zusätzlich ein Overlay-Farbe (RGBA) drüber
 *      gelegt werden für Lesbarkeit.
 *
 *   2. Content — Event-Logo (klein, optional) + Titel + Welcome-Block
 *      (Markdown, optional) + Description (Fallback).
 *
 * Wenn nichts customisiert ist, sieht das aus wie der bisherige Hero
 * (Plain-Dark mit minimalem Text), damit existierende Galerien sich
 * nicht ändern.
 *
 * Implementierungshinweis: wir verwenden bewusst plain <img>-Tags
 * statt next/image, weil:
 *   - Hero kann ein relativer API-Pfad sein (/api/v1/g/.../assets/hero
 *     der server-seitig auf S3 redirected) — next/image kann mit
 *     dieser Indirektion umgehen, aber präsentiert dabei manchmal
 *     leere Bilder bevor der Redirect aufgelöst ist.
 *   - Wir wollen Browser-Caching, nicht Next-Image-Optimizer-Caching,
 *     weil unsere Asset-URLs schon präsignierte S3-Links sind und
 *     Next's Optimizer keine Optimierung mehr drüberlegen kann.
 *   - eslint-Warnung dafür unterdrückt — bewusste Entscheidung.
 */
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PublicGalleryMeta } from "@/lib/api";

interface Props {
  meta: PublicGalleryMeta;
  /** Inhalt-Suffix unter Titel/Welcome — typisch der Stats-Block. */
  children?: React.ReactNode;
}

export function GalleryHero({ meta, children }: Props) {
  const h = meta.header;
  const hasHeroImage = !!h.heroImageUrl;
  const hasOverlay = hasHeroImage && !!h.overlayColor;
  const hasBgColor = !hasHeroImage && !!h.backgroundColor;

  // Wenn ein Hero-Bild da ist, machen wir den Hero deutlich höher (für
  // den Bilder-Eindruck). Sonst bleibt's beim ursprünglichen Format.
  const minHeight = hasHeroImage ? "min-h-[60vh] sm:min-h-[70vh]" : "";

  return (
    <section
      className={`relative isolate overflow-hidden ${minHeight}`}
      style={hasBgColor ? { backgroundColor: h.backgroundColor! } : undefined}
    >
      {/* Backdrop: Hero-Bild */}
      {hasHeroImage && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={h.heroImageUrl!}
            alt=""
            className="absolute inset-0 -z-10 w-full h-full object-cover"
          />
          {hasOverlay && (
            <div
              className="absolute inset-0 -z-10"
              style={{ backgroundColor: h.overlayColor! }}
            />
          )}
        </>
      )}

      <div className="relative px-4 sm:px-6 md:px-12 pt-14 pb-10 sm:pt-20 sm:pb-14 max-w-7xl mx-auto animate-fade-in flex flex-col justify-end h-full">
        {/* Event-Logo: zarte Präsenz oberhalb des Titels, max 200px breit */}
        {h.eventLogoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={h.eventLogoUrl}
            alt=""
            className="h-16 sm:h-20 w-auto mb-6 object-contain self-start"
          />
        )}

        <h1 className="text-display-lg sm:text-display-xl font-medium tracking-tight">
          {meta.title}
        </h1>

        {h.welcomeMarkdown ? (
          <div className="prose prose-invert prose-sm sm:prose-base mt-4 max-w-2xl opacity-90">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              // Sicherheits-Setup: react-markdown ist by-default sicher
              // (kein HTML, keine raw scripts). remark-gfm bringt
              // Tables/Strikethrough/Task-Lists ohne raw-html zu
              // erlauben. Wir whitelisten KEINE custom-components,
              // damit nichts unerwartetes durchkommt.
              skipHtml
            >
              {h.welcomeMarkdown}
            </ReactMarkdown>
          </div>
        ) : (
          meta.description && (
            <p className="text-ui-lg sm:text-ui-md opacity-70 mt-4 max-w-2xl leading-relaxed">
              {meta.description}
            </p>
          )
        )}

        {children}
      </div>
    </section>
  );
}
