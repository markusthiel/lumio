/**
 * Lumio API — Password-Reset / Setup Tokens
 *
 * Verwaltet password_reset_tokens (siehe schema). Initial gibt's nur
 * den "setup"-Flow für neu eingeladene Tenant-Owner; "reset" (Passwort
 * vergessen) ist vorbereitet, aber noch nicht verdrahtet.
 *
 * Token-Sicherheit:
 *   - Klartext-Token nur einmal in der Mail; in der DB nur SHA-256-Hash
 *   - Default-Lebensdauer 72h (3 Tage) für setup — lang genug dass die
 *     Mail nicht im Spam liegt wenn der Owner Urlaub hat
 *   - One-Shot: nach Verwendung wird usedAt gesetzt und der Token ist
 *     nicht mehr einlösbar
 */
import { randomBytes, createHash } from "node:crypto";

import { prisma } from "../db.js";

const SETUP_TTL_MS = 72 * 60 * 60 * 1000;

function newToken(): string {
  // 32 bytes base64url = 43 chars, ausreichend Entropie + URL-safe.
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface CreateSetupTokenResult {
  /** Klartext-Token — einmalig an Mail-Versand übergeben, nicht speichern. */
  token: string;
  /** ID des persistierten Token-Eintrags — für Audit-Verweise. */
  tokenId: string;
  expiresAt: Date;
}

export async function createSetupToken(args: {
  userId: string;
  ttlMs?: number;
}): Promise<CreateSetupTokenResult> {
  const token = newToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + (args.ttlMs ?? SETUP_TTL_MS));

  // Existierende offene Setup-Tokens für denselben User zurücksetzen —
  // wenn jemand zweimal eingeladen wird, soll nur der neueste Link
  // funktionieren. Wir markieren die alten als "used" mit aktuellem
  // Timestamp; löschen wäre auch möglich, used setzen erhält den
  // Audit-Trail.
  await prisma.passwordResetToken.updateMany({
    where: { userId: args.userId, kind: "setup", usedAt: null },
    data: { usedAt: new Date() },
  });

  const row = await prisma.passwordResetToken.create({
    data: {
      userId: args.userId,
      tokenHash,
      kind: "setup",
      expiresAt,
    },
  });

  return { token, tokenId: row.id, expiresAt };
}

export interface SetupTokenLookup {
  tokenId: string;
  userId: string;
  expiresAt: Date;
}

/** Schlägt einen Setup-Token nach. Gibt null zurück wenn Token unbekannt,
 *  abgelaufen oder bereits verwendet. */
export async function lookupSetupToken(
  token: string
): Promise<SetupTokenLookup | null> {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      kind: true,
      expiresAt: true,
      usedAt: true,
    },
  });
  if (!row) return null;
  if (row.kind !== "setup") return null;
  if (row.usedAt) return null;
  if (row.expiresAt < new Date()) return null;
  return { tokenId: row.id, userId: row.userId, expiresAt: row.expiresAt };
}

/** Markiert einen Setup-Token als verbraucht. Idempotent: ein zweiter
 *  Aufruf passiert nichts. */
export async function consumeSetupToken(tokenId: string): Promise<void> {
  await prisma.passwordResetToken.update({
    where: { id: tokenId },
    data: { usedAt: new Date() },
  });
}
