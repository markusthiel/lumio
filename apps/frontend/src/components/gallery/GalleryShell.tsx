"use client";

import { useEffect } from "react";
import type { Branding } from "@/lib/api";

/**
 * Wrapper für alle Kunden-Galerie-Seiten. Wendet das Branding eines
 * Tenants/Galerie an:
 *   - primaryColor → Background (dunkel = bleibt dunkel; hell = wird hell)
 *   - accentColor  → CSS-Variable --brand-accent (Buttons, Highlights)
 *   - fontFamily   → globaler Font-Stack
 *   - logoUrl      → Header
 *   - faviconUrl   → injizierter <link rel="icon">
 *   - introText    → über der Galerie (optional)
 *   - footerText   → Footer (sonst "Powered by Lumio")
 *   - customCss    → optional als <style>-Tag eingehängt
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
  children,
}: {
  branding: Branding | null;
  children: React.ReactNode;
}) {
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

  const primary = branding?.primaryColor ?? "#0a0a0a"; // neutral-950
  const accent = branding?.accentColor ?? "#f59e0b";
  const accentRgb = hexToRgbTriple(accent);
  const light = isLightColor(primary);

  const style: React.CSSProperties = {
    backgroundColor: primary,
    color: light ? "#0a0a0a" : "#f5f5f5",
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

      {branding?.footerText ? (
        <footer
          className="p-6 mt-12 border-t text-xs text-center"
          style={{ borderColor, color: mutedColor }}
        >
          {branding.footerText}
        </footer>
      ) : (
        <footer
          className="p-6 mt-12 text-xs text-center"
          style={{ color: mutedColor, opacity: 0.7 }}
        >
          Powered by Lumio
        </footer>
      )}
    </div>
  );
}
