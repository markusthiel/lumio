"use client";

/**
 * GalleryHero — der personalisierbare Header der Customer-Galerie.
 *
 * Vier Render-Varianten, gewählt über `meta.header.layout`:
 *
 *   - minimal       Aktueller Default. Kompakter Text-Block oben links,
 *                   Hero-Bild oder Background-Farbe als Backdrop.
 *                   Hero-Höhe 60-70vh wenn Bild da ist.
 *
 *   - splash        Vollbild-Hero (100vh), Inhalt zentriert (horizontal
 *                   und vertikal), dezenter Scroll-Hint am unteren Rand.
 *                   Dramatischer Auftritt für Hochzeit/Event.
 *
 *   - side_by_side  Editorial-Layout: links der Text-Block (Logo, Titel,
 *                   Welcome), rechts das Hero-Bild als eigenständiges
 *                   Element. Kein Backdrop-Bild. Mobile: stack vertikal.
 *
 *   - centered      Magazin-Style: Logo + Titel + Welcome ZENTRIERT in
 *                   einem ruhigen oberen Bereich, darunter das Hero-Bild
 *                   als Banner mit fester Höhe. Wirkt feierlich.
 *
 * Textfarbe (light/dark) wird via heroTextColor() aus Overlay+Background
 * berechnet — heller Overlay über Hero → dunkler Text, sonst hell. Bei
 * Hero-Bild ohne Overlay nutzen wir hellen Text mit Text-Shadow.
 */
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PublicGalleryMeta } from "@/lib/api";
import { heroTextColor } from "@/lib/color";

interface Props {
  meta: PublicGalleryMeta;
  /** Inhalt-Suffix unter Titel/Welcome — typisch der Stats-Block. */
  children?: React.ReactNode;
}

/**
 * Liefert die Inline-Style-Properties für die Hero-Text-Farbe, plus
 * den Side-by-Side-Spezialfall, der den Galerie-Surface-Text erbt.
 */
function heroTextStyle(meta: PublicGalleryMeta, sideBySide = false): React.CSSProperties {
  if (sideBySide) {
    // Side-by-Side hat keinen eigenen Backdrop — der Text steht auf der
    // normalen Galerie-Surface, dort sorgt der GalleryShell schon für
    // korrekten Kontrast.
    return {};
  }
  const tone = heroTextColor({
    hasHeroImage: !!meta.header.heroImageUrl,
    backgroundColor: meta.header.backgroundColor,
    overlayColor: meta.header.overlayColor,
  });
  if (tone === "dark") {
    return { color: "#0a0a0a" };
  }
  // Hell — bei Hero-Bild ohne starkes Overlay noch einen leichten
  // Text-Shadow, damit auch helle Bildregionen lesbar bleiben.
  const needsShadow =
    !!meta.header.heroImageUrl &&
    (!meta.header.overlayColor ||
      parseInt((meta.header.overlayColor ?? "#00000000").slice(7, 9) || "00", 16) / 255 < 0.3);
  return {
    color: "#ffffff",
    textShadow: needsShadow ? "0 1px 12px rgba(0,0,0,0.45)" : undefined,
  };
}

export function GalleryHero({ meta, children }: Props) {
  switch (meta.header.layout) {
    case "splash":
      return <SplashHero meta={meta}>{children}</SplashHero>;
    case "side_by_side":
      return <SideBySideHero meta={meta}>{children}</SideBySideHero>;
    case "centered":
      return <CenteredHero meta={meta}>{children}</CenteredHero>;
    case "minimal":
    default:
      return <MinimalHero meta={meta}>{children}</MinimalHero>;
  }
}

