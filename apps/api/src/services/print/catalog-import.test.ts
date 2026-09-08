import { describe, it, expect } from "vitest";
import {
  eurToCents,
  planVariant,
  planProduct,
  type ImportVariantInput,
  type ImportProductInput,
} from "./catalog-import.js";

const baseVariant: ImportVariantInput = {
  name: "10x15 cm",
  widthMm: 100,
  heightMm: 150,
  priceEur: 0.35,
};

describe("eurToCents", () => {
  it("converts clean 2-decimal values exactly", () => {
    expect(eurToCents(0.35)).toEqual({ cents: 35, imprecise: false });
    expect(eurToCents(19.9)).toEqual({ cents: 1990, imprecise: false });
  });

  it("rounds and flags values with more than 2 decimals", () => {
    // Real-world price lists carry values like this (e.g. 0.123 EUR/pc).
    const result = eurToCents(0.123);
    expect(result.cents).toBe(12);
    expect(result.imprecise).toBe(true);
  });

  it("does not flag ordinary floating-point noise as imprecise", () => {
    expect(eurToCents(0.1 + 0.25).imprecise).toBe(false);
  });
});

describe("planVariant", () => {
  const emptyExisting = new Map<string, { id: string }>();

  it("plans a create for a flat-price variant without a SKU", () => {
    const plan = planVariant(baseVariant, 0, emptyExisting, new Set());
    expect(plan.action).toBe("create");
    expect(plan.errors).toEqual([]);
    expect(plan.data?.priceCents).toBe(35);
    expect(plan.data?.tiers).toEqual([]);
  });

  it("skips with an error when width is missing", () => {
    const plan = planVariant(
      { ...baseVariant, widthMm: null },
      0,
      emptyExisting,
      new Set()
    );
    expect(plan.action).toBe("skip");
    expect(plan.errors).toContain("missing_or_invalid_width_mm");
  });

  it("skips with an error when height is missing", () => {
    const plan = planVariant(
      { ...baseVariant, heightMm: undefined },
      0,
      emptyExisting,
      new Set()
    );
    expect(plan.action).toBe("skip");
    expect(plan.errors).toContain("missing_or_invalid_height_mm");
  });

  it("skips with an error when neither flat price nor tiers are given", () => {
    const plan = planVariant(
      { ...baseVariant, priceEur: undefined },
      0,
      emptyExisting,
      new Set()
    );
    expect(plan.action).toBe("skip");
    expect(plan.errors).toContain("missing_price_eur");
  });

  it("derives priceCents from the first tier, not the cheapest tier", () => {
    const plan = planVariant(
      {
        name: "Poster (tiered)",
        widthMm: 400,
        heightMm: 600,
        priceTiers: [
          { minQty: 1, maxQty: 19, unitPriceEur: 0.35 },
          { minQty: 20, maxQty: null, unitPriceEur: 0.16 },
        ],
      },
      0,
      emptyExisting,
      new Set()
    );
    expect(plan.action).toBe("create");
    expect(plan.data?.priceCents).toBe(35);
    expect(plan.data?.tiers).toHaveLength(2);
  });

  it("skips with an error when the price ladder is invalid", () => {
    const plan = planVariant(
      {
        name: "Broken ladder",
        widthMm: 100,
        heightMm: 150,
        priceTiers: [{ minQty: 2, maxQty: null, unitPriceEur: 0.35 }],
      },
      0,
      emptyExisting,
      new Set()
    );
    expect(plan.action).toBe("skip");
    expect(plan.errors[0]).toMatch(/^invalid_price_tiers:/);
  });

  it("plans an update when the SKU matches an existing variant", () => {
    const existing = new Map([["V-1", { id: "existing-variant-id" }]]);
    const plan = planVariant(
      { ...baseVariant, sku: "V-1" },
      0,
      existing,
      new Set()
    );
    expect(plan.action).toBe("update");
    expect(plan.existingId).toBe("existing-variant-id");
  });

  it("plans a create when the SKU matches nothing existing", () => {
    const plan = planVariant(
      { ...baseVariant, sku: "V-UNKNOWN" },
      0,
      emptyExisting,
      new Set()
    );
    expect(plan.action).toBe("create");
  });

  it("skips a second row with the same SKU within one file", () => {
    const seen = new Set<string>(["V-1"]);
    const plan = planVariant({ ...baseVariant, sku: "V-1" }, 1, emptyExisting, seen);
    expect(plan.action).toBe("skip");
    expect(plan.errors).toContain("duplicate_sku_in_file");
  });

  it("flags an imprecise price as a warning without blocking the import", () => {
    const plan = planVariant({ ...baseVariant, priceEur: 0.123 }, 0, emptyExisting, new Set());
    expect(plan.action).toBe("create");
    expect(plan.data?.priceCents).toBe(12);
    expect(plan.warnings).toContain("price_rounded_to_nearest_cent");
  });

  it("skips with an error when costEur is negative", () => {
    const plan = planVariant({ ...baseVariant, costEur: -0.5 }, 0, emptyExisting, new Set());
    expect(plan.action).toBe("skip");
    expect(plan.errors).toContain("invalid_cost_eur");
  });

  it("accepts a zero costEur (free/no-cost self-print)", () => {
    const plan = planVariant({ ...baseVariant, costEur: 0 }, 0, emptyExisting, new Set());
    expect(plan.action).toBe("create");
    expect(plan.data?.costCents).toBe(0);
  });

  it("plans finish options with converted price deltas", () => {
    const plan = planVariant(
      {
        ...baseVariant,
        finishOptions: [
          { name: "Cornice nera", sku: "FRAME-BLACK", priceDeltaEur: 12 },
          { name: "Cornice bianca" },
        ],
      },
      0,
      emptyExisting,
      new Set()
    );
    expect(plan.action).toBe("create");
    expect(plan.data?.finishOptions).toEqual([
      { name: "Cornice nera", sku: "FRAME-BLACK", priceDeltaCents: 1200 },
      { name: "Cornice bianca", sku: null, priceDeltaCents: 0 },
    ]);
  });

  it("skips the whole variant when a finish option name is empty", () => {
    const plan = planVariant(
      { ...baseVariant, finishOptions: [{ name: "  " }] },
      0,
      emptyExisting,
      new Set()
    );
    expect(plan.action).toBe("skip");
    expect(plan.errors).toContain("finish_option_missing_name");
  });

  it("skips the whole variant when two finish options share a name", () => {
    const plan = planVariant(
      {
        ...baseVariant,
        finishOptions: [{ name: "Nera" }, { name: "Nera" }],
      },
      0,
      emptyExisting,
      new Set()
    );
    expect(plan.action).toBe("skip");
    expect(plan.errors).toContain("duplicate_finish_option_name:Nera");
  });

  it("flags an imprecise finish price delta as a warning without blocking the import", () => {
    const plan = planVariant(
      { ...baseVariant, finishOptions: [{ name: "Nera", priceDeltaEur: 0.123 }] },
      0,
      emptyExisting,
      new Set()
    );
    expect(plan.action).toBe("create");
    expect(plan.data?.finishOptions[0].priceDeltaCents).toBe(12);
    expect(plan.warnings).toContain("finish_option_price_delta_rounded_to_nearest_cent");
  });

  it("skips the whole variant when there are more than 20 finish options", () => {
    const finishOptions = Array.from({ length: 21 }, (_, i) => ({ name: `Finish ${i}` }));
    const plan = planVariant(
      { ...baseVariant, finishOptions },
      0,
      emptyExisting,
      new Set()
    );
    expect(plan.action).toBe("skip");
    expect(plan.errors).toContain("too_many_finish_options");
  });

  it("accepts exactly 20 finish options", () => {
    const finishOptions = Array.from({ length: 20 }, (_, i) => ({ name: `Finish ${i}` }));
    const plan = planVariant(
      { ...baseVariant, finishOptions },
      0,
      emptyExisting,
      new Set()
    );
    expect(plan.action).toBe("create");
    expect(plan.data?.finishOptions).toHaveLength(20);
  });

  it("a variant with no finishOptions field has an empty finishOptions plan (unaffected)", () => {
    const plan = planVariant(baseVariant, 0, emptyExisting, new Set());
    expect(plan.data?.finishOptions).toEqual([]);
  });
});

