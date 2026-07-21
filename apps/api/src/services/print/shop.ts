/**
 * Lumio API — Print-Shop-Service (Tenant-Ebene)
 *
 * Studio-seitige Print-Shop-Verwaltung:
 *   - TenantPrintShopConfig CRUD
 *   - Provider-Aktivierung pro Tenant (mit Credentials)
 *   - Verfuegbarkeits-Check (Feature-Flag, Tenant-Config, Provider-Stage)
 */

import { prisma } from "../../db.js";
import { config } from "../../config.js";
import { logger } from "../../logger.js";
import { isFeatureEnabled } from "../feature-flags.js";
import {
  encryptCredentials,
  redactCredentials,
} from "./credentials.js";
import {
  getPrintProvider,
  listPrintProviders,
  type PrintProviderDef,
} from "./providers.js";

/** Komplett-Check: darf dieser Tenant gerade ueberhaupt den Print-Shop
 *  sehen? Drei Gates muessen gruen sein:
 *    1. Feature-Flag 'print_shop' aktiv fuer den Tenant
 *    2. TenantPrintShopConfig existiert + enabled=true
 *    3. (Pro Galerie: Gallery.printShopEnabled nicht explicit false)
 *
 *  Punkt 1 + 2 werden in dieser Funktion geprueft, Punkt 3 ist
 *  Per-Galerie und wird beim Galerie-Render geprueft.
 *
 *  Wenn FALSE: Studio-UI rendert keinen Print-Shop, Routes liefern 404.
 */
export async function isPrintShopAvailable(tenantId: string): Promise<boolean> {
  if (!(await isFeatureEnabled(tenantId, "print_shop"))) {
    return false;
  }
  const config = await prisma.tenantPrintShopConfig.findUnique({
    where: { tenantId },
    select: { enabled: true },
  });
  return config?.enabled ?? false;
}

/** Liefert die Tenant-Settings (oder Defaults wenn noch keine angelegt) */
export async function getTenantPrintConfig(tenantId: string) {
  const row = await prisma.tenantPrintShopConfig.findUnique({
    where: { tenantId },
  });
  if (!row) {
    return {
      tenantId,
      enabled: false,
      studioDisplayName: null as string | null,
      supportEmail: null as string | null,
      vatHandling: "inclusive" as "inclusive" | "exclusive",
      defaultVatBps: 1900,
      currency: "EUR",
      termsUrl: null as string | null,
      privacyUrl: null as string | null,
      applicationFeeBpsOverride: null as number | null,
      featureFlagEnabled: await isFeatureEnabled(tenantId, "print_shop"),
    };
  }
  return {
    tenantId,
    enabled: row.enabled,
    studioDisplayName: row.studioDisplayName,
    supportEmail: row.supportEmail,
    vatHandling: row.vatHandling as "inclusive" | "exclusive",
    defaultVatBps: row.defaultVatBps,
    currency: row.currency,
    termsUrl: row.termsUrl,
    privacyUrl: row.privacyUrl,
    applicationFeeBpsOverride: row.applicationFeeBpsOverride,
    featureFlagEnabled: await isFeatureEnabled(tenantId, "print_shop"),
  };
}

/** Upsertet die Tenant-Settings. */
export async function upsertTenantPrintConfig(
  tenantId: string,
  patch: {
    enabled?: boolean;
    studioDisplayName?: string | null;
    supportEmail?: string | null;
    vatHandling?: "inclusive" | "exclusive";
    defaultVatBps?: number;
    currency?: string;
    termsUrl?: string | null;
    privacyUrl?: string | null;
  }
) {
  await prisma.tenantPrintShopConfig.upsert({
    where: { tenantId },
    update: patch,
    create: {
      tenantId,
      enabled: patch.enabled ?? false,
      studioDisplayName: patch.studioDisplayName,
      supportEmail: patch.supportEmail,
      vatHandling: patch.vatHandling ?? "inclusive",
      defaultVatBps: patch.defaultVatBps ?? 1900,
      currency: patch.currency ?? "EUR",
      termsUrl: patch.termsUrl,
      privacyUrl: patch.privacyUrl,
    },
  });
}

/** Globale Anbieter aus Super-Admin-Config + Self-Print. Self-Print ist
 *  immer dabei. */
// Global via Env aktivierte Provider (PRINT_PROVIDERS_ENABLED="prodigi,gelato").
// Self-Hosting-Weg ohne Super-Admin-UI. Ein expliziter DB-Eintrag aus
// /super/print-providers gewinnt weiterhin (auch zum Deaktivieren);
// unbekannte Keys werden beim Start mit Warnung ignoriert.
const ENV_ENABLED_PROVIDERS: ReadonlySet<string> = (() => {
  const keys = config.PRINT_PROVIDERS_ENABLED.split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const known = new Set(listPrintProviders().map((p) => p.key));
  const valid = new Set<string>();
  for (const k of keys) {
    if (known.has(k)) {
      valid.add(k);
    } else {
      logger.warn(
        { key: k, known: [...known] },
        "PRINT_PROVIDERS_ENABLED enthält unbekannten Provider-Key — ignoriert"
      );
    }
  }
  if (valid.size > 0) {
    logger.info(
      { providers: [...valid] },
      "Print-Provider global via Env aktiviert"
    );
  }
  return valid;
})();