// ---------------------------------------------------------------------------
// Variant: Minimal
// ---------------------------------------------------------------------------
// Original-Default. Text linksbündig, Hero-Bild als Backdrop wenn da.
function MinimalHero({ meta, children }: Props) {
  const h = meta.header;
  const hasHeroImage = !!h.heroImageUrl;
  const hasOverlay = hasHeroImage && !!h.overlayColor;
  const hasBgColor = !hasHeroImage && !!h.backgroundColor;
  const minHeight = hasHeroImage ? "min-h-[60vh] sm:min-h-[70vh]" : "";

  return (
    <section
      className={`relative isolate overflow-hidden ${minHeight}`}
      style={hasBgColor ? { backgroundColor: h.backgroundColor! } : undefined}
    >
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

      <div
        className="relative px-4 sm:px-6 md:px-12 pt-14 pb-10 sm:pt-20 sm:pb-14 max-w-7xl mx-auto animate-fade-in"
        style={heroTextStyle(meta)}
      >
        <EventLogo url={h.eventLogoUrl} size="md" align="start" />
        <h1 className="text-display-lg sm:text-display-xl font-medium tracking-tight">
          {meta.title}
        </h1>
        <WelcomeBlock meta={meta} maxWidth="2xl" align="start" />
        {children}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Variant: Splash
// ---------------------------------------------------------------------------
// Vollbild-Hero. Inhalt zentriert in der Mitte. Dezenter Scroll-Hint unten.
function SplashHero({ meta, children }: Props) {
  const h = meta.header;
  const hasHeroImage = !!h.heroImageUrl;
  const hasOverlay = hasHeroImage && !!h.overlayColor;
  const hasBgColor = !hasHeroImage && !!h.backgroundColor;

  return (
    <section
      className="relative isolate overflow-hidden min-h-screen flex items-center justify-center"
      style={hasBgColor ? { backgroundColor: h.backgroundColor! } : undefined}
    >
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

      <div
        className="relative px-4 sm:px-6 md:px-12 max-w-3xl mx-auto text-center animate-fade-in flex flex-col items-center"
        style={heroTextStyle(meta)}
      >
        <EventLogo url={h.eventLogoUrl} size="lg" align="center" />
        <h1 className="text-display-lg sm:text-display-xl font-medium tracking-tight">
          {meta.title}
        </h1>
        <WelcomeBlock meta={meta} maxWidth="2xl" align="center" />
        {children}
      </div>

      {/* Scroll-Hint: nur sinnvoll wenn der Hero wirklich vollbildig ist,
          d.h. wenn der Splash ein Bild oder eine Background-Farbe hat,
          sonst wäre der gesamte Hintergrund die normale Surface und der
          Hint wäre verwirrend. */}
      {(hasHeroImage || hasBgColor) && (
        <div className="absolute bottom-6 left-0 right-0 flex justify-center pointer-events-none">
          <div className="text-ui-xs uppercase tracking-[0.2em] opacity-60 flex flex-col items-center gap-1.5">
            <span>scroll</span>
            <svg
              viewBox="0 0 24 24"
              className="w-4 h-4 animate-bounce"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Variant: Side-by-Side
// ---------------------------------------------------------------------------
// Editorial. Text links (Logo, Titel, Welcome, Stats), rechts das Hero-Bild
// als eigenständiges Element. Mobile: stack vertikal, Bild oben.
function SideBySideHero({ meta, children }: Props) {
  const h = meta.header;
  const hasHeroImage = !!h.heroImageUrl;

  return (
    <section className="relative px-4 sm:px-6 md:px-12 pt-12 pb-10 sm:pt-16 sm:pb-14 max-w-7xl mx-auto animate-fade-in">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 items-center">
        {/* Bild rechts (auf Mobile oben). Wenn kein Bild da, lassen wir
            die Spalte einfach leer — der Text füllt sich nicht voll bis
            rechts, aber das ist OK weil dann eh nichts magazinmäßig
            wirken kann. */}
        {hasHeroImage && (
          <div className="order-first md:order-last aspect-[4/5] sm:aspect-[3/4] rounded-md overflow-hidden bg-surface-sunken">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={h.heroImageUrl!}
              alt=""
              className="w-full h-full object-cover"
            />
          </div>
        )}

        <div className="flex flex-col justify-center" style={heroTextStyle(meta, true)}>
          <EventLogo url={h.eventLogoUrl} size="md" align="start" />
          <h1 className="text-display-lg sm:text-display-xl font-medium tracking-tight">
            {meta.title}
          </h1>
          <WelcomeBlock meta={meta} maxWidth="md" align="start" sideBySide />
          {children}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Variant: Centered (Magazin)
// ---------------------------------------------------------------------------
// Logo + Titel + Welcome zentriert in ruhigem Topbereich, dann Hero-Bild
// als breiter Banner unten dran.
function CenteredHero({ meta, children }: Props) {
  const h = meta.header;
  const hasHeroImage = !!h.heroImageUrl;
  const hasBgColor = !hasHeroImage && !!h.backgroundColor;

  return (
    <section
      style={hasBgColor ? { backgroundColor: h.backgroundColor! } : undefined}
    >
      {/* Top-Block: ruhig, zentriert */}
      <div
        className="px-4 sm:px-6 md:px-12 pt-16 pb-12 sm:pt-24 sm:pb-16 max-w-3xl mx-auto text-center animate-fade-in flex flex-col items-center"
        style={heroTextStyle(meta)}
      >
        <EventLogo url={h.eventLogoUrl} size="md" align="center" />
        <h1 className="text-display-lg sm:text-display-xl font-medium tracking-tight">
          {meta.title}
        </h1>
        <WelcomeBlock meta={meta} maxWidth="2xl" align="center" />
        {children}
      </div>

      {/* Hero-Banner unter dem Top-Block. Nur wenn ein Bild gewählt
          ist — sonst spart sich diese Variante das Banner und sieht
          aus wie eine zentrierte Minimal-Version. */}
      {hasHeroImage && (
        <div className="relative h-[40vh] sm:h-[55vh] overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={h.heroImageUrl!}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
          {h.overlayColor && (
            <div
              className="absolute inset-0"
              style={{ backgroundColor: h.overlayColor }}
            />
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

function EventLogo({
  url,
  size,
  align,
}: {
  url: string | null;
  size: "md" | "lg";
  align: "start" | "center";
}) {
  if (!url) return null;
  const heightClass =
    size === "lg" ? "h-20 sm:h-28" : "h-16 sm:h-20";
  const alignClass = align === "center" ? "self-center" : "self-start";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      className={`${heightClass} w-auto mb-6 object-contain ${alignClass}`}
    />
  );
}

function WelcomeBlock({
  meta,
  maxWidth,
  align,
  sideBySide = false,
}: {
  meta: PublicGalleryMeta;
  maxWidth: "md" | "2xl";
  align: "start" | "center";
  /** Side-by-Side hat keinen Backdrop → Tone wird vom Shell vererbt. */
  sideBySide?: boolean;
}) {
  const h = meta.header;
  const widthClass = maxWidth === "md" ? "max-w-md" : "max-w-2xl";
  const alignClass = align === "center" ? "mx-auto" : "";

  // Prose-Tone: dunkel auf hellem Hero (helles Overlay/Bg) → normaler
  // prose, sonst prose-invert für hellen Text. Side-by-side hat keinen
  // eigenen Backdrop, dort vererben wir vom Shell.
  let proseTone = "prose-invert";
  if (!sideBySide) {
    const tone = heroTextColor({
      hasHeroImage: !!h.heroImageUrl,
      backgroundColor: h.backgroundColor,
      overlayColor: h.overlayColor,
    });
    if (tone === "dark") proseTone = "";
  }

  if (h.welcomeMarkdown) {
    return (
      <div
        className={`prose ${proseTone} prose-sm sm:prose-base mt-4 ${widthClass} ${alignClass} opacity-90`}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
          {h.welcomeMarkdown}
        </ReactMarkdown>
      </div>
    );
  }
  if (meta.description) {
    return (
      <p
        className={`text-ui-lg sm:text-ui-md opacity-70 mt-4 ${widthClass} ${alignClass} leading-relaxed`}
      >
        {meta.description}
      </p>
    );
  }
  return null;
}
