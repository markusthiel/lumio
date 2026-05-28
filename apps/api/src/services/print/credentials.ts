/**
 * Lumio API — Credential-Verschluesselung
 *
 * Verschluesselt sensible Lab-API-Credentials at rest in der DB.
 * Aktuell ein einziger Use-Case: TenantPrintProvider.credentialsEnc.
 *
 * Algorithmus: AES-256-GCM (authenticated encryption). Pro Ciphertext
 * eine frische 12-Byte-Nonce. Ergebnis-Layout:
 *
 *   [version: 1 byte = 0x01][nonce: 12 bytes][ciphertext + tag]
 *
 * Der Master-Key wird via HKDF-SHA256 aus SESSION_SECRET abgeleitet —
 * also kein neues Env-Variable noetig. Wenn SESSION_SECRET sich aendert,
 * werden alle verschluesselten Credentials unleserlich; das ist OK weil
 * SESSION_SECRET ohnehin nur bei kompletter Re-Initialisierung wechselt.
 *
 * Rotation: wenn wir mal einen separaten Encryption-Key wollen, ist
 * der Version-Byte vorne dafuer vorgesehen. v1 = aktuelle Implementation.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import { config } from "../../config.js";

const VERSION = 0x01;
const NONCE_LEN = 12;
const KEY_LEN = 32; // 256 bit
const TAG_LEN = 16;
const ALGO = "aes-256-gcm";

let _key: Buffer | null = null;
function key(): Buffer {
  if (_key) return _key;
  // HKDF mit context-string fuer App-Trennung. Wenn wir mal libsodium-
  // basierte Keys oder einen anderen Use-Case dazunehmen, anderer info-
  // String → anderer Key.
  const derived = hkdfSync(
    "sha256",
    config.SESSION_SECRET,
    Buffer.alloc(0),
    "lumio:credential-encryption:v1",
    KEY_LEN
  );
  _key = Buffer.from(derived);
  return _key;
}

/** Verschluesselt ein beliebiges JSON-faehiges Object. Rueckgabe: Buffer
 *  fuer Bytes-DB-Column. Wirft bei Encryption-Fehler. */
export function encryptCredentials(plain: Record<string, unknown>): Buffer {
  const plaintext = Buffer.from(JSON.stringify(plain), "utf8");
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv(ALGO, key(), nonce);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  // [version][nonce][ciphertext][tag]
  return Buffer.concat([Buffer.from([VERSION]), nonce, enc, tag]);
}

/** Entschluesselt ein zuvor mit encryptCredentials gebautes Blob.
 *  Wirft bei Tampering (Auth-Tag invalid), unbekannter Version, oder
 *  Format-Fehler. */
export function decryptCredentials(blob: Buffer): Record<string, unknown> {
  if (blob.length < 1 + NONCE_LEN + TAG_LEN) {
    throw new Error("credential blob too short");
  }
  const version = blob[0];
  if (version !== VERSION) {
    throw new Error(`unsupported credential blob version: ${version}`);
  }
  const nonce = blob.subarray(1, 1 + NONCE_LEN);
  const tag = blob.subarray(blob.length - TAG_LEN);
  const enc = blob.subarray(1 + NONCE_LEN, blob.length - TAG_LEN);
  const decipher = createDecipheriv(ALGO, key(), nonce);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(enc), decipher.final()]);
  return JSON.parse(plain.toString("utf8")) as Record<string, unknown>;
}

/** Helper: redacted Repraesentation fuer UI/Logs. Zeigt nur welche
 *  Felder existieren, nie die Werte. */
export function redactCredentials(plain: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(plain)) {
    out[k] = "••••••••";
  }
  return out;
}
