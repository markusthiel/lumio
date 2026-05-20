/**
 * Tests für die Section-Schemas (Zod-Validierung).
 *
 * Pure Schema-Tests ohne DB-Roundtrip — die Section-Routes ruft
 * .parse() auf Request-Bodies; wenn die Schemas falsch sind, kommt
 * 400 statt sinnvoller Reaktion.
 *
 * Die Ownership-Checks (findOwnedGallery, FK-Validierung gegen
 * fremde Galerien) sind DB-abhängig und werden integrationsseitig
 * abgedeckt.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";

// Schemas eins-zu-eins aus galleries.ts kopiert. Wenn dort etwas
// geändert wird, fliegt es hier auf — Synchronisation per Code-Review.
const sectionCreateSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(400).nullable().optional(),
  coverFileId: z.string().uuid().nullable().optional(),
});

const sectionUpdateSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(400).nullable().optional(),
  coverFileId: z.string().uuid().nullable().optional(),
  sortIndex: z.number().int().min(0).max(10_000).optional(),
});

const sectionReorderSchema = z.object({
  order: z.array(z.string().uuid()).min(1).max(100),
});

const sectionAssignSchema = z.object({
  fileIds: z.array(z.string().uuid()).min(1).max(500),
});

const UUID = "11111111-2222-3333-4444-555555555555";
const UUID2 = "11111111-2222-3333-4444-666666666666";

describe("section create schema", () => {
  it("accepts a plain title", () => {
    const r = sectionCreateSchema.safeParse({ title: "Vorbereitung" });
    expect(r.success).toBe(true);
  });

  it("rejects empty title", () => {
    const r = sectionCreateSchema.safeParse({ title: "" });
    expect(r.success).toBe(false);
  });

  it("rejects titles longer than 120 chars", () => {
    const r = sectionCreateSchema.safeParse({ title: "x".repeat(121) });
    expect(r.success).toBe(false);
  });

  it("accepts description up to 400 chars", () => {
    const r = sectionCreateSchema.safeParse({
      title: "X",
      description: "y".repeat(400),
    });
    expect(r.success).toBe(true);
  });

  it("rejects description longer than 400 chars", () => {
    const r = sectionCreateSchema.safeParse({
      title: "X",
      description: "y".repeat(401),
    });
    expect(r.success).toBe(false);
  });

  it("accepts null coverFileId (= no cover)", () => {
    const r = sectionCreateSchema.safeParse({ title: "X", coverFileId: null });
    expect(r.success).toBe(true);
  });

  it("accepts a valid UUID coverFileId", () => {
    const r = sectionCreateSchema.safeParse({ title: "X", coverFileId: UUID });
    expect(r.success).toBe(true);
  });

  it("rejects non-UUID coverFileId", () => {
    const r = sectionCreateSchema.safeParse({
      title: "X",
      coverFileId: "not-a-uuid",
    });
    expect(r.success).toBe(false);
  });
});

describe("section update schema", () => {
  it("accepts partial update (just title)", () => {
    const r = sectionUpdateSchema.safeParse({ title: "Neu" });
    expect(r.success).toBe(true);
  });

  it("accepts partial update (just sortIndex)", () => {
    const r = sectionUpdateSchema.safeParse({ sortIndex: 50 });
    expect(r.success).toBe(true);
  });

  it("accepts empty update (no fields)", () => {
    // Praktisch nutzlos, aber kein Fehler — Caller bekommt unveränderte
    // Section zurück.
    const r = sectionUpdateSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it("rejects negative sortIndex", () => {
    const r = sectionUpdateSchema.safeParse({ sortIndex: -1 });
    expect(r.success).toBe(false);
  });

  it("rejects sortIndex over 10000", () => {
    const r = sectionUpdateSchema.safeParse({ sortIndex: 10001 });
    expect(r.success).toBe(false);
  });

  it("rejects float sortIndex", () => {
    const r = sectionUpdateSchema.safeParse({ sortIndex: 2.5 });
    expect(r.success).toBe(false);
  });
});

describe("section reorder schema", () => {
  it("accepts a small ordered list", () => {
    const r = sectionReorderSchema.safeParse({ order: [UUID, UUID2] });
    expect(r.success).toBe(true);
  });

  it("rejects empty order array", () => {
    const r = sectionReorderSchema.safeParse({ order: [] });
    expect(r.success).toBe(false);
  });

  it("rejects non-UUID entries", () => {
    const r = sectionReorderSchema.safeParse({ order: ["abc", UUID] });
    expect(r.success).toBe(false);
  });

  it("rejects order list over 100 entries", () => {
    const r = sectionReorderSchema.safeParse({
      order: Array.from({ length: 101 }, () => UUID),
    });
    expect(r.success).toBe(false);
  });
});

describe("section assign schema", () => {
  it("accepts a single file UUID", () => {
    const r = sectionAssignSchema.safeParse({ fileIds: [UUID] });
    expect(r.success).toBe(true);
  });

  it("accepts up to 500 file UUIDs", () => {
    const r = sectionAssignSchema.safeParse({
      fileIds: Array.from({ length: 500 }, () => UUID),
    });
    expect(r.success).toBe(true);
  });

  it("rejects empty fileIds", () => {
    const r = sectionAssignSchema.safeParse({ fileIds: [] });
    expect(r.success).toBe(false);
  });

  it("rejects more than 500 fileIds (bulk-bomb protection)", () => {
    const r = sectionAssignSchema.safeParse({
      fileIds: Array.from({ length: 501 }, () => UUID),
    });
    expect(r.success).toBe(false);
  });

  it("rejects non-UUID entries", () => {
    const r = sectionAssignSchema.safeParse({ fileIds: [UUID, "nope"] });
    expect(r.success).toBe(false);
  });
});
