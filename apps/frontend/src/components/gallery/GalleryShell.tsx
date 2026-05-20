"use client";

import { useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Branding } from "@/lib/api";
import { useT, useLocale } from "@/lib/i18n";

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

  // Galerie-Overrides haben Vorrang vor Branding-Werten.
  const primary =
    overrides?.colorBackground ?? branding?.primaryColor ?? "#0e0e10";
  const accent = overrides?.colorAccent ?? branding?.accentColor ?? "#f59e0b";
  const accentRgb = hexToRgbTriple(accent);
  const light = isLightColor(primary);

  const style: React.CSSProperties = {
    backgroundColor: primary,
    color: light ? "#0e0e10" : "#f2f2f4",
  };
  if (accentRgb) {
    (style as Record<string, string>)["--brand-accent"] = accentRgb;
  }
  if (branding?.fontFamily) {
    style.fontFamily = `"${branding.fontFamily}", system-ui, sans-serif`;
  }

  const borderColor = light ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.1)";
  const mutedColor = light ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.6)";

  return (
    <div className="min-h-screen" style={style}>
      {/* Custom CSS, falls vorhanden */}
      {branding?.customCss ? (
        <style
          // sicher: Studio-User sind authentifiziert und Admin/Owner;
          // Custom-CSS landet nur in den Galerien des eigenen Tenants
          dangerouslySetInnerHTML={{ __html: branding.customCss }}
        />
      ) : null}

      {branding?.logoUrl ? (
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
