import { describe, it, expect } from "vitest";
import {
  resolveCartItemPricing,
  resolveShippingCents,
  isMissingRequiredPaymentReference,
  allowedTransitionsFor,
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
  finishOptions: [],
};

const flatVariant: VariantPricingInfo = {
  priceCents: 500,
  priceTiers: [],
  finishOptions: [],
};

const variantWithFinishes: VariantPricingInfo = {
  priceCents: 500,
  priceTiers: [],
  finishOptions: [
    { id: "black", name: "Cornice nera", sku: "FRAME-BLACK", priceDeltaCents: 1200 },
    { id: "white", name: "Cornice bianca", sku: null, priceDeltaCents: 0 },
  ],
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
            finishOptions: [],
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

  it("adds the finish option's price delta on top of the resolved unit price", () => {
    const result = resolveCartItemPricing(
      [item({ fileId: "a", quantity: 2, finishOptionId: "black" })],
      new Map([["v1", variantWithFinishes]])
    );
    expect(result[0].unitPriceCents).toBe(500 + 1200);
    expect(result[0].totalPriceCents).toBe((500 + 1200) * 2);
    expect(result[0].finishOptionId).toBe("black");
    expect(result[0].finishOptionName).toBe("Cornice nera");
    expect(result[0].finishOptionSku).toBe("FRAME-BLACK");
  });

  it("a zero-delta finish option still resolves with no surcharge and a null SKU snapshot", () => {
    const result = resolveCartItemPricing(
      [item({ fileId: "a", finishOptionId: "white" })],
      new Map([["v1", variantWithFinishes]])
    );
    expect(result[0].unitPriceCents).toBe(500);
    expect(result[0].finishOptionSku).toBeNull();
  });

  it("throws when a variant with finish options is ordered without one", () => {
    expect(() =>
      resolveCartItemPricing(
        [item({ fileId: "a" })], // no finishOptionId
        new Map([["v1", variantWithFinishes]])
      )
    ).toThrow();
  });

  it("throws when the given finishOptionId doesn't belong to the variant", () => {
    expect(() =>
      resolveCartItemPricing(
        [item({ fileId: "a", finishOptionId: "not-a-real-option" })],
        new Map([["v1", variantWithFinishes]])
      )
    ).toThrow();
  });

  it("throws when a finishOptionId is given for a variant with no finish options", () => {
    expect(() =>
      resolveCartItemPricing(
        [item({ fileId: "a", finishOptionId: "black" })],
        new Map([["v1", flatVariant]])
      )
    ).toThrow();
  });

  it("finish surcharge doesn't affect the quantity-tier aggregation, only the resulting price", () => {
    // Two lines of the same variant, different finishes — still 30
    // total prints of that FORMAT, so both hit the same tier; the
    // finish only adds its own flat delta per line afterward.
    const tieredWithFinishes: VariantPricingInfo = {
      ...tieredVariant,
      finishOptions: variantWithFinishes.finishOptions,
    };
    const result = resolveCartItemPricing(
      [
        item({ fileId: "a", quantity: 15, finishOptionId: "black" }),
        item({ fileId: "b", quantity: 15, finishOptionId: "white" }),
      ],
      new Map([["v1", tieredWithFinishes]])
    );
    // 15+15=30 -> the 20-99 tier (30c), not the 1-19 tier (35c).
    expect(result[0].unitPriceCents).toBe(30 + 1200);
    expect(result[1].unitPriceCents).toBe(30 + 0);
  });
});

