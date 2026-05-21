/**
 * Lumio API — Effective Upload Limit
 *
 * Berechnet das effektive Upload-Limit für ein File:
 *   - Tenant-Setting (tenants.maxUploadMib) übersteuert ENV-Default
 *   - UploadLink-Setting (upload_links.maxFileBytes) übersteuert Tenant
 *     (aber nur nach unten — Link-Limit MUSS ≤ Tenant-Limit sein,
 *     wird in der UploadLink-Validation erzwungen)
 *   - Hard-Cap (config.MAX_UPLOAD_HARD_CAP_MIB) als letzte Schutzlinie
 *     gegen Misskonfiguration. Greift OBEN — wenn z.B. jemand
 *     tenants.maxUploadMib direkt in der DB auf 99999 setzt, blocken
 *     wir hier trotzdem.
 *
 * Returnt das Limit in Bytes.
 */
import { config } from "../config.js";

export interface UploadLimitInputs {
  /** maxUploadMib aus tenants. Null = ENV-Default verwenden. */
  tenantMaxUploadMib: number | null;
  /** maxFileBytes aus upload_links. Null = Tenant-Limit erben. */
  linkMaxFileBytes?: bigint | null;
}

export function effectiveUploadLimitBytes(input: UploadLimitInputs): bigint {
  const hardCapBytes =
    BigInt(config.MAX_UPLOAD_HARD_CAP_MIB) * 1024n * 1024n;

  // 1) Tenant-Limit (oder ENV-Default)
  const tenantMib =
    input.tenantMaxUploadMib ?? config.MAX_FILE_SIZE_MIB;
  let limitBytes = BigInt(tenantMib) * 1024n * 1024n;

  // 2) Link-Limit (wenn gesetzt, runter — niemals rauf)
  if (
    input.linkMaxFileBytes !== undefined &&
    input.linkMaxFileBytes !== null
  ) {
    const linkBytes = BigInt(input.linkMaxFileBytes);
    if (linkBytes < limitBytes) limitBytes = linkBytes;
  }

  // 3) Hard-Cap als Obergrenze
  if (limitBytes > hardCapBytes) limitBytes = hardCapBytes;

  return limitBytes;
}

/** Format helper: Bytes → "X.X GB" / "Y MB" für User-facing Strings. */
export function formatLimit(bytes: bigint): string {
  const mb = Number(bytes / 1024n / 1024n);
  if (mb >= 1024) {
    const gb = mb / 1024;
    return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  }
  return `${mb} MB`;
}
