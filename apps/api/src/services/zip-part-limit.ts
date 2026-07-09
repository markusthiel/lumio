/**
 * Lumio API — Effektive Download-Paketgröße (Teil-ZIP-Cap)
 *
 * Berechnet, wie groß ein einzelnes Download-Paket (Teil-ZIP) werden darf,
 * bevor der Worker einen Galerie-Download in mehrere ZIPs aufteilt:
 *   - Tenant-Setting (tenants.zipPartMaxMib) übersteuert den ENV-Default
 *   - ENV-Default (ZIP_PART_MAX_MIB, ersatzweise das alte ZIP_PART_MAX_BYTES)
 *   - Hard-Cap (config.ZIP_PART_MAX_HARD_CAP_MIB) als letzte Schutzlinie
 *     gegen Misskonfiguration / SaaS-Missbrauch (greift OBEN, auch wenn
 *     jemand tenants.zipPartMaxMib direkt in der DB hochsetzt).
 *
 * Returnt Bytes (das ist, was der Worker beim Splitten erwartet).
 */
import { config } from "../config.js";

const MIB = 1024 * 1024;

/** Effektiver globaler Default in MiB — bevorzugt ZIP_PART_MAX_MIB, sonst
 *  das alte ZIP_PART_MAX_BYTES (v0.45.0), sonst 8192 (8 GiB). */
export function zipPartDefaultMib(): number {
  if (config.ZIP_PART_MAX_MIB) return config.ZIP_PART_MAX_MIB;
  if (config.ZIP_PART_MAX_BYTES) {
    return Math.max(1, Math.round(config.ZIP_PART_MAX_BYTES / MIB));
  }
  return 8192;
}

export function zipPartHardCapMib(): number {
  return config.ZIP_PART_MAX_HARD_CAP_MIB;
}

/** Effektive Paketgröße in Bytes. tenantZipPartMaxMib = null → ENV-Default. */
export function effectiveZipPartBytes(tenantZipPartMaxMib: number | null): number {
  const mib = tenantZipPartMaxMib ?? zipPartDefaultMib();
  const capped = Math.min(mib, zipPartHardCapMib());
  return Math.max(1, capped) * MIB;
}
