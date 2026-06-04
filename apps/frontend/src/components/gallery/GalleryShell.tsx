"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, type Branding } from "@/lib/api";
import { useT, useLocale } from "@/lib/i18n";
import { bunnyFontsCssUrl, resolveFontStack } from "@/lib/fonts";

/**
 * Wrapper für alle Kunden-Galerie-Seiten. Wendet das Branding eines
 * Tenants und die optionalen Galerie-Overrides an:
 *   - primaryColor → Background (dunkel = bleibt dunkel; hell = wird hell)
 *   - accentColor  → CSS-Variable --brand-accent (Buttons, Highlights)
 *   - fontFamily   → globaler Font-Stack
 *   - logoUrl      → Header
 *   - faviconUrl   → injizierter <link rel="icon">
 *   - introText    → über der Galerie (optional)
 *   - footerText   → Footer (sonst "Powered by Lumio")
 *   - customCss    → optional als <style>-Tag eingehängt
 *
 * Galerie-Overrides (überschreiben Branding-Werte):
 *   - colorBackground / colorAccent: Hex #RRGGBB
 *   - footerMarkdown: ersetzt branding.footerText durch reichformatierten
 *     Inhalt
 *
 * Wenn kein Branding gesetzt ist, fallen wir auf die Lumio-Defaults zurück
 * (dunkler Neutral-Look).
 */
