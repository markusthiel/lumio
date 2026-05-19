/**
 * Lumio API — Login Challenge Tokens
 *
 * Wenn 2FA aktiv ist, wird der Login-Flow zweistufig:
 *   1. POST /auth/login  → liefert challenge token (1 Min TTL)
 *   2. POST /auth/login/totp → verifiziert TOTP + Challenge, gibt Session
 *
 * Der Challenge bindet:
 *   - userId (welcher User darf den TOTP einlösen)
 *   - ipAddress (gegen einfaches Diebstahl-Replay)
 *   - userAgentHash (gegen einfaches Diebstahl-Replay)
 *   - exp (kurzlebig)
 *
 * HMAC über config.SESSION_SECRET — gleiche Strategie wie Visitor-Cookies.
 */
import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { config } from "../config.js";

const CHALLENGE_TTL_MS = 60 * 1000;

export interface ChallengeClaims {
  uid: string;
  ipHash: string;
  uaHash: string;
  exp: number;
}

function sign(payload: string): string {
  return createHmac("sha256", config.SESSION_SECRET)
    .update(payload)
    .digest("base64url");
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("base64url").slice(0, 16);
}

export function createLoginChallenge(opts: {
  userId: string;
  ipAddress: string;
  userAgent: string | null;
}): string {
  const claims: ChallengeClaims = {
    uid: opts.userId,
    ipHash: fingerprint(opts.ipAddress),
    uaHash: fingerprint(opts.userAgent ?? ""),
    exp: Date.now() + CHALLENGE_TTL_MS,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

export function verifyLoginChallenge(
  challenge: string,
  ctx: { ipAddress: string; userAgent: string | null }
): ChallengeClaims | null {
  if (!challenge || !challenge.includes(".")) return null;
  const [payload, sig] = challenge.split(".");
  if (!payload || !sig) return null;

  const expected = sign(payload);
  if (
    expected.length !== sig.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
  ) {
    return null;
  }

  let claims: ChallengeClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof claims.exp !== "number" || claims.exp < Date.now()) return null;

  // Bindings prüfen — bewusst nicht zu hart (mobile IP wechselt ständig),
  // wir vergleichen nur die fingerprints. Wenn beide stimmen, ist's
  // mit hoher Wahrscheinlichkeit dieselbe Session.
  if (fingerprint(ctx.ipAddress) !== claims.ipHash) return null;
  if (fingerprint(ctx.userAgent ?? "") !== claims.uaHash) return null;

  return claims;
}
