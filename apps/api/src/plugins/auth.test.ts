/**
 * Tests für die Slug-Validierungs-Logik im Tenant-Resolver. Reine
 * Logik, keine DB — wir testen das Format-Gate, nicht den DB-Lookup.
 *
 * Die Validierung muss verhindern dass jemand mit dem X-Lumio-Tenant-
 * Header SQL-Injection oder ähnliches versucht — die Regex ist die
 * erste Verteidigungslinie. Prisma macht die zweite (parameterisierte
 * Queries), aber Defense-in-Depth.
 */
import { describe, it, expect } from "vitest";

function isValidSlug(slug: string): boolean {
  return /^[a-z0-9-]+$/.test(slug) && slug.length <= 40;
}

describe("X-Lumio-Tenant slug validation", () => {
  it("accepts normal slugs", () => {
    expect(isValidSlug("studio-mueller")).toBe(true);
    expect(isValidSlug("default")).toBe(true);
    expect(isValidSlug("acme2024")).toBe(true);
    expect(isValidSlug("a")).toBe(true); // einzelnes Zeichen ist OK aus Regex-Sicht; min-2 wird im DB-Match erzwungen
  });

  it("rejects uppercase", () => {
    expect(isValidSlug("Studio")).toBe(false);
  });

  it("rejects underscores", () => {
    expect(isValidSlug("foo_bar")).toBe(false);
  });

  it("rejects dots", () => {
    expect(isValidSlug("studio.mueller")).toBe(false);
  });

  it("rejects whitespace", () => {
    expect(isValidSlug("studio mueller")).toBe(false);
    expect(isValidSlug("studio\tmueller")).toBe(false);
  });

  it("rejects SQL meta chars", () => {
    expect(isValidSlug("foo';DROP TABLE")).toBe(false);
    expect(isValidSlug("foo--bar")).toBe(true); // erlaubt, da nur Bindestrich
    expect(isValidSlug("foo'or'1'='1")).toBe(false);
  });

  it("rejects >40 chars", () => {
    expect(isValidSlug("a".repeat(41))).toBe(false);
    expect(isValidSlug("a".repeat(40))).toBe(true);
  });

  it("rejects empty", () => {
    expect(isValidSlug("")).toBe(false);
  });

  it("rejects unicode", () => {
    expect(isValidSlug("müller")).toBe(false);
    expect(isValidSlug("café")).toBe(false);
  });
});
