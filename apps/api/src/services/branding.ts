/**
 * Lumio API — Branding Resolver
 *
 * Auflösungsreihenfolge:
 *   1. Galerie-spezifisches Branding (gallery.brandingId)
 *   2. Tenant-Default-Branding (tenant.brandingId)
 *   3. null (Frontend nutzt eingebaute Lumio-Defaults)
 *
 * Asset-URLs: logoUrl und faviconUrl speichern S3-Keys
 * (z.B. `t/<tenantId>/brand/<brandingId>/logo.png`). Beim Ausliefern
 * an Public-Galerien signieren wir den Key mit 24h TTL, sodass der
 * Browser ihn cachen kann.
 *
 * Wenn das Feld bereits eine externe URL ist (beginnt mit http(s)://),
 * geben wir sie unverändert weiter — erleichtert manuelles Setzen oder
 * spätere Migration zu öffentlichem CDN.
 */
import { prisma } from "../db.js";
import { presignGet } from "./storage.js";

export interface ResolvedBranding {
  id: string;
  name: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  accentColor: string;
  fontFamily: string;
  introText: string | null;
  footerText: string | null;
  customCss: string | null;
}

const ASSET_TTL_SECONDS = 24 * 3600;

async function maybePresign(value: string | null): Promise<string | null> {
  if (!value) return null;
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  // S3-Key — signieren
  return presignGet({ key: value, ttlSeconds: ASSET_TTL_SECONDS });
}

/**
 * Lädt das passende Branding für eine Galerie (mit Tenant-Default-Fallback)
 * und signiert die Asset-URLs.
 */
export async function resolveGalleryBranding(opts: {
  galleryBrandingId: string | null;
  tenantId: string;
}): Promise<ResolvedBranding | null> {
  let branding = null;

  if (opts.galleryBrandingId) {
    branding = await prisma.branding.findUnique({
      where: { id: opts.galleryBrandingId },
    });
  }

  if (!branding) {
    // Tenant-Default
    const tenant = await prisma.tenant.findUnique({
      where: { id: opts.tenantId },
      select: { brandingId: true },
    });
    if (tenant?.brandingId) {
      branding = await prisma.branding.findUnique({
        where: { id: tenant.brandingId },
      });
    }
  }

  if (!branding) return null;

  return {
    id: branding.id,
    name: branding.name,
    logoUrl: await maybePresign(branding.logoUrl),
    faviconUrl: await maybePresign(branding.faviconUrl),
    primaryColor: branding.primaryColor,
    accentColor: branding.accentColor,
    fontFamily: branding.fontFamily,
    introText: branding.introText,
    footerText: branding.footerText,
    customCss: branding.customCss,
  };
}
