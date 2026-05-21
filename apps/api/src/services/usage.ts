/**
 * Lumio API — Usage-Service
 *
 * Liefert die aktuellen Verbrauchszahlen eines Tenants (Storage,
 * Galerien-Anzahl, Branding-Anzahl, etc.) und enforced die Plan-Limits.
 *
 * Storage-Berechnung: live aus der DB aggregiert (SUM über files +
 * renditions). Wir cachen das NICHT in einem Counter-Feld, weil:
 *   - der Counter sonst zwischen API und Worker konsistent gehalten
 *     werden müsste (Drift bei Crashes etc.)
 *   - Postgres ist mit den Indizes auf gallery.tenantId + file.galleryId
 *     so schnell, dass eine sub-100ms Query selbst bei 100k Files
 *     unproblematisch ist
 *   - die canonical Wahrheit sind die Files+Renditions selbst — alles
 *     andere wäre Duplikation
 *
 * BillingSubscription.storageBytesUsed wird vom Background-Job
 * periodisch aktualisiert (für Dashboards/Trends), aber Limit-Checks
 * gehen IMMER über computeStorageBytes() live.
 */

import { prisma } from "../db.js";
import { getPlan, effectiveStorageBytes, type PlanLimits } from "./plans.js";

export interface TenantUsage {
  plan: PlanLimits;
  /** Roher Plan-Slug wie er in der DB steht. */
  planSlug: string;
  /** Subscription-Status: trialing | active | past_due | canceled | unpaid */
  subscriptionStatus: string;
  /** Zugekaufte Storage-Packs in GiB. */
  storageAddonGib: number;
  /** Effektives Storage-Limit in Bytes (Plan + Add-On). */
  storageLimitBytes: bigint;
  /** Aktuell genutzter Storage in Bytes. */
  storageBytesUsed: bigint;
  /** Storage-Breakdown für die UI. */
  storageBreakdown: {
    originalsBytes: bigint;
    renditionsBytes: bigint;
  };
  /** Galerien (status != 'archived'). */
  activeGalleries: number;
  /** Galerien gesamt (incl. archiviert). */
  totalGalleries: number;
  /** Custom-Domain aktiv? */
  customDomainsUsed: number;
  /** Branding-Profile angelegt. */
  brandingsUsed: number;
  /** Studio-User in dem Tenant. */
  teamMembers: number;
  /** Trial endet wann? */
  trialEndsAt: Date | null;
  /** Read-only-Modus aktiv seit (Karenz Tag 30+)? */
  readOnlySince: Date | null;
}

/** Live-Aggregation des Storage-Verbrauchs eines Tenants. Eine einzige
 *  Query mit Sub-Selects — Postgres optimiert das mit Hash-Aggregat. */
export async function computeStorageBytes(
  tenantId: string
): Promise<{ originalsBytes: bigint; renditionsBytes: bigint }> {
  // Originals: file.sizeBytes summiert über alle Files des Tenants.
  // Wir filtern NICHT auf status, weil failed Files trotzdem Speicher
  // belegen (Original ist schon hochgeladen, nur die Renditions fehlen).
  // Wenn ein File aktiv per DELETE entfernt wird, ist es aus der Tabelle
  // weg.
  const originals = await prisma.$queryRaw<Array<{ sum: bigint | null }>>`
    SELECT COALESCE(SUM(f."sizeBytes"), 0)::bigint AS sum
    FROM files f
    JOIN galleries g ON g.id = f."galleryId"
    WHERE g."tenantId" = ${tenantId}::uuid
  `;
  const renditions = await prisma.$queryRaw<Array<{ sum: bigint | null }>>`
    SELECT COALESCE(SUM(r."sizeBytes"), 0)::bigint AS sum
    FROM renditions r
    JOIN files f ON f.id = r."fileId"
    JOIN galleries g ON g.id = f."galleryId"
    WHERE g."tenantId" = ${tenantId}::uuid
  `;
  return {
    originalsBytes: BigInt(originals[0]?.sum ?? 0n),
    renditionsBytes: BigInt(renditions[0]?.sum ?? 0n),
  };
}

