/**
 * Tests die ohne DB-Anbindung laufen — pure Funktionen aus dem Auth-Service.
 */
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./auth.js";

describe("auth service", () => {
  describe("password hashing", () => {
    it("hashes and verifies a password", async () => {
      const hash = await hashPassword("correct-horse-battery-staple");
      expect(hash).toMatch(/^\$argon2id\$/);
      expect(await verifyPassword(hash, "correct-horse-battery-staple")).toBe(
        true
      );
    });

    it("rejects wrong passwords", async () => {
      const hash = await hashPassword("hunter2");
      expect(await verifyPassword(hash, "hunter3")).toBe(false);
    });

    it("returns false on malformed hash instead of throwing", async () => {
      expect(await verifyPassword("not-a-hash", "anything")).toBe(false);
    });

    it("produces different hashes for the same password (random salt)", async () => {
      const a = await hashPassword("same");
      const b = await hashPassword("same");
      expect(a).not.toBe(b);
    });
  });
});
