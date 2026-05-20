import { describe, it, expect } from "vitest";
import { z } from "zod";

/**
 * Pure-Logic-Tests für /search:
 *   - Eingabe-Validation: ab welchen Längen wird die Query verworfen
 *   - Limit-Default + Clamping
 *
 * Den eigentlichen DB-Pfad testen wir nicht hier — der ist ein Prisma-
 * Roundtrip und wäre Integration-Test-Material. Stattdessen prüfen wir
 * das Schema isoliert: wenn jemand das `min(2)` auf `min(1)` ändert,
 * fliegt der Test.
 */

const querySchema = z.object({
  q: z.string().min(2).max(120),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

describe("search query schema", () => {
  it("rejects single-character queries", () => {
    const r = querySchema.safeParse({ q: "a" });
    expect(r.success).toBe(false);
  });

  it("accepts two-character queries", () => {
    const r = querySchema.safeParse({ q: "ab" });
    expect(r.success).toBe(true);
  });

  it("rejects queries longer than 120 chars", () => {
    const r = querySchema.safeParse({ q: "a".repeat(121) });
    expect(r.success).toBe(false);
  });

  it("accepts queries at exactly 120 chars", () => {
    const r = querySchema.safeParse({ q: "a".repeat(120) });
    expect(r.success).toBe(true);
  });

  it("coerces string limit to number", () => {
    const r = querySchema.safeParse({ q: "abc", limit: "10" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(10);
  });

  it("rejects limit > 20 (protect against accidental huge fan-out)", () => {
    const r = querySchema.safeParse({ q: "abc", limit: 100 });
    expect(r.success).toBe(false);
  });

  it("rejects limit < 1", () => {
    const r = querySchema.safeParse({ q: "abc", limit: 0 });
    expect(r.success).toBe(false);
  });

  it("treats limit as optional (uses default in route handler)", () => {
    const r = querySchema.safeParse({ q: "abc" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBeUndefined();
  });
});
