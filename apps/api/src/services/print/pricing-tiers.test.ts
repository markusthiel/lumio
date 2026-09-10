import { describe, it, expect } from "vitest";
import {
  validateTierLadder,
  deriveReferencePriceCents,
  resolveUnitPriceForQuantity,
  costTierConsistency,
  type PriceTierInput,
} from "./pricing-tiers.js";

const ladder: PriceTierInput[] = [
  { minQty: 1, maxQty: 19, unitPriceCents: 35 },
  { minQty: 20, maxQty: 99, unitPriceCents: 30 },
  { minQty: 100, maxQty: 399, unitPriceCents: 25 },
  { minQty: 400, maxQty: null, unitPriceCents: 16 },
];

describe("validateTierLadder", () => {
  it("accepts a valid contiguous ladder ending unbounded", () => {
    const result = validateTierLadder(ladder);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sorted).toHaveLength(4);
      expect(result.warnings).toHaveLength(0);
    }
  });

  it("accepts a single unbounded tier (flat-equivalent ladder)", () => {
    const result = validateTierLadder([
      { minQty: 1, maxQty: null, unitPriceCents: 50 },
    ]);
    expect(result.ok).toBe(true);
  });

  it("sorts input before validating, regardless of input order", () => {
    const shuffled = [ladder[2], ladder[0], ladder[3], ladder[1]];
    const result = validateTierLadder(shuffled);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sorted.map((t) => t.minQty)).toEqual([1, 20, 100, 400]);
    }
  });

  it("rejects an empty ladder", () => {
    expect(validateTierLadder([])).toEqual({ ok: false, error: "empty_ladder" });
  });

  it("rejects a ladder with more than 20 tiers", () => {
    const tooMany: PriceTierInput[] = Array.from({ length: 21 }, (_, i) => ({
      minQty: i + 1,
      maxQty: i === 20 ? null : i + 1,
      unitPriceCents: 10,
    }));
    expect(validateTierLadder(tooMany)).toEqual({
      ok: false,
      error: "too_many_tiers",
    });
  });

  it("rejects a ladder that doesn't start at minQty 1", () => {
    const result = validateTierLadder([
      { minQty: 2, maxQty: null, unitPriceCents: 10 },
    ]);
    expect(result).toEqual({ ok: false, error: "first_tier_must_start_at_1" });
  });

  it("rejects a ladder whose last tier is bounded", () => {
    const result = validateTierLadder([
      { minQty: 1, maxQty: 10, unitPriceCents: 10 },
    ]);
    expect(result).toEqual({
      ok: false,
      error: "last_tier_must_be_unbounded",
    });
  });

  it("rejects a ladder with an unbounded tier before the last one", () => {
    const result = validateTierLadder([
      { minQty: 1, maxQty: null, unitPriceCents: 10 },
      { minQty: 20, maxQty: null, unitPriceCents: 8 },
    ]);
    expect(result).toEqual({
      ok: false,
      error: "only_last_tier_may_be_unbounded",
    });
  });

  it("rejects a ladder with a gap between tiers", () => {
    const result = validateTierLadder([
      { minQty: 1, maxQty: 10, unitPriceCents: 10 },
      { minQty: 15, maxQty: null, unitPriceCents: 8 }, // gap: 11-14 uncovered
    ]);
    expect(result).toEqual({
      ok: false,
      error: "gap_or_overlap_between_tiers",
    });
  });

  it("rejects a ladder with overlapping tiers", () => {
    const result = validateTierLadder([
      { minQty: 1, maxQty: 20, unitPriceCents: 10 },
      { minQty: 15, maxQty: null, unitPriceCents: 8 }, // overlap: 15-20
    ]);
    expect(result).toEqual({
      ok: false,
      error: "gap_or_overlap_between_tiers",
    });
  });

  it("rejects non-positive or non-integer minQty/maxQty/price", () => {
    expect(
      validateTierLadder([{ minQty: 0, maxQty: null, unitPriceCents: 10 }])
    ).toEqual({ ok: false, error: "invalid_min_qty" });
    expect(
      validateTierLadder([{ minQty: 1, maxQty: 0, unitPriceCents: 10 }])
    ).toEqual({ ok: false, error: "invalid_max_qty" });
    expect(
      validateTierLadder([{ minQty: 1, maxQty: null, unitPriceCents: -5 }])
    ).toEqual({ ok: false, error: "invalid_unit_price" });
  });

  it("warns, but does not reject, when price increases with quantity", () => {
    const result = validateTierLadder([
      { minQty: 1, maxQty: 9, unitPriceCents: 10 },
      { minQty: 10, maxQty: null, unitPriceCents: 12 },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toContain("price_increases_with_quantity");
    }
  });
});

describe("deriveReferencePriceCents", () => {
  it("returns the first tier's price, not the cheapest tier's price", () => {
    const result = validateTierLadder(ladder);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // First tier (1-19) is 35, cheapest tier (400+) is 16 — must be 35.
      expect(deriveReferencePriceCents(result.sorted)).toBe(35);
    }
  });
});

describe("resolveUnitPriceForQuantity", () => {
  it("falls back to the base price when there are no tiers", () => {
    expect(resolveUnitPriceForQuantity(99, [], 1)).toBe(99);
    expect(resolveUnitPriceForQuantity(99, [], 1000)).toBe(99);
  });

  it("resolves a quantity inside the first tier", () => {
    expect(resolveUnitPriceForQuantity(0, ladder, 1)).toBe(35);
    expect(resolveUnitPriceForQuantity(0, ladder, 19)).toBe(35);
  });

  it("resolves a quantity inside a middle tier", () => {
    expect(resolveUnitPriceForQuantity(0, ladder, 20)).toBe(30);
    expect(resolveUnitPriceForQuantity(0, ladder, 250)).toBe(25);
  });

  it("resolves a quantity inside the unbounded last tier", () => {
    expect(resolveUnitPriceForQuantity(0, ladder, 400)).toBe(16);
    expect(resolveUnitPriceForQuantity(0, ladder, 999999)).toBe(16);
  });

  it("resolves exact tier boundaries correctly", () => {
    expect(resolveUnitPriceForQuantity(0, ladder, 99)).toBe(30);
    expect(resolveUnitPriceForQuantity(0, ladder, 100)).toBe(25);
    expect(resolveUnitPriceForQuantity(0, ladder, 399)).toBe(25);
    expect(resolveUnitPriceForQuantity(0, ladder, 400)).toBe(16);
  });
});

describe("costTierConsistency", () => {
  it("returns 'none' when no tier carries a cost", () => {
    expect(costTierConsistency(ladder)).toBe("none");
  });

  it("returns 'all' when every tier carries a cost", () => {
    const withCost = ladder.map((t) => ({ ...t, unitCostCents: 10 }));
    expect(costTierConsistency(withCost)).toBe("all");
  });

  it("returns 'partial' when only some tiers carry a cost", () => {
    const mixed = ladder.map((t, i) =>
      i === 0 ? { ...t, unitCostCents: 10 } : t
    );
    expect(costTierConsistency(mixed)).toBe("partial");
  });

  it("treats null the same as undefined (not carrying a cost)", () => {
    const withNull = ladder.map((t) => ({ ...t, unitCostCents: null }));
    expect(costTierConsistency(withNull)).toBe("none");
  });
});
