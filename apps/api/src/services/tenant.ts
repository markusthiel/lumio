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
import { config } from "../config.js";

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

/**
 * Welche Tenant-Status erlauben Login und Session-Validierung?
 *
 * - "active": Normalbetrieb
 * - "pending_deletion": Self-Service-Loeschung in Karenzphase. Owner
 *   soll noch einloggen koennen um die Loeschung zurueckzunehmen.
 *   Schreibzugriffe sind dabei ueber das read-only-Plugin gesperrt.
 *
 * Suspended/archived (Super-Admin-Aktion) sind hier explizit nicht
 * drin — das sind Compliance-Pfade die Login blockieren sollen.
 *
 * ACHTUNG: Das ist NICHT die richtige Pruefung fuer oeffentliche
 * Endkunden-Routen. Dafuer isTenantPubliclyVisible() benutzen.
 */
export function isTenantOperational(status: string | null | undefined): boolean {
  return status === "active" || status === "pending_deletion";
}

/**
 * Welche Tenant-Status erlauben oeffentlichen Endkunden-Zugriff auf
 * Galerien, Downloads, Proofing, Print-Shop und Upload-Links?
 *
 * Nur "active".
 *
 * Bewusst strenger als isTenantOperational(): sobald der Owner die
 * Loeschung seines Studios beantragt hat (status='pending_deletion'),
 * gehen alle oeffentlichen Inhalte SOFORT offline. Aufbewahren fuer
 * das 60-Tage-Undo-Fenster und Weiter-Veroeffentlichen sind zwei
 * verschiedene Dinge — nach einem Loeschantrag (DSGVO Art. 17) laesst
 * sich nur das Erste rechtfertigen.
 *
 * Die Daten bleiben in DB und S3 bis zum Hard-Delete erhalten; ein
 * cancelDeletion() setzt status zurueck auf 'active' und damit sind
 * die Galerien unveraendert wieder erreichbar.
 */
export function isTenantPubliclyVisible(
  status: string | null | undefined
): boolean {
  return status === "active";
}

interface TenantWithDomain {
  slug: string;
  customDomain: string | null;
}

/**
 * Oeffentlicher Origin eines Tenants fuer Links die AUSSERHALB eines
 * Requests gebaut werden (Mails, Webhooks) — wo es keinen Host-Header
 * gibt, den man wie bei resolveTenant() einfach durchreichen koennte.
 *
 * Prioritaet: Custom Domain > Subdomain unter LUMIO_DOMAIN_BASE >
 * PUBLIC_URL. Der letzte Fall ist fuer Single-Mode/Self-Host ohne
 * Subdomain-Routing gedacht, wo ohnehin nur ein Tenant existiert.
 *
 * LUMIO_DOMAIN_BASE zaehlt nur im Multi-Mode: im Single-Mode kann sie
 * trotzdem gesetzt sein (Vorbereitung auf einen spaeteren Wechsel), der
 * einzige Tenant heisst dort "default" — <default>.<base> loest nirgends
 * auf. Ein einzelner Tenant hat keinen eigenen Origin, PUBLIC_URL stimmt.
 *
 * Schema: aus PUBLIC_URL uebernommen (das ist bereits als URL validiert,
 * also eine zuverlaessigere Quelle als NODE_ENV — ein Self-Host kann
 * production ohne TLS-Terminierung fahren, dann waere NODE_ENV falsch).
 */
export function tenantPublicOrigin(tenant: TenantWithDomain): string {
  const proto = new URL(config.PUBLIC_URL).protocol.replace(":", "");
  if (tenant.customDomain) return `${proto}://${tenant.customDomain}`;
  const base =
    config.DEPLOYMENT_MODE === "multi"
      ? config.LUMIO_DOMAIN_BASE?.trim().toLowerCase()
      : undefined;
  if (base) return `${proto}://${tenant.slug}.${base}`;
  return config.PUBLIC_URL;
}
