import { describe, it, expect } from "vitest";

/**
 * Logic-Tests für die /events Query-Parser-Logik und den Cursor.
 * Die DB-Pfade sind über Integration abgedeckt; hier nur die Parts,
 * die User-Input fressen müssen.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseGalleryId(raw: unknown): string | undefined {
  return typeof raw === "string" && UUID_RE.test(raw) ? raw : undefined;
}

function parseLimit(raw: unknown): number {
  const n = parseInt(typeof raw === "string" ? raw : "100", 10) || 100;
  return Math.min(500, Math.max(1, n));
}

function parseDate(raw: unknown): Date | undefined | "bad" {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") return "bad";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "bad";
  return d;
}

interface AuditCursor {
  c: string;
  i: string;
}
function encodeCursor(cur: AuditCursor): string {
  return Buffer.from(JSON.stringify(cur), "utf8").toString("base64url");
}
function decodeCursor(raw: string): AuditCursor | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8")
    ) as Partial<AuditCursor>;
    if (!parsed.c || !parsed.i) return null;
    return { c: parsed.c, i: parsed.i };
  } catch {
    return null;
  }
}

describe("audit query validation", () => {
  it("accepts valid UUID galleryId", () => {
    expect(parseGalleryId("11111111-1111-1111-1111-111111111111")).toBe(
      "11111111-1111-1111-1111-111111111111"
    );
  });
  it("rejects garbage galleryId", () => {
    expect(parseGalleryId("not-a-uuid")).toBeUndefined();
    expect(parseGalleryId("' OR 1=1; --")).toBeUndefined();
    expect(parseGalleryId("")).toBeUndefined();
    expect(parseGalleryId(undefined)).toBeUndefined();
  });

  it("clamps limit to [1, 500]", () => {
    expect(parseLimit("1")).toBe(1);
    expect(parseLimit("100")).toBe(100);
    expect(parseLimit("999")).toBe(500);
    expect(parseLimit("0")).toBe(100); // 0 → fallback parseInt result, then clamped
    expect(parseLimit("garbage")).toBe(100);
    expect(parseLimit(undefined)).toBe(100);
  });

  it("parses valid ISO dates", () => {
    const d = parseDate("2026-05-01T00:00:00Z");
    expect(d).toBeInstanceOf(Date);
    expect((d as Date).getUTCFullYear()).toBe(2026);
  });
  it("flags invalid dates", () => {
    expect(parseDate("not-a-date")).toBe("bad");
    expect(parseDate("2026-13-99")).toBe("bad");
  });
  it("passes through missing dates", () => {
    expect(parseDate(undefined)).toBeUndefined();
  });
});

describe("audit cursor roundtrip", () => {
  it("encodes and decodes a cursor losslessly", () => {
    const cur: AuditCursor = {
      c: "2026-05-19T12:34:56.789Z",
      i: "11111111-1111-1111-1111-111111111111",
    };
    const enc = encodeCursor(cur);
    expect(enc).not.toContain("=");
    expect(enc).not.toContain("/");
    expect(enc).not.toContain("+");
    const dec = decodeCursor(enc);
    expect(dec).toEqual(cur);
  });

  it("rejects garbage cursors", () => {
    expect(decodeCursor("not-base64!@#")).toBeNull();
    expect(decodeCursor("aGVsbG8=")).toBeNull(); // "hello" — no c/i fields
    expect(decodeCursor("")).toBeNull();
  });

  it("rejects incomplete cursors", () => {
    // base64 of {"c":"2026-05-19T12:34:56.789Z"} — missing i
    const partial = Buffer.from(
      JSON.stringify({ c: "2026-05-19T12:34:56.789Z" })
    ).toString("base64url");
    expect(decodeCursor(partial)).toBeNull();
  });
});