/** Vollständiger Usage-Snapshot eines Tenants. Wird in der Studio-UI
 *  und in Limit-Checks verwendet. */
export async function getTenantUsage(tenantId: string): Promise<TenantUsage> {
  const [tenant, sub, breakdown, galleries, customDomains, brandings, teamMembers] =
    await Promise.all([
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, customDomain: true },
      }),
      prisma.billingSubscription.findUnique({
        where: { tenantId },
        include: { plan: true },
      }),
      computeStorageBytes(tenantId),
      prisma.gallery.groupBy({
        by: ["status"],
        where: { tenantId },
        _count: { _all: true },
      }),
      // Custom-Domains: gibt's pro Tenant höchstens eine (tenants.customDomain)
      // plus die pro-Galerie-Custom-Domain (falls eingeführt, aktuell N/A).
      // Wir zählen den Tenant-Wert; pro-Gallery-Domains kommen später.
      Promise.resolve(0), // placeholder, gefüllt unten
      prisma.branding.count({ where: { tenantId } }),
      prisma.user.count({ where: { tenantId } }),
    ]);

  const planSlug = sub?.plan?.slug ?? "trial";
  const plan = getPlan(planSlug);
  const storageAddonGib = sub?.storageAddonGib ?? 0;
  const storageLimitBytes = effectiveStorageBytes(plan, storageAddonGib);
  const activeGalleries = galleries
    .filter((g) => g.status !== "archived")
    .reduce((sum, g) => sum + g._count._all, 0);
  const totalGalleries = galleries.reduce((sum, g) => sum + g._count._all, 0);
  const customDomainsUsed = tenant?.customDomain ? 1 : 0;
  void customDomains; // hush unused, wir nehmen tenant.customDomain als Quelle

  return {
    plan,
    planSlug,
    subscriptionStatus: sub?.status ?? "trial",
    storageAddonGib,
    storageLimitBytes,
    storageBytesUsed: breakdown.originalsBytes + breakdown.renditionsBytes,
    storageBreakdown: breakdown,
    activeGalleries,
    totalGalleries,
    customDomainsUsed,
    brandingsUsed: brandings,
    teamMembers,
    trialEndsAt: sub?.trialEndsAt ?? null,
    readOnlySince: sub?.readOnlySince ?? null,
  };
}

// ---------------------------------------------------------------------------
// Limit-Check-Funktionen
// ---------------------------------------------------------------------------
//
// Jede Funktion gibt entweder { ok: true } zurück oder { ok: false, ... }
// mit dem 402-Response-Body, der direkt an den Client gesendet werden
// kann. Format ist konsistent damit das Frontend immer den gleichen
// Upgrade-Dialog rendern kann.

export type LimitCheck =
  | { ok: true }
  | {
      ok: false;
      error:
        | "storage_limit_exceeded"
        | "active_galleries_limit"
        | "feature_requires_plan"
        | "trial_expired"
        | "subscription_past_due"
        | "read_only";
      message: string;
      current?: number;
      limit?: number;
      minPlan?: string;
    };

/** Storage-Check vor neuem File-Upload. additionalBytes sind die
 *  geplanten Bytes (Content-Length aus dem Init-Request). */
export async function checkStorageLimit(
  tenantId: string,
  additionalBytes: bigint
): Promise<LimitCheck> {
  const usage = await getTenantUsage(tenantId);

  // Read-only-Tenant kann generell keine Uploads
  if (usage.readOnlySince) {
    return {
      ok: false,
      error: "read_only",
      message:
        "Tenant ist im read-only-Modus wegen ausstehender Zahlung. Bitte Karte aktualisieren.",
    };
  }

  const projectedUsage = usage.storageBytesUsed + additionalBytes;
  if (projectedUsage > usage.storageLimitBytes) {
    return {
      ok: false,
      error: "storage_limit_exceeded",
      message: `Upload würde Speicher-Limit überschreiten (${formatBytes(
        projectedUsage
      )} / ${formatBytes(usage.storageLimitBytes)}). Storage Pack kaufen oder Plan upgraden.`,
      current: Number(usage.storageBytesUsed),
      limit: Number(usage.storageLimitBytes),
    };
  }
  return { ok: true };
}

