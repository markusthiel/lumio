/**
 * Lumio API — Upload-Allowlist
 *
 * Bestimmt, welche Datei-Arten (FileKind) beim Upload akzeptiert werden.
 * Zwei Ebenen, analog zum Upload-Limit:
 *   - ENV-Default: config.UPLOAD_ALLOWED_KINDS (kommagetrennt)
 *   - Pro-Tenant-Override: tenants.uploadAllowedKinds (Null = ENV erben)
 *
 * "other" in der Liste = beliebige Dateien erlaubt (Filter effektiv aus).
 */
import { config } from "../config.js";
import type { FileKind } from "./filekind.js";

export const ALL_FILE_KINDS: FileKind[] = [
  "image",
  "heic",
  "raw",
  "video",
  "pdf",
  "other",
];

/** Parst eine kommagetrennte Liste zu validen FileKinds (unbekannte raus). */
export function parseAllowedKinds(raw: string | null | undefined): FileKind[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: FileKind[] = [];
  for (const part of raw.split(",")) {
    const k = part.trim().toLowerCase();
    if ((ALL_FILE_KINDS as string[]).includes(k) && !seen.has(k)) {
      seen.add(k);
      out.push(k as FileKind);
    }
  }
  return out;
}

/** ENV-Default als FileKind-Array. */
export function defaultAllowedKinds(): FileKind[] {
  return parseAllowedKinds(config.UPLOAD_ALLOWED_KINDS);
}

/**
 * Effektive Allowlist: Tenant-Override falls gesetzt (nicht leer), sonst
 * ENV-Default. Ein leerer/ungueltiger Tenant-Wert faellt bewusst auf den
 * Default zurueck — so kann ein Studio sich nicht versehentlich komplett
 * aussperren.
 */
export function effectiveAllowedKinds(
  tenantSetting: string | null | undefined
): FileKind[] {
  const tenant = parseAllowedKinds(tenantSetting);
  if (tenant.length > 0) return tenant;
  return defaultAllowedKinds();
}

export function isKindAllowed(kind: FileKind, allowed: FileKind[]): boolean {
  return allowed.includes(kind);
}
