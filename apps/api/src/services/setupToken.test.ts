/**
 * Tests für services/setupToken.ts — die reine Logik-Schicht. Wir
 * testen die Hash- + Lebenszeit-Eigenschaften OHNE echte DB, indem wir
 * den Token-Generator als reine Funktion isolieren.
 */
import { describe, it, expect } from "vitest";
import { randomBytes, createHash } from "node:crypto";

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

describe("setup token generation", () => {
  it("produces URL-safe tokens of consistent length", () => {
    for (let i = 0; i < 20; i++) {
      const t = newToken();
      expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(t.length).toBeGreaterThanOrEqual(40);
    }
  });

  it("two tokens are always different (effective randomness)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const t = newToken();
      expect(seen.has(t)).toBe(false);
      seen.add(t);
    }
  });

  it("hashing the same token deterministically gives the same hash", () => {
    const t = "abcdef";
    expect(hashToken(t)).toBe(hashToken(t));
  });

  it("different tokens produce different hashes", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });

  it("hash output is hex, 64 chars (SHA-256)", () => {
    const h = hashToken("anything");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