/** Aktive-Galerien-Check vor Erstellen einer neuen Galerie. */
export async function checkActiveGalleriesLimit(
  tenantId: string
): Promise<LimitCheck> {
  const usage = await getTenantUsage(tenantId);

  if (usage.readOnlySince) {
    return {
      ok: false,
      error: "read_only",
      message: "Tenant ist im read-only-Modus wegen ausstehender Zahlung.",
    };
  }

  if (usage.activeGalleries >= usage.plan.activeGalleries) {
    return {
      ok: false,
      error: "active_galleries_limit",
      message: `Du hast bereits ${usage.activeGalleries} aktive Galerien (Limit: ${usage.plan.activeGalleries}). Archiviere eine alte Galerie oder upgrade deinen Plan.`,
      current: usage.activeGalleries,
      limit: usage.plan.activeGalleries,
    };
  }
  return { ok: true };
}

/** Feature-Gate für Plan-abhängige Features. featureName muss zu einem
 *  Plan-Limit-Feld passen (z.B. 'customDomains', 'brandings'). */
export async function checkFeatureAvailable(
  tenantId: string,
  feature: "customDomain" | "branding" | "watermark" | "teamMember"
): Promise<LimitCheck> {
  const usage = await getTenantUsage(tenantId);

  if (usage.readOnlySince) {
    return {
      ok: false,
      error: "read_only",
      message: "Tenant ist im read-only-Modus.",
    };
  }

  switch (feature) {
    case "customDomain":
      if (usage.customDomainsUsed >= usage.plan.customDomains) {
        return {
          ok: false,
          error: "feature_requires_plan",
          message:
            usage.plan.customDomains === 0
              ? "Custom-Domains sind ab Studio-Plan verfügbar."
              : "Custom-Domain-Limit erreicht.",
          minPlan: usage.plan.customDomains === 0 ? "studio" : undefined,
        };
      }
      return { ok: true };

    case "branding":
      if (usage.brandingsUsed >= usage.plan.brandings) {
        return {
          ok: false,
          error: "feature_requires_plan",
          message:
            usage.plan.brandings === 0
              ? "Eigenes Branding ist ab Studio-Plan verfügbar."
              : `Branding-Limit erreicht (${usage.brandingsUsed} / ${usage.plan.brandings}).`,
          minPlan: usage.plan.brandings === 0 ? "studio" : "pro",
        };
      }
      return { ok: true };

    case "watermark":
      if (!usage.plan.watermarkAllowed) {
        return {
          ok: false,
          error: "feature_requires_plan",
          message: "Watermarks sind ab Studio-Plan verfügbar.",
          minPlan: "studio",
        };
      }
      return { ok: true };

    case "teamMember":
      if (usage.teamMembers >= usage.plan.teamMembers) {
        return {
          ok: false,
          error: "feature_requires_plan",
          message:
            usage.plan.teamMembers === 1
              ? "Team-Accounts sind ab Pro-Plan verfügbar."
              : `Team-Member-Limit erreicht (${usage.teamMembers} / ${usage.plan.teamMembers}).`,
          minPlan: "pro",
        };
      }
      return { ok: true };
  }
}

function formatBytes(bytes: bigint | number): string {
  const n = typeof bytes === "bigint" ? Number(bytes) : bytes;
  const gb = n / (1024 * 1024 * 1024);
  if (gb >= 10) return `${gb.toFixed(0)} GB`;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = n / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}
