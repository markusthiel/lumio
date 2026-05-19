/**
 * Lumio API — Slug & Token Generator
 *
 * Kryptografisch zufällige, URL-sichere Strings.
 * Verwendet base32 (kein 0/O/1/I-Konflikt) für menschenfreundliche Slugs,
 * und base64url für Access-Tokens (mehr Entropie pro Zeichen).
 */
import { randomBytes } from "node:crypto";

const BASE32_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"; // 31 chars, ohne 0/1/i/l/o

/**
 * Galerie-Slug: 12 Zeichen base32, ca. 60 Bit Entropie.
 * Reicht für Milliarden Galerien ohne Kollision.
 */
export function generateGallerySlug(length = 12): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += BASE32_ALPHABET[bytes[i] % BASE32_ALPHABET.length];
  }
  return out;
}

/**
 * Access-Token: 32 zufällige Bytes als base64url. Wird in URLs verwendet
 * und sollte nicht erratbar sein.
 */
export function generateAccessToken(): string {
  return randomBytes(32).toString("base64url");
}
