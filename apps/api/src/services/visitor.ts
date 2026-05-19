/**
 * Lumio API — Gallery Visitor Session
 *
 * Wenn ein Kunde eine Galerie freigeschaltet hat (über Token in URL und
 * ggf. Passwort), setzen wir ein kurzlebiges signiertes Cookie. Damit
 * muss der Browser den Token nicht bei jedem Request mitschicken (was
 * im Referrer-Header leaken könnte) und das Passwort wird nur einmal
 * geprüft.
 *
 * Cookie-Payload (HMAC-signiert über SESSION_SECRET):
 *   {
 *     gid: <gallery-id>,
 *     aid: <access-id | null>,    // null wenn kein Token verwendet (z.B. nur Passwort)
 *     pw:  boolean,                // wurde das Galerie-Passwort eingegeben?
 *     exp: <unix-ms>
 *   }
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

const VISITOR_TTL_MS = 8 * 60 * 60 * 1000; // 8h

export const VISITOR_COOKIE_PREFIX = "lumio_v_"; // ein Cookie pro Galerie

export interface VisitorClaims {
  gid: string;
  aid: string | null;
  pw: boolean;
  exp: number;
}

function sign(payload: string): string {
  return createHmac("sha256", config.SESSION_SECRET)
    .update(payload)
    .digest("base64url");
}

export function createVisitorToken(claims: Omit<VisitorClaims, "exp">): string {
  const full: VisitorClaims = {
    ...claims,
    exp: Date.now() + VISITOR_TTL_MS,
  };
  const payload = Buffer.from(JSON.stringify(full)).toString("base64url");
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

export function verifyVisitorToken(token: string): VisitorClaims | null {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;

  const expected = sign(payload);
  if (
    expected.length !== sig.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
  ) {
    return null;
  }

  let claims: VisitorClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof claims.exp !== "number" || claims.exp < Date.now()) return null;
  return claims;
}

/** Cookie-Name für eine bestimmte Galerie. */
export function visitorCookieName(galleryId: string): string {
  // gallery-id mit base32-Suffix wäre sauberer, aber UUID hat schon nur
  // Hex+Dash und ist cookie-safe.
  return `${VISITOR_COOKIE_PREFIX}${galleryId.replace(/-/g, "")}`;
}