describe("isMissingRequiredPaymentReference", () => {
  it("requires a reference for mark_paid on an offline_invoice order", () => {
    expect(
      isMissingRequiredPaymentReference("mark_paid", "offline_invoice", undefined)
    ).toBe(true);
    expect(
      isMissingRequiredPaymentReference("mark_paid", "offline_invoice", "")
    ).toBe(true);
    expect(
      isMissingRequiredPaymentReference("mark_paid", "offline_invoice", "   ")
    ).toBe(true);
  });

  it("is satisfied once a non-blank reference is given", () => {
    expect(
      isMissingRequiredPaymentReference("mark_paid", "offline_invoice", "INV-2026-042")
    ).toBe(false);
  });

  it("never requires a reference for stripe_connect orders", () => {
    expect(
      isMissingRequiredPaymentReference("mark_paid", "stripe_connect", undefined)
    ).toBe(false);
  });

  it("never requires a reference for transitions other than mark_paid", () => {
    expect(
      isMissingRequiredPaymentReference("mark_shipped", "offline_invoice", undefined)
    ).toBe(false);
    expect(
      isMissingRequiredPaymentReference("cancel", "offline_invoice", undefined)
    ).toBe(false);
  });
});

describe("allowedTransitionsFor", () => {
  it("is identical for courier and pickup up to in_production", () => {
    for (const isPickupDelivery of [false, true]) {
      expect(allowedTransitionsFor("draft", isPickupDelivery)).toEqual(["cancel"]);
      expect(allowedTransitionsFor("pending_payment", isPickupDelivery)).toEqual([
        "mark_paid",
        "cancel",
      ]);
      expect(allowedTransitionsFor("paid", isPickupDelivery)).toEqual([
        "mark_in_production",
        "cancel",
        "refund",
      ]);
    }
  });

  it("forks in_production on isPickupDelivery", () => {
    expect(allowedTransitionsFor("in_production", false)).toEqual([
      "mark_shipped",
      "cancel",
      "refund",
    ]);
    expect(allowedTransitionsFor("in_production", true)).toEqual([
      "mark_ready_for_pickup",
      "cancel",
      "refund",
    ]);
  });

  it("only allows the pickup-side status when isPickupDelivery, and vice versa", () => {
    // A courier order can never reach ready_for_pickup, and a pickup
    // order can never reach shipped — but if it somehow did (e.g. a
    // stale isPickupDelivery flag), both dead-end statuses still allow
    // mark_delivered/refund so the order isn't stuck.
    expect(allowedTransitionsFor("shipped", false)).toEqual(["mark_delivered", "refund"]);
    expect(allowedTransitionsFor("shipped", true)).toEqual(["mark_delivered", "refund"]);
    expect(allowedTransitionsFor("ready_for_pickup", true)).toEqual([
      "mark_delivered",
      "refund",
    ]);
    expect(allowedTransitionsFor("ready_for_pickup", false)).toEqual([
      "mark_delivered",
      "refund",
    ]);
  });

  it("both paths converge on the shared delivered terminal status", () => {
    expect(allowedTransitionsFor("delivered", false)).toEqual(["refund"]);
    expect(allowedTransitionsFor("delivered", true)).toEqual(["refund"]);
  });

  it("terminal statuses allow nothing further", () => {
    expect(allowedTransitionsFor("cancelled", false)).toEqual([]);
    expect(allowedTransitionsFor("refunded", true)).toEqual([]);
  });

  it("unknown status allows nothing", () => {
    expect(allowedTransitionsFor("bogus", false)).toEqual([]);
  });
});

describe("resolveShippingCents", () => {
  it("charges the method's price when it has no threshold", () => {
    expect(resolveShippingCents(590, null, 1_000_000)).toBe(590);
  });

  it("charges the price below the threshold", () => {
    expect(resolveShippingCents(590, 5000, 4999)).toBe(590);
  });

  it("is free exactly at the threshold (inclusive)", () => {
    expect(resolveShippingCents(590, 5000, 5000)).toBe(0);
  });

  it("is free above the threshold", () => {
    expect(resolveShippingCents(590, 5000, 12_000)).toBe(0);
  });

  it("applies to a paid pickup method the same way", () => {
    expect(resolveShippingCents(300, 2000, 1500)).toBe(300);
    expect(resolveShippingCents(300, 2000, 2000)).toBe(0);
  });

  it("leaves an already-free method free", () => {
    expect(resolveShippingCents(0, 5000, 100)).toBe(0);
    expect(resolveShippingCents(0, null, 100)).toBe(0);
  });
});
