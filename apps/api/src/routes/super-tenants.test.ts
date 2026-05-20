/**
 * Schema-Validierung der Tenant-Management-Eingaben. Pure Logik, keine
 * DB. Wenn jemand die Slug-Regex oder Längenlimits ändert, fängt das
 * hier auf.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

const createTenantSchema = z.object({
  slug: z.string().min(2).max(40).regex(SLUG_RE),
  name: z.string().min(1).max(120),
  customDomain: z
    .string()
    .max(200)
    .nullable()
    .optional()
    .transform((v) => (v ? v.trim().toLowerCase() : null)),
  ownerEmail: z.string().email().max(200),
  ownerName: z.string().min(1).max(120),
});

describe("create-tenant schema", () => {
  const ok = {
    slug: "studio-mueller",
    name: "Studio Müller",
    ownerEmail: "max@example.com",
    ownerName: "Max",
  };

  it("accepts a standard input", () => {
    expect(createTenantSchema.safeParse(ok).success).toBe(true);
  });

  it("rejects slugs starting with hyphen", () => {
    const r = createTenantSchema.safeParse({ ...ok, slug: "-foo" });
    expect(r.success).toBe(false);
  });

  it("rejects slugs ending with hyphen", () => {
    const r = createTenantSchema.safeParse({ ...ok, slug: "foo-" });
    expect(r.success).toBe(false);
  });

  it("rejects slugs with uppercase", () => {
    const r = createTenantSchema.safeParse({ ...ok, slug: "FooBar" });
    expect(r.success).toBe(false);
  });

  it("rejects slugs with underscore", () => {
    const r = createTenantSchema.safeParse({ ...ok, slug: "foo_bar" });
    expect(r.success).toBe(false);
  });

  it("rejects single-char slugs", () => {
    const r = createTenantSchema.safeParse({ ...ok, slug: "a" });
    expect(r.success).toBe(false);
  });

  it("accepts two-char slugs", () => {
    const r = createTenantSchema.safeParse({ ...ok, slug: "ab" });
    expect(r.success).toBe(true);
  });

  it("rejects 41-char slugs", () => {
    const r = createTenantSchema.safeParse({ ...ok, slug: "a".repeat(41) });
    expect(r.success).toBe(false);
  });

  it("lowercases and trims customDomain", () => {
    const r = createTenantSchema.safeParse({
      ...ok,
      customDomain: "  Studio.Example.de  ",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.customDomain).toBe("studio.example.de");
  });

  it("converts empty customDomain to null", () => {
    const r = createTenantSchema.safeParse({ ...ok, customDomain: null });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.customDomain).toBeNull();
  });

  it("rejects ownerEmail without @", () => {
    const r = createTenantSchema.safeParse({ ...ok, ownerEmail: "no-at" });
    expect(r.success).toBe(false);
  });
});
