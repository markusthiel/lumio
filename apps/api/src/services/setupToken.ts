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
import { config } from "../config.js";

function newToken(): string {
  // 32 bytes base64url = 43 chars, ausreichend Entropie + URL-safe.
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Voll-qualifizierte URL zur Setup-Page. PUBLIC_URL ist die Studio-
 *  URL (z.B. https://studio.lumio-cloud.de). */
export function buildSetupUrl(token: string): string {
  const base = config.PUBLIC_URL.replace(/\/+$/, "");
  return `${base}/auth/setup-password?token=${encodeURIComponent(token)}`;
}

/** Voll-qualifizierte URL zur Passwort-Reset-Page. Anderer Pfad als
 *  Setup damit das Frontend pro Kind passende UX zeigt (Setup = Welcome,
 *  Reset = Passwort-Aenderung). */
export function buildResetUrl(token: string): string {
  const base = config.PUBLIC_URL.replace(/\/+$/, "");
  return `${base}/auth/reset-password?token=${encodeURIComponent(token)}`;
}

/** Voll-qualifizierte URL zur Email-Change-Bestaetigung. Der Link
 *  wird an die NEUE Adresse geschickt — sobald der User klickt, ist
 *  der Wechsel vollzogen. */
export function buildEmailChangeUrl(token: string): string {
  const base = config.PUBLIC_URL.replace(/\/+$/, "");
  return `${base}/auth/confirm-email?token=${encodeURIComponent(token)}`;
}

/** Token-Kinds. 'setup' = Erstanmeldung nach Invite (72h TTL),
 *  'reset' = Passwort vergessen (24h TTL, knapper weil Recovery-Mails
 *  schneller benutzt werden sollten), 'email_change' = E-Mail-Wechsel
 *  bestaetigen (24h TTL), 'impersonate' = Einmal-Token fuer Super-Admin-
 *  Cross-Subdomain-Login (60s TTL, one-shot). */
export type TokenKind = "setup" | "reset" | "email_change" | "impersonate";

const TTL_MS: Record<TokenKind, number> = {
  setup: 72 * 60 * 60 * 1000,
  reset: 24 * 60 * 60 * 1000,
  email_change: 24 * 60 * 60 * 1000,
  impersonate: 60 * 1000, // 60 Sekunden — nur zum Cross-Domain-Redeem
};

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
  kind?: TokenKind;
  /** Token-spezifischer Payload (z.B. { newEmail: "..." } fuer
   *  email_change). Wird beim Lookup mitgeliefert. */
  payload?: Record<string, unknown>;
}): Promise<CreateSetupTokenResult> {
  const kind: TokenKind = args.kind ?? "setup";
  const token = newToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + (args.ttlMs ?? TTL_MS[kind]));

  // Existierende offene Tokens DESSELBEN KIND für denselben User
  // zurücksetzen. Wir invalidieren NICHT kind-uebergreifend — ein
  // ausstehender Setup-Token (Invite-Mail unterwegs) soll nicht
  // durch einen Reset-Request weggeworfen werden.
  await prisma.passwordResetToken.updateMany({
    where: { userId: args.userId, kind, usedAt: null },
    data: { usedAt: new Date() },
  });

  const row = await prisma.passwordResetToken.create({
    data: {
      userId: args.userId,
      tokenHash,
      kind,
      expiresAt,
      // Prisma's InputJsonValue ist strikter als Record<string, unknown>;
      // wir wissen dass das nur einfache plain-Objects sind und casten.
      payload: (args.payload ?? null) as never,
    },
  });

  return { token, tokenId: row.id, expiresAt };
}

export interface SetupTokenLookup {
  tokenId: string;
  userId: string;
  expiresAt: Date;
  /** Token-spezifischer Payload (z.B. { newEmail } fuer email_change).
   *  Bei setup/reset typischerweise null. */
  payload: Record<string, unknown> | null;
}

/** Schlägt einen Token nach. Gibt null zurück wenn Token unbekannt,
 *  abgelaufen, bereits verwendet, oder ein anderer Kind als erwartet.
 *  expectedKind erlaubt die Funktion fuer Setup und Reset zu nutzen
 *  ohne Cross-Kind-Verwechslung (ein Reset-Token darf nicht beim
 *  Setup-Flow eingelöst werden — Setup setzt die Identität anders
 *  als Reset). */
export async function lookupSetupToken(
  token: string,
  expectedKind: TokenKind = "setup"
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
      payload: true,
    },
  });
  if (!row) return null;
  if (row.kind !== expectedKind) return null;
  if (row.usedAt) return null;
  if (row.expiresAt < new Date()) return null;
  return {
    tokenId: row.id,
    userId: row.userId,
    expiresAt: row.expiresAt,
    payload: (row.payload as Record<string, unknown> | null) ?? null,
  };
}

/** Markiert einen Setup-Token als verbraucht. Idempotent: ein zweiter
 *  Aufruf passiert nichts. */
export async function consumeSetupToken(tokenId: string): Promise<void> {
  await prisma.passwordResetToken.update({
    where: { id: tokenId },
    data: { usedAt: new Date() },
  });
}
