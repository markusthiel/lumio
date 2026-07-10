/**
 * Lumio — Marketing-Opt-out-Token
 *
 * Erzeugt und verifiziert signierte Tokens für den öffentlichen
 * Unsubscribe-Link in Marketing-Mails. Kein Login nötig — der Token
 * beweist, dass der Empfänger Zugriff auf das Postfach hat.
 *
 * Format: base64url( JSON{ tenantId, exp } ) + "." + HMAC-SHA256-Sig
 * HMAC-Key: config.JWT_SECRET (bereits für Session-Signing genutzt)
 *
 * TTL: 90 Tage. Nach Ablauf einfach im Studio oder per Mail toggelbar.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 Tage

interface TokenPayload {
  tenantId: string;
  exp: number; // Unix-ms
}

function sign(payload: string): string {
  return createHmac("sha256", config.JWT_SECRET)
    .update(payload)
    .digest("base64url");
}

/** Erstellt einen signierten Unsubscribe-Token für einen Tenant. */
export function createUnsubscribeToken(tenantId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ tenantId, exp: Date.now() + TOKEN_TTL_MS })
  ).toString("base64url");
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

/** Erstellt die vollständige Unsubscribe-URL für eine Mail. */
export function unsubscribeUrl(tenantId: string, baseUrl: string): string {
  const token = createUnsubscribeToken(tenantId);
  return `${baseUrl}/api/v1/billing/unsubscribe-marketing?token=${token}`;
}

/** Verifiziert den Token. Gibt tenantId zurück oder null bei Fehler. */
export function verifyUnsubscribeToken(token: string): string | null {
  try {
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return null;

    // Timing-safe compare
    const expected = Buffer.from(sign(payload));
    const actual = Buffer.from(sig);
    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    )
      return null;

    const data = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as TokenPayload;

    if (data.exp < Date.now()) return null; // abgelaufen
    return data.tenantId;
  } catch {
    return null;
  }
}
