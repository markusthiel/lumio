/**
 * Tenant-bezogene Helper.
 *
 * Trennt internen Verwaltungsnamen (Tenant.name) vom oeffentlichen
 * Anzeigenamen (Tenant.displayName). Wer einen Tenant in einer
 * oeffentlich sichtbaren Kontext (Login-Header, Mail, Welcome-Flow)
 * referenziert, sollte tenantDisplayName(tenant) statt tenant.name
 * direkt verwenden.
 *
 * Wenn displayName null oder leerer String, faellt der Helper auf
 * name zurueck — Tenants ohne gesetzten oeffentlichen Namen
 * verhalten sich exakt wie vorher.
 */

interface TenantWithNames {
  name: string;
  displayName: string | null;
}

/** Liefert den oeffentlichen Anzeigenamen mit Fallback auf den
 *  internen Verwaltungsnamen. */
export function tenantDisplayName(tenant: TenantWithNames): string {
  const dn = tenant.displayName?.trim();
  if (dn) return dn;
  return tenant.name;
}
