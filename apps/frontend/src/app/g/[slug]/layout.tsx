import type { Metadata } from "next";

import { fetchPublicGallery, fetchAssetAbsolute } from "@/lib/api-server";

/**
 * Server-side metadata für /g/[slug].
 *
 * Liest die Galerie über die API (server-seitig, kein Cookie) und baut
 * die Open-Graph-Tags daraus. Damit zeigt WhatsApp/iMessage/Slack/Mail
 * beim Teilen des Links die echte Galerie-Vorschau (Logo, Titel,
 * Hero-Bild).
 *
 * Wenn die Galerie nicht existiert oder der Tenant inaktiv ist, geben
 * wir nur einen generischen Title zurück — kein 404 hier, weil die
 * eigentliche Page das Routing übernimmt.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchPublicGallery(slug).catch(() => null);
  if (!data) {
    return { title: "Galerie · Lumio" };
  }
  const g = data.gallery;

  const titleParts = [g.title];
  if (g.branding?.name) titleParts.push(g.branding.name);
  const title = titleParts.join(" · ");
  const description = g.description ?? undefined;

  // OG-Image-Priorität: Hero-Bild > Event-Logo > nichts. Hero ist der
  // bestmögliche Eindruck im Share-Preview, das Event-Logo ist
  // Fallback (z.B. wenn der Fotograf noch kein Hero-Bild gesetzt hat).
  const ogImageUrl = g.header?.heroImageUrl
    ? fetchAssetAbsolute(g.header.heroImageUrl)
    : g.header?.eventLogoUrl
    ? fetchAssetAbsolute(g.header.eventLogoUrl)
    : null;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: ogImageUrl ? [{ url: ogImageUrl }] : undefined,
    },
    twitter: {
      card: ogImageUrl ? "summary_large_image" : "summary",
      title,
      description,
      images: ogImageUrl ? [ogImageUrl] : undefined,
    },
  };
}

export default function GallerySlugLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
