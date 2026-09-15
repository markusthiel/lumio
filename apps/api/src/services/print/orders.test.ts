import { describe, it, expect } from "vitest";
import {
  resolveCartItemPricing,
  type CartItemInput,
  type VariantPricingInfo,
} from "./orders.js";

const tieredVariant: VariantPricingInfo = {
  priceCents: 35,
  priceTiers: [
    { minQty: 1, maxQty: 19, unitPriceCents: 35 },
    { minQty: 20, maxQty: 99, unitPriceCents: 30 },
    { minQty: 100, maxQty: null, unitPriceCents: 25 },
  ],
};

const flatVariant: VariantPricingInfo = {
  priceCents: 500,
  priceTiers: [],
};

function item(overrides: Partial<CartItemInput>): CartItemInput {
  return { variantId: "v1", fileId: "f1", quantity: 1, ...overrides };
}

describe("resolveCartItemPricing", () => {
  it("prices a single line by its own quantity when it's the only line for that variant", () => {
    const result = resolveCartItemPricing(
      [item({ fileId: "f1", quantity: 15 })],
      new Map([["v1", tieredVariant]])
    );
    expect(result).toHaveLength(1);
    expect(result[0].unitPriceCents).toBe(35); // still in the 1-19 tier
    expect(result[0].totalPriceCents).toBe(525);
  });

  it("aggregates quantity across DIFFERENT photos in the same format for the tier lookup", () => {
    // 15 copies of photo A + 10 copies of photo B, same variant (format)
    // = 25 total prints of that format -> should land in the 20-99 tier
    // for BOTH lines, not the 1-19 tier each line would hit alone.
    const result = resolveCartItemPricing(
      [
        item({ fileId: "photo-a", quantity: 15 }),
        item({ fileId: "photo-b", quantity: 10 }),
      ],
      new Map([["v1", tieredVariant]])
    );
    expect(result).toHaveLength(2);
    expect(result[0].unitPriceCents).toBe(30);
    expect(result[0].totalPriceCents).toBe(450); // 15 * 30
    expect(result[1].unitPriceCents).toBe(30);
    expect(result[1].totalPriceCents).toBe(300); // 10 * 30
  });

  it("does not let one variant's aggregate quantity leak into a different variant's tier", () => {
    const result = resolveCartItemPricing(
      [
        item({ variantId: "v1", fileId: "photo-a", quantity: 15 }),
        item({ variantId: "v2", fileId: "photo-b", quantity: 10 }),
      ],
      new Map([
        ["v1", tieredVariant],
        [
          "v2",
          {
            priceCents: 99,
            priceTiers: [
              { minQty: 1, maxQty: 9, unitPriceCents: 99 },
              { minQty: 10, maxQty: null, unitPriceCents: 80 },
            ],
          },
        ],
      ])
    );
    const v1Line = result.find((r) => r.variantId === "v1")!;
    const v2Line = result.find((r) => r.variantId === "v2")!;
    // v1 alone is only 15 -> still the 1-19 tier (35), unaffected by v2's line.
    expect(v1Line.unitPriceCents).toBe(35);
    // v2 alone is exactly 10 -> hits its own 10+ tier (80).
    expect(v2Line.unitPriceCents).toBe(80);
  });

  it("aggregates three or more lines of the same variant correctly", () => {
    const result = resolveCartItemPricing(
      [
        item({ fileId: "a", quantity: 40 }),
        item({ fileId: "b", quantity: 40 }),
        item({ fileId: "c", quantity: 25 }), // 40+40+25 = 105 -> 100+ tier
      ],
      new Map([["v1", tieredVariant]])
    );
    expect(result.every((r) => r.unitPriceCents === 25)).toBe(true);
    expect(result[2].totalPriceCents).toBe(625); // 25 * 25
  });

  it("falls back to the flat price for a variant with no tiers, regardless of aggregation", () => {
    const result = resolveCartItemPricing(
      [item({ fileId: "a", quantity: 3 }), item({ fileId: "b", quantity: 7 })],
      new Map([["v1", flatVariant]])
    );
    expect(result.every((r) => r.unitPriceCents === 500)).toBe(true);
  });

  it("preserves quantity and crop on each resolved line", () => {
    const crop = { x: 0, y: 0, width: 1, height: 1 };
    const result = resolveCartItemPricing(
      [item({ fileId: "a", quantity: 4, crop })],
      new Map([["v1", flatVariant]])
    );
    expect(result[0].quantity).toBe(4);
    expect(result[0].crop).toEqual(crop);
  });
});
