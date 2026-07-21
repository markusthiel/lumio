/**
 * Lumio API — Feature-Flag-Service
 *
 * Zentrale Registry aller verfuegbaren Feature-Flags. Nur hier
 * registrierte Keys werden im Super-Admin-UI angezeigt und vom
 * Backend respektiert.
 *
 * Verwendung:
 *   const enabled = await isFeatureEnabled(tenantId, FEATURE_FLAGS.PRINT_SHOP);
 *
 * Cache:
 *   Per-Tenant-LRU-Cache mit kurzer TTL (60s). Reicht fuer typische
 *   Request-Patterns ohne Stale-Risk. Bei Toggle-Aenderung muessen
 *   wir den Cache invalidieren — siehe setFeatureFlag().
 *
 * Default-Werte:
 *   Wenn KEIN DB-Eintrag fuer einen Tenant+Flag existiert, gilt der
 *   defaultValue aus der Registry. Damit muessen bei Neueinfuehrung
 *   einer Flag keine bestehenden Tenants migriert werden.
 */
import { prisma } from "../db.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

export interface FeatureFlagDef {
  key: string;
  /** Lesbarer Name fuer das Super-Admin-UI. */
  name: string;
  description: string;
  /** Default wenn der Tenant keinen Override hat. */
  defaultValue: boolean;
  /** Optional: Hinweis im UI (z.B. "Beta", "Pro-Only"). */
  badge?: "beta" | "experimental" | "deprecated";
}

/**
 * Alle bekannten Feature-Flags. Neue Flags hier registrieren, dann
 * im Code mit isFeatureEnabled() abfragen. Keys sind stabil (in DB),
 * Aenderungen am Key brauchen eine Migration.
 */
export const FEATURE_FLAG_DEFS: FeatureFlagDef[] = [
  {
    key: "print_shop",
    name: "Print-Shop",
    description:
      "Endkunden können aus Galerien direkt Prints bestellen (DE-Labs Integration).",
    defaultValue: false,
    badge: "beta",
  },
  {
    key: "lightroom_plugin",
    name: "Lightroom-Plugin",
    description:
      "Direkter Upload aus Adobe Lightroom Classic via API-Token. Plugin separat verteilt.",
    defaultValue: false,
    badge: "beta",
  },
  {
    key: "advanced_analytics",
    name: "Erweiterte Analytics",
    description:
      "Heatmaps der Bildauswahl, Conversion-Tracking, Endkunden-Engagement-Stats.",
    defaultValue: false,
    badge: "experimental",
  },
  {
    key: "ai_tagging",
    name: "KI-Auto-Tagging",
    description:
      "Automatische Tag-Vergabe per CLIP/ImageBind. Nutzt GPU-Worker.",
    defaultValue: false,
    badge: "experimental",
  },
  {
    key: "video_streaming_4k",
    name: "4K-Video-Streaming",
    description:
      "HLS-Renditions bis 2160p statt nur 1080p. Erhöht Storage- und Bandwidth-Bedarf.",
    defaultValue: false,
  },
];

// Index fuer schnellen Lookup nach Key
const DEFS_BY_KEY = new Map(FEATURE_FLAG_DEFS.map((d) => [d.key, d]));

// Global via Env aktivierte Flags (FEATURES_ENABLED="print_shop,…").
// Self-Hosting-Weg ohne Super-Admin-UI: hebt den Registry-Default an,
// ein expliziter Per-Tenant-Override aus der DB gewinnt aber weiterhin
// (auch zum gezielten Deaktivieren im Multi-Mode).
const ENV_ENABLED: ReadonlySet<string> = (() => {
  const keys = config.FEATURES_ENABLED.split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const valid = new Set<string>();
  for (const k of keys) {
    if (DEFS_BY_KEY.has(k)) {
      valid.add(k);
    } else {
      logger.warn(
        { key: k, known: [...DEFS_BY_KEY.keys()] },
        "FEATURES_ENABLED enthält unbekannten Flag-Key — ignoriert"
      );
    }
  }
  if (valid.size > 0) {
    logger.info({ flags: [...valid] }, "Feature-Flags global via Env aktiviert");
  }
  return valid;
})();

