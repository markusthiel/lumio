/**
 * Lumio API — Plan-Definitionen
 *
 * Zentrale Stelle für die Plan-Limits und -Features. Wird sowohl beim
 * Seed der `billing_plans`-Tabelle benutzt als auch zur Laufzeit für
 * Limit-Checks in den Routen.
 *
 * Wenn neue Pläne hinzukommen oder Limits sich ändern: HIER pflegen,
 * dann seed-script erneut laufen lassen.
 *
 * Wichtig: das DB-Modell BillingPlan ist die canonical Source für die
 * Stripe-Price-IDs (die kommen aus dem Stripe-Dashboard und sind pro
 * Umgebung verschieden). Aber die Limits stehen hier, weil sie zur
 * Build-Time bekannt sind und Tests/Frontend sie ohne DB-Roundtrip
 * brauchen.
 */

export type PlanSlug = "trial" | "solo" | "studio" | "pro";

export interface PlanLimits {
  /** Wie heißt der Plan in der UI */
  name: string;
  description: string;

  // Storage in GiB. Storage-Pack-Käufe addieren sich on top.
  storageGib: number;
  // Maximal aktive (nicht-archivierte) Galerien. Infinity = unbegrenzt.
  activeGalleries: number;
  // Wie viele Branding-Profile darf der Tenant anlegen.
  brandings: number;
  // Custom-Domains: 0 = nicht erlaubt, 1 = eine, Infinity = beliebig viele.
  customDomains: number;
  // Studio-Team-Mitglieder. 1 = nur Owner, > 1 = zusätzliche Accounts.
  teamMembers: number;
  // Watermarking generell verfügbar.
  watermarkAllowed: boolean;
  // Stripe-Preis pro Monat in Cent (0 = Trial)
  priceMonthlyCents: number;
  /** Stripe-Preis pro Jahr in Cent. Idee: 10 Monatspreise = ~17%
   *  Rabatt (2 Monate gratis). Trial hat keinen Yearly-Plan. */
  priceYearlyCents: number;
}

export const PLANS: Record<PlanSlug, PlanLimits> = {
  trial: {
    name: "Trial",
    description: "14 Tage Vollzugriff zum Testen",
    storageGib: 100,
    activeGalleries: 10,
    brandings: 1,
    customDomains: 1,
    teamMembers: 1,
    watermarkAllowed: true,
    priceMonthlyCents: 0,
    priceYearlyCents: 0,
  },
  solo: {
    name: "Solo",
    description: "Für Hobby- und Nebenberufs-Fotografen",
    storageGib: 500,
    activeGalleries: 10,
    brandings: 0,
    customDomains: 0,
    teamMembers: 1,
    watermarkAllowed: false,
    priceMonthlyCents: 1900,
    priceYearlyCents: 19000, // 10 Monate * 1900
  },
  studio: {
    name: "Studio",
    description: "Für hauptberufliche Fotografen",
    storageGib: 1000,
    activeGalleries: 50,
    brandings: 1,
    customDomains: 1,
    teamMembers: 1,
    watermarkAllowed: true,
    priceMonthlyCents: 3900,
    priceYearlyCents: 39000,
  },
  pro: {
    name: "Pro",
    description: "Für Studios mit Mitarbeitern und mehreren Marken",
    storageGib: 3000,
    activeGalleries: Number.POSITIVE_INFINITY,
    brandings: 5,
    customDomains: Number.POSITIVE_INFINITY,
    teamMembers: 3,
    watermarkAllowed: true,
    priceMonthlyCents: 8900,
    priceYearlyCents: 89000,
  },
};

/** Storage Add-On: pro 50 GB extra +9 EUR/Monat. Wird in Sprint 2 als
 *  separater Stripe-Subscription-Item gebucht. Yearly identisch zum
 *  monatlichen Preis * 10 (= 90 EUR/Jahr für 50 GB). */
export const STORAGE_ADDON = {
  gibPerUnit: 50,
  priceMonthlyCents: 900,
  priceYearlyCents: 9000,
};

/** Stripe lookup_keys — sprechend + stabil pro Plan. Bootstrap-Script
 *  legt mit diesen Keys Prices in Stripe an; Webhook-Worker matched
 *  via lookup_key auf den BillingPlan. Schema:
 *    plan_<slug>_<interval>   z.B. plan_solo_monthly, plan_pro_yearly
 *    storage_pack_<interval>  z.B. storage_pack_monthly */
export function planLookupKey(
  slug: Exclude<PlanSlug, "trial">,
  interval: "monthly" | "yearly"
): string {
  return `plan_${slug}_${interval}`;
}

export function storagePackLookupKey(
  interval: "monthly" | "yearly"
): string {
  return `storage_pack_${interval}`;
}

/** Liefert das Plan-Limit-Objekt für einen gegebenen Plan-Slug.
 *  Fallback: "trial" — defensiv, damit Limit-Checks nicht durchrutschen
 *  weil ein Tenant gar keinen Plan zugewiesen hat. */
export function getPlan(slug: string | null | undefined): PlanLimits {
  if (!slug) return PLANS.trial;
  const p = PLANS[slug as PlanSlug];
  return p ?? PLANS.trial;
}

/** Effektives Storage-Limit in Bytes, inklusive eventuellem
 *  Add-On-Speicher. addonGib ist die Anzahl der gekauften 50-GiB-Packs
 *  × 50, kommt aus der Subscription. */
export function effectiveStorageBytes(plan: PlanLimits, addonGib: number): bigint {
  const total = plan.storageGib + Math.max(0, addonGib);
  return BigInt(total) * 1024n * 1024n * 1024n;
}
