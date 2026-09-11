/**
 * Lumio API — Tenant-Slug Validation & Reservierte Slugs
 *
 * Zentrale Quelle der Wahrheit für gültige Tenant-Slugs. Slugs werden
 * als Subdomain verwendet (<slug>.lumio-cloud.de), daher müssen sie
 * DNS-tauglich sein UND keine reservierten Subdomains kapern können.
 *
 * Format-Regeln (siehe RFC 1123 + Lumio-Konventionen):
 *   - Nur [a-z0-9-]
 *   - 3-30 Zeichen (länger geht technisch, ist aber UX-mässig schlecht)
 *   - Kein - am Anfang oder Ende
 *   - Kein -- (double hyphen) zur Vermeidung Punycode-Verwechslung
 *
 * Reservierte Slugs sind Subdomains die wir für System-Zwecke
 * verwenden (studio = Login-Apex, api = API-Host etc.) oder die per
 * Konvention nicht für User reserviert sein sollten.
 *
 * Also reused for gallery slugs (the /g/<slug> path segment): same
 * charset/reserved-word rules, but a longer max length since a gallery
 * slug is just a path segment, not a DNS label — see
 * validateGallerySlugFormat below.
 */

export const RESERVED_SLUGS = new Set<string>([
  "www",
  "studio",
  "api",
  "admin",
  "app",
  "auth",
  "super",
  "mail",
  "blog",
  "docs",
  "support",
  "help",
  "billing",
  "stripe",
  "login",
  "signup",
  "signin",
  "register",
  "lumio",
  "static",
  "assets",
  "cdn",
]);

export type SlugValidationError =
  | "too_short"
  | "too_long"
  | "invalid_chars"
  | "leading_or_trailing_hyphen"
  | "double_hyphen"
  | "reserved";

export interface SlugValidationResult {
  ok: boolean;
  error?: SlugValidationError;
  message?: string;
}

/**
 * Synchrone Format- und Reserviert-Prüfung. Sagt NICHT ob der Slug
 * in der DB schon vergeben ist — dafür siehe isSlugAvailable.
 */
export function validateSlugFormat(
  slug: string,
  opts: { minLength?: number; maxLength?: number } = {}
): SlugValidationResult {
  const minLength = opts.minLength ?? 3;
  const maxLength = opts.maxLength ?? 30;
  if (slug.length < minLength) {
    return {
      ok: false,
      error: "too_short",
      message: `Mindestens ${minLength} Zeichen.`,
    };
  }
  if (slug.length > maxLength) {
    return {
      ok: false,
      error: "too_long",
      message: `Maximal ${maxLength} Zeichen.`,
    };
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return {
      ok: false,
      error: "invalid_chars",
      message: "Nur Kleinbuchstaben, Zahlen und Bindestrich erlaubt.",
    };
  }
  if (slug.startsWith("-") || slug.endsWith("-")) {
    return {
      ok: false,
      error: "leading_or_trailing_hyphen",
      message: "Darf nicht mit Bindestrich beginnen oder enden.",
    };
  }
  if (slug.includes("--")) {
    return {
      ok: false,
      error: "double_hyphen",
      message: "Keine doppelten Bindestriche.",
    };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return {
      ok: false,
      error: "reserved",
      message: "Dieser Name ist für System-Zwecke reserviert.",
    };
  }
  return { ok: true };
}

/**
 * Gallery slugs are just a /g/<slug> path segment, not a DNS label like
 * the tenant subdomain — so they get a longer max length. Charset,
 * hyphen and reserved-word rules stay identical (same RESERVED_SLUGS
 * set, for brand-safety consistency across both use cases).
 */
export const GALLERY_SLUG_MAX_LENGTH = 60;

export function validateGallerySlugFormat(slug: string): SlugValidationResult {
  return validateSlugFormat(slug, { maxLength: GALLERY_SLUG_MAX_LENGTH });
}

/**
 * Normalisiert eine beliebige Zeichenkette (z.B. einen Studio-Namen)
 * zu einem gültigen Slug-Vorschlag. Garantiert NICHT, dass der Vorschlag
 * DB-frei oder nicht-reserviert ist — der Caller muss das prüfen.
 */
export function suggestSlug(input: string): string {
  const base = input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // diacritics raus
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-") // double hyphens kollabieren
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  // Falls nach Normalisierung leer (z.B. nur Sonderzeichen Input) oder
  // zu kurz: fallback auf 'studio'
  if (base.length < 3) return "studio";
  return base;
}
