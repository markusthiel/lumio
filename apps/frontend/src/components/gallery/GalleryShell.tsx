"use client";

import type { Branding } from "@/lib/api";

/**
 * Wrapper für alle Kunden-Galerie-Seiten. Setzt CSS-Variablen für
 * Branding-Farben und legt den dunklen Look an (Bilder sollen knallen).
 *
 * Branding-Inputs sind defensiv getypt — eine Tenant kann auch ohne
 * Branding-Profil arbeiten (dann Lumio-Defaults).
 */
function hexToRgbTriple(hex: string | null): string | null {
  if (!hex) return null;
  const m = hex.replace("#", "").match(/^([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 0xff} ${(n >> 8) & 0xff} ${n & 0xff}`;
}

export function GalleryShell({
  branding,
  children,
}: {
  branding: Branding | null;
  children: React.ReactNode;
}) {
  const primary = hexToRgbTriple(branding?.primaryColor ?? null);
  const accent = hexToRgbTriple(branding?.accentColor ?? null);

  const style: React.CSSProperties = {};
  if (primary) (style as Record<string, string>)["--brand-primary"] = primary;
  if (accent) (style as Record<string, string>)["--brand-accent"] = accent;
  if (branding?.fontFamily) {
    (style as Record<string, string>)["--font-sans"] =
      `"${branding.fontFamily}", system-ui, sans-serif`;
  }

  return (
    <div
      className="min-h-screen bg-neutral-950 text-neutral-100"
      style={style}
    >
      {branding?.logoUrl ? (
        <header className="p-6 border-b border-white/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={branding.logoUrl}
            alt=""
            className="h-8 w-auto"
          />
        </header>
      ) : null}

      <main>{children}</main>

      {branding?.footerText ? (
        <footer className="p-6 mt-12 border-t border-white/10 text-xs opacity-60 text-center">
          {branding.footerText}
        </footer>
      ) : (
        <footer className="p-6 mt-12 text-xs opacity-40 text-center">
          Powered by Lumio
        </footer>
      )}
    </div>
  );
}