export async function listAvailableProvidersForTenant(): Promise<
  Array<{
    def: PrintProviderDef;
    globallyEnabled: boolean;
  }>
> {
  const adminConfigs = await prisma.superAdminPrintProviderConfig.findMany();
  // Expliziter DB-Wert (Super-Admin) gewinnt; ohne Eintrag zählt die
  // globale Env-Aktivierung; Self-Print ist immer an.
  const dbValue = new Map(adminConfigs.map((c) => [c.providerKey, c.enabled]));
  return listPrintProviders().map((def) => ({
    def,
    globallyEnabled:
      def.key === "manual_self_print"
        ? true
        : dbValue.get(def.key) ?? ENV_ENABLED_PROVIDERS.has(def.key),
  }));
}

/** Welche Provider hat der Tenant aktiviert? */
export async function listTenantProviders(tenantId: string) {
  const rows = await prisma.tenantPrintProvider.findMany({
    where: { tenantId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  return rows.map((r) => {
    const def = getPrintProvider(r.providerKey);
    return {
      id: r.id,
      providerKey: r.providerKey,
      providerLabel: def?.label ?? r.providerKey,
      enabled: r.enabled,
      isDefault: r.isDefault,
      displayName: r.displayName,
      hasCredentials: r.credentialsEnc !== null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

/** Aktiviert oder updated einen Provider fuer den Tenant. Credentials
 *  werden encrypted at rest gespeichert. */
export async function setTenantProvider(opts: {
  tenantId: string;
  providerKey: string;
  enabled?: boolean;
  displayName?: string | null;
  credentials?: Record<string, unknown> | null;
  isDefault?: boolean;
}) {
  const def = getPrintProvider(opts.providerKey);
  if (!def) {
    throw new Error(`unknown provider: ${opts.providerKey}`);
  }

  // Credentials-Validation: Self-Print darf KEINE Credentials haben.
  // Andere Provider muessen die required-fields enthalten.
  if (def.key === "manual_self_print") {
    if (opts.credentials && Object.keys(opts.credentials).length > 0) {
      throw new Error("self_print has no credentials");
    }
  } else if (opts.credentials !== undefined && opts.credentials !== null) {
    for (const field of def.credentialFields) {
      if (field.required && !opts.credentials[field.key]) {
        throw new Error(`missing required credential field: ${field.key}`);
      }
    }
  }

  const encrypted = opts.credentials
    ? encryptCredentials(opts.credentials)
    : null;

  // isDefault: nur einer pro Tenant. Wenn neuer Default gesetzt wird,
  // alle anderen zuruecksetzen.
  if (opts.isDefault) {
    await prisma.tenantPrintProvider.updateMany({
      where: { tenantId: opts.tenantId, isDefault: true },
      data: { isDefault: false },
    });
  }

  await prisma.tenantPrintProvider.upsert({
    where: {
      tenantId_providerKey: {
        tenantId: opts.tenantId,
        providerKey: opts.providerKey,
      },
    },
    update: {
      ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
      ...(opts.displayName !== undefined
        ? { displayName: opts.displayName }
        : {}),
      ...(encrypted !== null ? { credentialsEnc: encrypted } : {}),
      ...(opts.isDefault !== undefined ? { isDefault: opts.isDefault } : {}),
    },
    create: {
      tenantId: opts.tenantId,
      providerKey: opts.providerKey,
      enabled: opts.enabled ?? true,
      displayName: opts.displayName ?? null,
      credentialsEnc: encrypted,
      isDefault: opts.isDefault ?? false,
    },
  });
}

export async function deleteTenantProvider(tenantId: string, providerKey: string) {
  // Pruefen ob noch Produkte/Bestellungen mit diesem Provider existieren
  const linkedProducts = await prisma.printProduct.count({
    where: { tenantId, providerKey },
  });
  if (linkedProducts > 0) {
    throw new Error(
      `Es gibt noch ${linkedProducts} Produkte mit diesem Provider. Bitte zuerst Produkte loeschen oder zuweisen.`
    );
  }
  const activeOrders = await prisma.printOrder.count({
    where: {
      tenantId,
      providerKey,
      status: { in: ["pending_payment", "paid", "in_production", "shipped"] },
    },
  });
  if (activeOrders > 0) {
    throw new Error(
      `Es gibt noch ${activeOrders} laufende Bestellungen bei diesem Provider.`
    );
  }
  await prisma.tenantPrintProvider.deleteMany({
    where: { tenantId, providerKey },
  });
}

export { redactCredentials };