// Cache: tenantId → (flagKey → enabled). TTL pro Tenant.
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map<string, { expires: number; flags: Map<string, boolean> }>();

function getCached(tenantId: string): Map<string, boolean> | null {
  const e = cache.get(tenantId);
  if (!e) return null;
  if (e.expires < Date.now()) {
    cache.delete(tenantId);
    return null;
  }
  return e.flags;
}

function setCached(tenantId: string, flags: Map<string, boolean>) {
  cache.set(tenantId, { expires: Date.now() + CACHE_TTL_MS, flags });
}

/** Cache-Invalidation fuer einen Tenant. */
export function invalidateFeatureFlagCache(tenantId: string) {
  cache.delete(tenantId);
}

/** Liefert die effektiven Flag-Werte fuer einen Tenant (Override + Defaults). */
export async function getEffectiveFlags(
  tenantId: string
): Promise<Map<string, boolean>> {
  const cached = getCached(tenantId);
  if (cached) return cached;

  const overrides = await prisma.tenantFeatureFlag.findMany({
    where: { tenantId },
    select: { flagKey: true, enabled: true },
  });
  const overrideMap = new Map(overrides.map((o) => [o.flagKey, o.enabled]));

  const result = new Map<string, boolean>();
  for (const def of FEATURE_FLAG_DEFS) {
    // Präzedenz: DB-Override (Super-Admin, kann auch AUS-schalten)
    // > globale Env-Aktivierung > Registry-Default.
    result.set(
      def.key,
      overrideMap.get(def.key) ??
        (ENV_ENABLED.has(def.key) ? true : def.defaultValue)
    );
  }
  setCached(tenantId, result);
  return result;
}

export async function isFeatureEnabled(
  tenantId: string,
  key: string
): Promise<boolean> {
  const flags = await getEffectiveFlags(tenantId);
  return flags.get(key) ?? false;
}

/** Setzt einen Flag fuer einen Tenant. Wenn enabled gleich dem Default
 *  ist und kein Override existiert, geschieht nichts. Wenn enabled
 *  gleich dem Default UND ein Override existiert, wird der Override
 *  GELOESCHT (Sauberkeit) — Tenant erhaelt dann implicit den Default. */
export async function setFeatureFlag(opts: {
  tenantId: string;
  flagKey: string;
  enabled: boolean;
  setById: string;
  setByEmail: string;
}): Promise<{ action: "set" | "deleted" | "unchanged" }> {
  const def = DEFS_BY_KEY.get(opts.flagKey);
  if (!def) {
    throw new Error(`unknown feature flag: ${opts.flagKey}`);
  }

  const existing = await prisma.tenantFeatureFlag.findUnique({
    where: {
      tenantId_flagKey: { tenantId: opts.tenantId, flagKey: opts.flagKey },
    },
  });

  // Falls neuer Wert == Default und kein Override existiert: nichts tun
  if (!existing && opts.enabled === def.defaultValue) {
    return { action: "unchanged" };
  }
  // Falls neuer Wert == Default UND Override existiert: Override loeschen
  if (existing && opts.enabled === def.defaultValue) {
    await prisma.tenantFeatureFlag.delete({ where: { id: existing.id } });
    invalidateFeatureFlagCache(opts.tenantId);
    return { action: "deleted" };
  }
  // Sonst: upsert
  await prisma.tenantFeatureFlag.upsert({
    where: {
      tenantId_flagKey: { tenantId: opts.tenantId, flagKey: opts.flagKey },
    },
    update: {
      enabled: opts.enabled,
      setById: opts.setById,
      setByEmail: opts.setByEmail,
    },
    create: {
      tenantId: opts.tenantId,
      flagKey: opts.flagKey,
      enabled: opts.enabled,
      setById: opts.setById,
      setByEmail: opts.setByEmail,
    },
  });
  invalidateFeatureFlagCache(opts.tenantId);
  return { action: "set" };
}
