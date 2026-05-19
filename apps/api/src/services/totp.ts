/**
 * Lumio API — TOTP / 2FA Service
 *
 * Verwendet otplib v13 (async-first, audited Crypto via @noble/hashes).
 *
 * Flow:
 *   1. setupTotp(userId)        → generiert temp Secret + QR-Code
 *                                  Secret wird in user.totpSecret gespeichert,
 *                                  totpEnabled bleibt false bis Verify
 *   2. activateTotp(userId, t)  → prüft den ersten Token, aktiviert 2FA und
 *                                  liefert die Backup-Codes
 *   3. verifyTotp(secret, t)    → wird im Login-Flow aufgerufen
 *   4. consumeBackupCode(uid,c) → einmaliger Code als Fallback
 *   5. disableTotp(userId)      → schaltet 2FA aus
 *
 * Backup-Codes: 8 Stück à 10 hex chars, sha256-gehasht in der DB.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  generateSecret as otplibGenerateSecret,
  generate as otplibGenerate,
  verify as otplibVerify,
  generateURI as otplibGenerateURI,
} from "otplib";
import QRCode from "qrcode";

import { prisma } from "../db.js";

const ISSUER = "Lumio";
const BACKUP_CODE_COUNT = 8;
const BACKUP_CODE_BYTES = 5; // 10 hex chars

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
export async function setupTotp(userId: string): Promise<{
  secret: string;
  qrDataUrl: string;
  otpauthUri: string;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, tenantId: true, totpEnabled: true },
  });
  if (!user) throw new Error("user_not_found");
  if (user.totpEnabled) throw new Error("totp_already_enabled");

  const tenant = await prisma.tenant.findUnique({
    where: { id: user.tenantId },
    select: { name: true },
  });

  const secret = otplibGenerateSecret();
  // Label: <tenant>:<email> — so steht's auch in Google Authenticator
  const label = `${tenant?.name ?? ISSUER}:${user.email}`;
  const otpauthUri = otplibGenerateURI({
    issuer: ISSUER,
    label,
    secret,
  });

  // Secret temporär speichern; totpEnabled bleibt false
  await prisma.user.update({
    where: { id: userId },
    data: { totpSecret: secret, totpEnabled: false },
  });

  const qrDataUrl = await QRCode.toDataURL(otpauthUri, {
    errorCorrectionLevel: "M",
    width: 280,
  });

  return { secret, qrDataUrl, otpauthUri };
}

// ---------------------------------------------------------------------------
// Activate
// ---------------------------------------------------------------------------
export async function activateTotp(
  userId: string,
  token: string
): Promise<{ backupCodes: string[] }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpSecret: true, totpEnabled: true },
  });
  if (!user || !user.totpSecret) {
    throw new Error("setup_required");
  }
  if (user.totpEnabled) {
    throw new Error("already_activated");
  }

  const result = await otplibVerify({ secret: user.totpSecret, token });
  if (!result.valid) {
    throw new Error("invalid_token");
  }

  // Backup-Codes generieren — Klartext zurück an den User (einmalig anzeigen),
  // Hashes in die DB
  const codes: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const code = randomBytes(BACKUP_CODE_BYTES).toString("hex"); // 10 chars
    codes.push(formatBackupCode(code));
    hashes.push(hashCode(code));
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      totpEnabled: true,
      totpBackupCodes: hashes.join(","),
    },
  });

  return { backupCodes: codes };
}

// ---------------------------------------------------------------------------
// Verify (im Login-Flow)
// ---------------------------------------------------------------------------
export async function verifyTotpForUser(
  userId: string,
  token: string
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpSecret: true, totpEnabled: true },
  });
  if (!user || !user.totpEnabled || !user.totpSecret) return false;

  // Trim damit "012 345" auch geht — und entferne Whitespace zwischen Digits
  const cleaned = token.replace(/\s+/g, "");
  // Backup-Code als Alternative
  if (/^[0-9a-f]{4}-[0-9a-f]{6}$/i.test(token.trim())) {
    return consumeBackupCode(userId, token.trim());
  }
  if (!/^\d{6}$/.test(cleaned)) return false;

  const result = await otplibVerify({
    secret: user.totpSecret,
    token: cleaned,
  });
  return result.valid;
}

// ---------------------------------------------------------------------------
// Backup-Codes
// ---------------------------------------------------------------------------
/**
 * Versucht einen Backup-Code einzulösen. Bei Erfolg wird der Code aus der
 * Liste entfernt (one-time-use). Zeitkonstanter Vergleich pro Eintrag.
 */
export async function consumeBackupCode(
  userId: string,
  code: string
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpBackupCodes: true, totpEnabled: true },
  });
  if (!user || !user.totpEnabled || !user.totpBackupCodes) return false;

  // Code-Format normalisieren: "ab12-3c4d5e" → "ab123c4d5e"
  const normalized = code.replace(/[-\s]/g, "").toLowerCase();
  if (!/^[0-9a-f]{10}$/.test(normalized)) return false;

  const targetHash = hashCode(normalized);
  const codes = user.totpBackupCodes.split(",").filter(Boolean);

  let matchIdx = -1;
  for (let i = 0; i < codes.length; i++) {
    if (timingSafeEqualStr(codes[i], targetHash)) {
      matchIdx = i;
      break;
    }
  }
  if (matchIdx === -1) return false;

  // Code entfernen — atomar via update
  codes.splice(matchIdx, 1);
  await prisma.user.update({
    where: { id: userId },
    data: { totpBackupCodes: codes.join(",") },
  });
  return true;
}

/** Anzahl verbleibender Backup-Codes (für UI) */
export async function backupCodeCount(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpBackupCodes: true },
  });
  if (!user?.totpBackupCodes) return 0;
  return user.totpBackupCodes.split(",").filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Disable
// ---------------------------------------------------------------------------
/**
 * Schaltet 2FA für den User aus. Erwartet einen gültigen Token oder
 * Backup-Code als Bestätigung — damit jemand, der das Studio-Tab geöffnet
 * hat, nicht einfach das 2FA wegklicken kann.
 */
export async function disableTotp(
  userId: string,
  confirmationToken: string
): Promise<boolean> {
  const ok = await verifyTotpForUser(userId, confirmationToken);
  if (!ok) return false;
  await prisma.user.update({
    where: { id: userId },
    data: {
      totpEnabled: false,
      totpSecret: null,
      totpBackupCodes: null,
    },
  });
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function formatBackupCode(raw: string): string {
  // 1234567890 → "1234-567890" (lesbarer für den User)
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Tests-only — TOTP gegen ein Secret generieren
export async function _generateForTest(secret: string): Promise<string> {
  return otplibGenerate({ secret });
}