function hexToRgbTriple(hex: string): string | null {
  const m = hex.replace("#", "").match(/^([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 0xff} ${(n >> 8) & 0xff} ${n & 0xff}`;
}

function isLightColor(hex: string): boolean {
  const m = hex.replace("#", "").match(/^([0-9a-f]{6})$/i);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  // Wahrgenommene Helligkeit (Rec. 709)
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luma > 0.5;
}

export function GalleryShell({
  branding,
  overrides,
  children,
}: {
  branding: Branding | null;
  /** Galerie-spezifische Overrides — überschreiben gleichnamige
   *  Branding-Werte für diese eine Galerie. Wenn die Galerie noch
   *  nicht geladen ist (Unlock-Screen vor Meta-Laden), reichen die
   *  Branding-Defaults. */
  overrides?: {
    colorBackground?: string | null;
    colorAccent?: string | null;
    footerMarkdown?: string | null;
    fontHeading?: string | null;
    fontBody?: string | null;
    /** Wenn die Galerie ein eigenes Event-Logo im Hero rendert,
     *  unterdruecken wir das Branding-Logo im Header. Sonst sieht
     *  der Customer dasselbe Logo zweimal (oben + im Hero). */
    hideHeaderLogo?: boolean;
  };
  children: React.ReactNode;
}) {
  const t = useT();
  const { locale, setLocale, supported } = useLocale();
  // Favicon dynamisch setzen
  useEffect(() => {
    if (!branding?.faviconUrl) return;
    const existing = document.querySelector<HTMLLinkElement>(
      'link[rel="icon"]'
    );
    const link =
      existing ?? Object.assign(document.createElement("link"), { rel: "icon" });
    link.href = branding.faviconUrl;
    if (!existing) document.head.appendChild(link);
  }, [branding?.faviconUrl]);

  // Rechtliche Links des Betreibers (Impressum/Datenschutz) aus der
  // Instanz-Config. Bei Self-Hostern ohne Config bleibt es leer.
  const [legal, setLegal] = useState<{
    imprintUrl: string | null;
    privacyUrl: string | null;
  } | null>(null);
  useEffect(() => {
    let active = true;
    api
      .getAppMeta()
      .then((m) => {
        if (active) setLegal(m.legal);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Galerie-Overrides haben Vorrang vor Branding-Werten.
  const primary =
    overrides?.colorBackground ?? branding?.primaryColor ?? "#0e0e10";
  const accent = overrides?.colorAccent ?? branding?.accentColor ?? "#f59e0b";
  const accentRgb = hexToRgbTriple(accent);
  const light = isLightColor(primary);
  // Wie der Text-auf-Akzent aussehen muss: bei hellen Akzenten (Amber,
  // Yellow, Lime) schwarz, bei dunklen (Magenta, Dark Blue, Forest
  // Green) weiß. Wir nutzen die gleiche Luma-Logik wie für den
  // Hintergrund. Ohne diese Variable sind Buttons mit "bg-brand-accent
  // text-neutral-950" bei dunklen Akzenten unlesbar.
  // Format: RGB-Triple wie --brand-accent — damit Tailwind's
  // "text-brand-accent-contrast" mit alpha-Modifiern funktioniert.
  const accentLight = isLightColor(accent);
  const accentContrastRgb = accentLight ? "14 14 16" : "242 242 244";

  // Font-Stacks auflösen. Body-Stack wird via inline-style auf den
  // Container gesetzt; Heading-Stack via CSS-Variable, die in
  // GalleryHero.tsx und in der prose-Konfiguration via Tailwind's
  // [&_h1]-Selektoren herangezogen wird (CSS-Variablen-Indirektion
  // ermöglicht es, dass alle Headings in welcome/footer Markdown
  // mit umgestellt werden).
  const bodyFontStack = resolveFontStack(
    overrides?.fontBody,
    branding?.fontFamily
  );
  const headingFontStack = resolveFontStack(
    overrides?.fontHeading,
    branding?.fontFamily
  );
  // CSS-URL zum Laden der gewählten Fonts via Bunny Fonts CDN. Nur
  // gerendert wenn mindestens ein Galerie-Override gesetzt ist;
  // Branding-fontFamily wird als freier String angenommen und nicht
  // automatisch von Bunny geladen (das Studio muss sich darum
  // kümmern dass der Font im Browser verfügbar ist).
  const fontsCss = bunnyFontsCssUrl([
    overrides?.fontHeading,
    overrides?.fontBody,
  ]);

  const style: React.CSSProperties = {
    backgroundColor: primary,
    color: light ? "#0e0e10" : "#f2f2f4",
    fontFamily: bodyFontStack,
  };
  if (accentRgb) {
    (style as Record<string, string>)["--brand-accent"] = accentRgb;
  }
  (style as Record<string, string>)["--brand-accent-contrast"] = accentContrastRgb;
  // Heading-Stack als CSS-Variable, damit Headings (in GalleryHero und
  // im Markdown-Welcome/-Footer) sie via [&_h1,&_h2]-Selektoren
  // anwenden können.
  (style as Record<string, string>)["--gallery-font-heading"] =
    headingFontStack;

  const borderColor = light ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.1)";
  const mutedColor = light ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.6)";

  // CSS-Variablen für theme-bewusste Komponenten (Sticky-Toolbar etc.)
  // die heute hartcodierte white/black-Werte nutzen. Sub-Components
  // können dann via var(--brand-fg) / var(--brand-fg-muted) / etc.
  // theme-korrekte Farben rendern ohne selbst zu wissen ob die
  // Galerie hell oder dunkel ist.
  const fg = light ? "#0e0e10" : "#f2f2f4";
  const fgMuted = light ? "rgba(0,0,0,0.7)" : "rgba(255,255,255,0.85)";
  const fgSubtle = mutedColor;
  // Sticky-Toolbar-Background: leichte Eintönung des Branding-Hintergrunds,
  // damit der Streifen visuell vom Content abhebt aber nicht "grau-aus-
  // schwarz" wirkt wie bei hartcodiertem rgba(0,0,0,0.45) auf hellem
  // Hintergrund. Bei hellem Theme: weiß-tönung; bei dunklem: schwarz-tönung.
  const toolbarBg = light ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.45)";
  // Surface für Buttons/Chips in der Toolbar — leicht abgesetzt vom
  // Toolbar-Background damit sie sichtbar bleiben.
  const surface = light ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.05)";
  const surfaceHover = light
    ? "rgba(0,0,0,0.08)"
    : "rgba(255,255,255,0.12)";
  // Deckende Surface für schwebende Overlays (Dropdowns/Popover/Modals).
  // --brand-surface ist bewusst fast transparent (nur ein Toolbar-Tint) —
  // als Hintergrund eines schwebenden Panels scheint sonst der Inhalt
  // dahinter durch ("liegt hinter den Tags"). Hier nehmen wir den opaken
  // Branding-Hintergrund; der fg-Kontrast ist gegen primary garantiert.
  const surfaceSolid = primary;

  (style as Record<string, string>)["--brand-fg"] = fg;
  (style as Record<string, string>)["--brand-bg"] = primary;
  (style as Record<string, string>)["--brand-fg-muted"] = fgMuted;
  (style as Record<string, string>)["--brand-fg-subtle"] = fgSubtle;
  (style as Record<string, string>)["--brand-border"] = borderColor;
  (style as Record<string, string>)["--brand-toolbar-bg"] = toolbarBg;
  (style as Record<string, string>)["--brand-surface"] = surface;
  (style as Record<string, string>)["--brand-surface-hover"] = surfaceHover;
  (style as Record<string, string>)["--brand-surface-solid"] = surfaceSolid;
  (style as Record<string, string>)["--brand-is-light"] = light ? "1" : "0";

  return (
    <div className="min-h-screen lumio-gallery-shell" style={style}>
      {/* Galerie-Fonts laden, wenn IDs gesetzt sind. Bunny Fonts CDN —
          DSGVO-konformer drop-in Replacement für Google Fonts. */}
      {fontsCss ? (
        <link rel="stylesheet" href={fontsCss} />
      ) : null}

      {/* Heading-Font wird via Scoped-Styles auf alle Headings im
          Customer-View angewendet. Inline-Block, damit der Cascade
          klar bleibt — die spezifische Galerie-Override gewinnt
          gegen Tailwind-Klassen-Defaults. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            .lumio-gallery-shell h1,
            .lumio-gallery-shell h2,
            .lumio-gallery-shell h3 {
              font-family: ${headingFontStack};
            }
          `,
        }}
      />

      {/* Custom CSS, falls vorhanden */}
      {branding?.customCss ? (
        <style
          // Defense-in-depth: das Backend neutralisiert `</style` beim
          // Speichern bereits (siehe brandings-Route). Wir tun es hier
          // beim Rendern NOCHMAL, damit auch ein älterer/ungefilterter
          // Wert keinen Tag-Breakout (</style><script>…) im Besucher-
          // Browser auslösen kann. Nur `</style` kann ein <style>-Element
          // beenden — daher reicht diese Neutralisierung und legitimes
          // CSS (inline-SVG-URIs mit < >) bleibt intakt.
          dangerouslySetInnerHTML={{
            __html: branding.customCss.replace(/<\/(style)/gi, "<\\/$1"),
          }}
        />
      ) : null}

      {branding?.logoUrl && !overrides?.hideHeaderLogo ? (
        <header
          className="p-6 border-b"
          style={{ borderColor }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={branding.logoUrl}
            alt=""
            className="h-8 w-auto"
          />
        </header>
      ) : null}

      {branding?.introText ? (
        <div
          className="max-w-3xl mx-auto px-4 pt-8 text-sm whitespace-pre-wrap"
          style={{ color: mutedColor }}
        >
          {branding.introText}
        </div>
      ) : null}

      <main>{children}</main>

      {/* Galerie-Footer-Markdown — wenn gesetzt, ersetzt es den
          Branding-Footer-Text. Wird breit gerendert mit prose-styles,
          damit Listen/Links/Headings ordentlich aussehen. */}
      {overrides?.footerMarkdown ? (
        <section
          className="px-4 sm:px-6 md:px-12 mt-12 py-10 border-t"
          style={{ borderColor, color: mutedColor }}
        >
          <div
            className={`max-w-3xl mx-auto prose ${
              light ? "" : "prose-invert"
            } prose-sm sm:prose-base`}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
              {overrides.footerMarkdown}
            </ReactMarkdown>
          </div>
        </section>
      ) : null}

      <footer
        className="p-6 mt-12 text-xs"
        style={{
          color: mutedColor,
          opacity: branding?.footerText ? 1 : 0.7,
          borderTop:
            branding?.footerText && !overrides?.footerMarkdown
              ? `1px solid ${borderColor}`
              : "none",
        }}
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div className="text-center sm:text-left flex-1 min-w-0">
            {/* Wenn ein galerie-spezifischer Footer-Markdown da ist, hat
                der den Hauptbereich schon geschnappt — hier unten reichen
                der Powered-By und der Locale-Switcher. */}
            {overrides?.footerMarkdown
              ? t("gallery.poweredBy")
              : branding?.footerText ?? t("gallery.poweredBy")}
          </div>
          {legal && (legal.imprintUrl || legal.privacyUrl) && (
            <div
              className="flex items-center gap-3 shrink-0"
              style={{ color: mutedColor }}
            >
              {legal.imprintUrl && (
                <a
                  href={legal.imprintUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  Impressum
                </a>
              )}
              {legal.imprintUrl && legal.privacyUrl && <span aria-hidden>·</span>}
              {legal.privacyUrl && (
                <a
                  href={legal.privacyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  Datenschutz
                </a>
              )}
            </div>
          )}
          {supported.length > 1 && (
            <LocaleSwitcher
              locale={locale}
              setLocale={setLocale}
              supported={supported}
            />
          )}
        </div>
      </footer>
    </div>
  );
}

// Kleiner Toggle-Button für Sprachen. Bewusst klein gehalten — soll dem
// Branding der Galerie nicht die Schau stehlen, aber jederzeit erreichbar
// sein. Bei nur einer unterstützten Locale wird er gar nicht gerendert.
function LocaleSwitcher({
  locale,
  setLocale,
  supported,
}: {
  locale: string;
  setLocale: (l: "en" | "de") => void;
  supported: readonly ("en" | "de")[];
}) {
  return (
    <div className="flex items-center gap-1 text-[11px]">
      {supported.map((l, i) => (
        <span key={l} className="flex items-center gap-1">
          {i > 0 && <span className="opacity-30">·</span>}
          <button
            type="button"
            onClick={() => setLocale(l)}
            className={
              l === locale
                ? "font-medium underline underline-offset-2"
                : "hover:underline underline-offset-2 opacity-70"
            }
            aria-current={l === locale ? "true" : undefined}
          >
            {l === "de" ? "Deutsch" : "English"}
          </button>
        </span>
      ))}
    </div>
  );
}