describe("planProduct", () => {
  const emptyExisting = new Map<
    string,
    { id: string; variants: Array<{ id: string; providerVariantRef: string | null }> }
  >();

  const baseProduct: ImportProductInput = {
    name: "Silk print",
    category: "print",
    variants: [baseVariant],
  };

  it("plans a create for a product with at least one valid variant", () => {
    const plan = planProduct(baseProduct, 0, emptyExisting, new Set());
    expect(plan.action).toBe("create");
    expect(plan.variants).toHaveLength(1);
    expect(plan.variants[0].action).toBe("create");
  });

  it("defaults to category 'print' with a warning for an unrecognized category", () => {
    const plan = planProduct(
      { ...baseProduct, category: "totally_unknown" },
      0,
      emptyExisting,
      new Set()
    );
    expect(plan.data?.category).toBe("print");
    expect(plan.warnings.some((w) => w.startsWith("unknown_category_defaulted_to_print"))).toBe(
      true
    );
  });

  it("keeps good variants when one variant in the same product is broken", () => {
    const plan = planProduct(
      {
        ...baseProduct,
        variants: [baseVariant, { name: "Broken", widthMm: null, heightMm: null }],
      },
      0,
      emptyExisting,
      new Set()
    );
    expect(plan.action).toBe("create"); // product still goes ahead
    expect(plan.variants[0].action).toBe("create");
    expect(plan.variants[1].action).toBe("skip");
  });

  it("skips the whole product when zero variants survive validation", () => {
    const plan = planProduct(
      { ...baseProduct, variants: [{ name: "Broken", widthMm: null, heightMm: null }] },
      0,
      emptyExisting,
      new Set()
    );
    expect(plan.action).toBe("skip");
    expect(plan.errors).toContain("no_valid_variants");
  });

  it("plans an update when the product SKU matches an existing product", () => {
    const existing = new Map([
      ["P-1", { id: "existing-product-id", variants: [] }],
    ]);
    const plan = planProduct({ ...baseProduct, sku: "P-1" }, 0, existing, new Set());
    expect(plan.action).toBe("update");
    expect(plan.existingId).toBe("existing-product-id");
  });

  it("plans a create when the product has no SKU (always creates)", () => {
    const plan = planProduct(baseProduct, 0, emptyExisting, new Set());
    expect(plan.action).toBe("create");
    expect(plan.existingId).toBeUndefined();
  });

  it("matches variant SKUs scoped to the resolved (existing) product", () => {
    const existing = new Map([
      [
        "P-1",
        {
          id: "existing-product-id",
          variants: [{ id: "existing-variant-id", providerVariantRef: "V-1" }],
        },
      ],
    ]);
    const plan = planProduct(
      { ...baseProduct, sku: "P-1", variants: [{ ...baseVariant, sku: "V-1" }] },
      0,
      existing,
      new Set()
    );
    expect(plan.action).toBe("update");
    expect(plan.variants[0].action).toBe("update");
    expect(plan.variants[0].existingId).toBe("existing-variant-id");
  });
});
