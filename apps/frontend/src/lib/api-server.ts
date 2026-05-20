/**
 * Server-side API-Helper für Next.js Server Components / Metadata.
 *
 * Im Gegensatz zu lib/api.ts (client-seitig, nutzt Browser-Cookies):
 * hier laufen wir auf dem Node-Server beim Render-Schritt. Kein Cookie,
 * kein Browser. Wir reden direkt mit dem API-Container.
 *
 * INTERNAL_API_URL: wenn gesetzt, nutzen wir das (im Docker-Compose ist
 * das z.B. http://api:3001 — schneller, kein Umweg über Caddy + TLS).
 * Sonst fallback auf NEXT_PUBLIC_API_URL.
 */
const INTERNAL_API_URL =
  process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "";
const PUBLIC_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export interface ServerGalleryMeta {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  branding?: { name: string } | null;
  header?: {
    heroImageUrl: string | null;
    eventLogoUrl: string | null;
    welcomeMarkdown: string | null;
    overlayColor: string | null;
    backgroundColor: string | null;
  };
}

export async function fetchPublicGallery(
  slug: string
): Promise<{ gallery: ServerGalleryMeta } | null> {
  const res = await fetch(`${INTERNAL_API_URL}/api/v1/g/${slug}`, {
    // Server-side fetch — wir wollen frische Daten, kein Browser-Cache,
    // aber Next.js Static-Render kann das hier prerendern wenn die
    // Galerie nicht zu oft ändert.
    next: { revalidate: 60 }, // 1 min — Titel/Hero ändern selten
  });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Macht aus einem (möglicherweise relativen) Asset-Pfad einen absoluten
 * URL, der von Crawlern (WhatsApp-Bot, Slack-Unfurler, ...) abgerufen
 * werden kann.
 *
 * Akzeptiert sowohl absolute URLs (Presigned-S3 vom Backend für
 * heroFileId-Auflösung) als auch relative API-Pfade (`/api/v1/g/...`
 * für hochgeladene Assets / Logos). PUBLIC_BASE ist die Origin auf der
 * die App von außen erreichbar ist — z.B. https://lumio-cloud.de.
 */
export function fetchAssetAbsolute(maybeRelative: string): string {
  if (/^https?:\/\//.test(maybeRelative)) return maybeRelative;
  const base = PUBLIC_BASE.replace(/\/+$/, "");
  return `${base}${maybeRelative}`;
}
