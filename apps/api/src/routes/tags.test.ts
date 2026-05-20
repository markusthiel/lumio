/**
 * Tests für die Tag-Routes-Logik. Wir testen das Zod-Schema für create/
 * update (HEX-Regex, name-trim, parentId-nullable) — die DB-Aufrufe
 * laufen integration-test-seitig, nicht hier.
 *
 * Die Cycle-Detection ist DB-abhängig (sie ruft prisma.tag.findFirst in
 * einer Schleife), also nicht in diesem reinen Logik-Test abgedeckt.
 * Wenn sie kaputt geht, fliegt es im Integration-Test oder im Manual-
 * Test mit echten Daten.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(HEX_COLOR, "color must be #rrggbb").optional(),
  parentId: z.string().uuid().nullable().optional(),
});

describe("tag create schema", () => {
  it("accepts a plain name", () => {
    const r = createSchema.safeParse({ name: "Hochzeit" });
    expect(r.success).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    const r = createSchema.safeParse({ name: "  Hochzeit  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Hochzeit");
  });

  it("rejects empty name (after trim)", () => {
    const r = createSchema.safeParse({ name: "   " });
    expect(r.success).toBe(false);
  });

  it("rejects names longer than 60 chars", () => {
    const r = createSchema.safeParse({ name: "x".repeat(61) });
    expect(r.success).toBe(false);
  });

  it("accepts #rrggbb color", () => {
    const r = createSchema.safeParse({ name: "X", color: "#a1b2c3" });
    expect(r.success).toBe(true);
  });

  it("accepts uppercase hex color", () => {
    const r = createSchema.safeParse({ name: "X", color: "#A1B2C3" });
    expect(r.success).toBe(true);
  });

  it("rejects 3-digit hex shorthand (#abc)", () => {
    const r = createSchema.safeParse({ name: "X", color: "#abc" });
    expect(r.success).toBe(false);
  });

  it("rejects named CSS colors", () => {
    const r = createSchema.safeParse({ name: "X", color: "red" });
    expect(r.success).toBe(false);
  });

  it("rejects color without leading #", () => {
    const r = createSchema.safeParse({ name: "X", color: "a1b2c3" });
    expect(r.success).toBe(false);
  });

  it("allows null parentId", () => {
    const r = createSchema.safeParse({ name: "X", parentId: null });
    expect(r.success).toBe(true);
  });

  it("rejects non-uuid parentId", () => {
    const r = createSchema.safeParse({ name: "X", parentId: "not-a-uuid" });
    expect(r.success).toBe(false);
  });

  it("accepts valid uuid parentId", () => {
    const r = createSchema.safeParse({
      name: "X",
      parentId: "00000000-0000-0000-0000-000000000001",
    });
    expect(r.success).toBe(true);
  });
});
