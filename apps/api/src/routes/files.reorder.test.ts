import { describe, it, expect } from "vitest";

/**
 * Validations für den /files/reorder-Endpoint isoliert getestet. Die
 * DB-Pfade (Ownership-Check, Transaction) sind über die Integration-Tests
 * abgedeckt; hier prüfen wir nur die Eingangs-Validation, weil die
 * öffentlich anfechtbar ist.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateReorderRequest(
  body: unknown
): { ok: true } | { error: string } {
  if (!body || typeof body !== "object") return { error: "bad_request" };
  const b = body as Record<string, unknown>;
  if (typeof b.galleryId !== "string") return { error: "bad_request" };
  if (!Array.isArray(b.order)) return { error: "bad_request" };
  if (b.order.length === 0) return { error: "bad_request" };
  if (b.order.length > 5000) return { error: "bad_request" };
  for (const item of b.order as unknown[]) {
    if (!item || typeof item !== "object") return { error: "bad_order_entry" };
    const it = item as Record<string, unknown>;
    if (typeof it.id !== "string" || !UUID_RE.test(it.id)) {
      return { error: "bad_order_entry" };
    }
    if (
      typeof it.sortIndex !== "number" ||
      !Number.isFinite(it.sortIndex) ||
      (it.sortIndex as number) < 0 ||
      (it.sortIndex as number) > 1_000_000
    ) {
      return { error: "bad_order_entry" };
    }
  }
  return { ok: true };
}

describe("reorder validation", () => {
  const ok = {
    galleryId: "00000000-0000-0000-0000-000000000001",
    order: [
      { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", sortIndex: 0 },
      { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", sortIndex: 1 },
    ],
  };

  it("accepts a valid request", () => {
    expect(validateReorderRequest(ok)).toEqual({ ok: true });
  });

  it("rejects empty order", () => {
    expect(validateReorderRequest({ ...ok, order: [] })).toEqual({
      error: "bad_request",
    });
  });

  it("rejects more than 5000 entries", () => {
    const big = Array.from({ length: 5001 }, (_, i) => ({
      id: `aaaaaaaa-aaaa-aaaa-aaaa-${i.toString().padStart(12, "0")}`,
      sortIndex: i,
    }));
    expect(validateReorderRequest({ ...ok, order: big })).toEqual({
      error: "bad_request",
    });
  });

  it("rejects non-UUID id", () => {
    expect(
      validateReorderRequest({
        ...ok,
        order: [{ id: "not-a-uuid", sortIndex: 0 }],
      })
    ).toEqual({ error: "bad_order_entry" });
  });

  it("rejects non-numeric sortIndex", () => {
    expect(
      validateReorderRequest({
        ...ok,
        order: [
          {
            id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            sortIndex: "0" as unknown as number,
          },
        ],
      })
    ).toEqual({ error: "bad_order_entry" });
  });

  it("rejects negative sortIndex", () => {
    expect(
      validateReorderRequest({
        ...ok,
        order: [
          { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", sortIndex: -1 },
        ],
      })
    ).toEqual({ error: "bad_order_entry" });
  });

  it("rejects NaN sortIndex", () => {
    expect(
      validateReorderRequest({
        ...ok,
        order: [
          { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", sortIndex: NaN },
        ],
      })
    ).toEqual({ error: "bad_order_entry" });
  });

  it("rejects missing galleryId", () => {
    expect(
      validateReorderRequest({ ...ok, galleryId: undefined })
    ).toEqual({ error: "bad_request" });
  });
});
