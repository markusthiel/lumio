/**
 * Lumio API — Bulk Print Catalog Import
 *
 * Turns a Lumio catalog-import JSON payload (see the template returned
 * by GET /print-shop/import/template) into PrintProduct/PrintProductVariant
 * rows, either as a dry-run preview or an actual commit — both paths
 * share this single analyze/plan function, so what a studio previews
 * is exactly what gets written.
 *
 * Matching is upsert-by-SKU, scoped to (tenantId, providerKey):
 *   - A product/variant row with a `sku` that matches an existing
 *     providerProductRef/providerVariantRef is UPDATED in place.
 *   - A row without a `sku`, or whose `sku` matches nothing, is CREATED.
 *   - `enabled` and `displayOrder` on existing rows are never touched
 *     by an update, so a manual disable/reorder in the Studio UI
 *     survives a re-import.
 *
 * Failures are best-effort and scoped as tightly as possible: a broken
 * variant is skipped without dropping its product's other variants; a
 * broken product is skipped without affecting the rest of the file.
 * Each product (with its variants) is written in its own transaction,
 * so one failing product cannot roll back the others.
 */
import { prisma } from "../../db.js";
import {
  validateTierLadder,
  deriveReferencePriceCents,
  costTierConsistency,
  type PriceTierInput,
} from "./pricing-tiers.js";

const KNOWN_CATEGORIES = new Set([
  "print",
  "canvas",
  "photobook",
  "frame",
  "metal_print",
  "poster",
]);

// =============================================================================
// Input shape (parsed/validated request body)
// =============================================================================

export interface ImportVariantTierInput {
  minQty: number;
  maxQty: number | null;
  unitPriceEur: number;
  /** Optional per-tier cost. All-or-nothing across a variant's ladder
   *  — see costTierConsistency() in planVariant(). */
  costEur?: number | null;
}

export interface ImportVariantInput {
  name: string;
  widthMm?: number | null;
  heightMm?: number | null;
  finishType?: string | null;
  sku?: string | null;
  priceEur?: number | null;
  costEur?: number | null;
  priceTiers?: ImportVariantTierInput[];
}

export interface ImportProductInput {
  name: string;
  description?: string | null;
  category?: string | null;
  sku?: string | null;
  variants: ImportVariantInput[];
}

export interface ImportRequest {
  tenantId: string;
  providerKey: string;
  products: ImportProductInput[];
  dryRun: boolean;
}

// =============================================================================
// Report shape (returned to the client, identical for preview and commit)
// =============================================================================

export type ImportRowStatus =
  | "created"
  | "updated"
  | "would_create"
  | "would_update"
  | "skipped_error";

export interface ImportVariantResult {
  rowIndex: number;
  name: string;
  status: ImportRowStatus;
  matchedExistingId?: string;
  errors: string[];
  warnings: string[];
}

export interface ImportProductResult {
  rowIndex: number;
  name: string;
  status: ImportRowStatus;
  matchedExistingId?: string;
  errors: string[];
  warnings: string[];
  variants: ImportVariantResult[];
}

export interface ImportReport {
  summary: {
    totalProducts: number;
    totalVariants: number;
    productsCreated: number;
    productsUpdated: number;
    productsSkipped: number;
    variantsCreated: number;
    variantsUpdated: number;
    variantsSkipped: number;
    /** Warnings across both products and variants combined. */
    warnings: number;
  };
  products: ImportProductResult[];
}

// =============================================================================
// Internal: resolved write plan (what a row WOULD do, computed once and
// reused for both the report and, if not a dry run, the actual writes)
// =============================================================================

interface VariantWriteData {
  name: string;
  widthMm: number;
  heightMm: number;
  finishType: string | null;
  providerVariantRef: string | null;
  priceCents: number;
  costCents: number | null;
  tiers: PriceTierInput[]; // [] = flat pricing
}

interface VariantPlan {
  rowIndex: number;
  sourceName: string;
  action: "create" | "update" | "skip";
  existingId?: string;
  errors: string[];
  warnings: string[];
  data?: VariantWriteData;
}

interface ProductWriteData {
  name: string;
  description: string | null;
  category: string;
  providerProductRef: string | null;
}

interface ProductPlan {
  rowIndex: number;
  sourceName: string;
  action: "create" | "update" | "skip";
  existingId?: string;
  errors: string[];
  warnings: string[];
  data?: ProductWriteData;
  variants: VariantPlan[];
}

/** Converts a EUR decimal amount to integer cents, flagging (but not
 *  rejecting) precision loss beyond 2 decimals — real-world price
 *  lists do carry values like 0.123 (see the reference list this
 *  feature was designed against). */
export function eurToCents(eur: number): { cents: number; imprecise: boolean } {
  const cents = Math.round(eur * 100);
  const roundTripEur = cents / 100;
  return { cents, imprecise: Math.abs(eur - roundTripEur) > 1e-9 };
}

export function planVariant(
  row: ImportVariantInput,
  rowIndex: number,
  existingBySku: Map<string, { id: string }>,
  seenSkusInProduct: Set<string>
): VariantPlan {
  const errors: string[] = [];
  const warnings: string[] = [];
  const name = (row.name ?? "").trim();
  if (!name) errors.push("missing_name");

  const width = row.widthMm ?? null;
  const height = row.heightMm ?? null;
  if (width === null || !Number.isFinite(width) || width <= 0) {
    errors.push("missing_or_invalid_width_mm");
  }
  if (height === null || !Number.isFinite(height) || height <= 0) {
    errors.push("missing_or_invalid_height_mm");
  }

  const sku = row.sku?.trim() || null;
  if (sku) {
    if (seenSkusInProduct.has(sku)) {
      errors.push("duplicate_sku_in_file");
    }
    seenSkusInProduct.add(sku);
  }

  let priceCents = 0;
  let tiers: PriceTierInput[] = [];
  const hasTiers = !!row.priceTiers && row.priceTiers.length > 0;
  let tiersCarryCost = false;

  if (hasTiers) {
    const converted: PriceTierInput[] = row.priceTiers!.map((t) => {
      const { cents, imprecise } = eurToCents(t.unitPriceEur);
      if (imprecise) warnings.push("tier_price_rounded_to_nearest_cent");
      let unitCostCents: number | null | undefined;
      if (t.costEur !== undefined && t.costEur !== null) {
        const cost = eurToCents(t.costEur);
        if (cost.imprecise) warnings.push("tier_cost_rounded_to_nearest_cent");
        if (cost.cents < 0) errors.push("invalid_cost_eur");
        unitCostCents = cost.cents;
      }
      return { minQty: t.minQty, maxQty: t.maxQty, unitPriceCents: cents, unitCostCents };
    });
    const validation = validateTierLadder(converted);
    if (!validation.ok) {
      errors.push(`invalid_price_tiers:${validation.error}`);
    } else {
      const consistency = costTierConsistency(validation.sorted);
      if (consistency === "partial") {
        errors.push("invalid_price_tiers:partial_cost_tiers");
      } else {
        warnings.push(...validation.warnings);
        tiers = validation.sorted;
        priceCents = deriveReferencePriceCents(validation.sorted);
        tiersCarryCost = consistency === "all";
      }
    }
  } else if (row.priceEur === undefined || row.priceEur === null) {
    errors.push("missing_price_eur");
  } else {
    const { cents, imprecise } = eurToCents(row.priceEur);
    if (imprecise) warnings.push("price_rounded_to_nearest_cent");
    if (cents < 0) errors.push("invalid_price_eur");
    priceCents = cents;
  }

  if (errors.length > 0) {
    return { rowIndex, sourceName: name, action: "skip", errors, warnings };
  }

  let costCents: number | null = null;
  if (tiersCarryCost) {
    costCents = tiers[0].unitCostCents ?? null;
  } else if (row.costEur !== undefined && row.costEur !== null) {
    const { cents, imprecise } = eurToCents(row.costEur);
    if (imprecise) warnings.push("cost_rounded_to_nearest_cent");
    if (cents < 0) errors.push("invalid_cost_eur");
    costCents = cents;
  }

  // Second error check: costEur is only known to be valid past this
  // point, so a negative cost (caught above) must still skip the row —
  // mirrors the priceEur check earlier, which the first return already
  // covers for every error pushed before it.
  if (errors.length > 0) {
    return { rowIndex, sourceName: name, action: "skip", errors, warnings };
  }

  const existing = sku ? existingBySku.get(sku) : undefined;

  return {
    rowIndex,
    sourceName: name,
    action: existing ? "update" : "create",
    existingId: existing?.id,
    errors,
    warnings,
    data: {
      name,
      widthMm: width as number,
      heightMm: height as number,
      finishType: row.finishType?.trim() || null,
      providerVariantRef: sku,
      priceCents,
      costCents,
      tiers,
    },
  };
}

export function planProduct(
  row: ImportProductInput,
  rowIndex: number,
  existingProductBySku: Map<
    string,
    { id: string; variants: Array<{ id: string; providerVariantRef: string | null }> }
  >,
  seenProductSkusInFile: Set<string>
): ProductPlan {
  const errors: string[] = [];
  const warnings: string[] = [];
  const name = (row.name ?? "").trim();
  if (!name) errors.push("missing_name");

  let category = row.category?.trim() || "print";
  if (!KNOWN_CATEGORIES.has(category)) {
    warnings.push(`unknown_category_defaulted_to_print:${category}`);
    category = "print";
  }

  const sku = row.sku?.trim() || null;
  if (sku) {
    if (seenProductSkusInFile.has(sku)) {
      errors.push("duplicate_sku_in_file");
    }
    seenProductSkusInFile.add(sku);
  }

  if (errors.length > 0) {
    return {
      rowIndex,
      sourceName: name,
      action: "skip",
      errors,
      warnings,
      variants: [],
    };
  }

  const existing = sku ? existingProductBySku.get(sku) : undefined;
  const existingVariantBySku = new Map<string, { id: string }>();
  if (existing) {
    for (const v of existing.variants) {
      if (v.providerVariantRef) existingVariantBySku.set(v.providerVariantRef, v);
    }
  }

  const seenVariantSkus = new Set<string>();
  const variants = (row.variants ?? []).map((v, vi) =>
    planVariant(v, vi, existingVariantBySku, seenVariantSkus)
  );

  const hasValidVariant = variants.some((v) => v.action !== "skip");
  if (!hasValidVariant) {
    return {
      rowIndex,
      sourceName: name,
      action: "skip",
      errors: ["no_valid_variants"],
      warnings,
      variants,
    };
  }

  return {
    rowIndex,
    sourceName: name,
    action: existing ? "update" : "create",
    existingId: existing?.id,
    errors,
    warnings,
    data: {
      name,
      description: row.description?.trim() || null,
      category,
      providerProductRef: sku,
    },
    variants,
  };
}

function variantCreateFields(d: VariantWriteData) {
  return {
    name: d.name,
    widthMm: d.widthMm,
    heightMm: d.heightMm,
    finishType: d.finishType,
    providerVariantRef: d.providerVariantRef,
    priceCents: d.priceCents,
    costCents: d.costCents,
    ...(d.tiers.length > 0
      ? {
          priceTiers: {
            create: d.tiers.map((t) => ({
              minQty: t.minQty,
              maxQty: t.maxQty,
              unitPriceCents: t.unitPriceCents,
              unitCostCents: t.unitCostCents ?? null,
            })),
          },
        }
      : {}),
  };
}

/** Applies one product's plan inside a caller-provided transaction.
 *  Only called when dryRun is false and the plan isn't a "skip". */
async function applyProductPlan(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  tenantId: string,
  providerKey: string,
  plan: ProductPlan
): Promise<void> {
  const variantsToWrite = plan.variants.filter((v) => v.action !== "skip");

  if (plan.action === "create") {
    await tx.printProduct.create({
      data: {
        tenantId,
        providerKey,
        name: plan.data!.name,
        description: plan.data!.description,
        category: plan.data!.category,
        providerProductRef: plan.data!.providerProductRef,
        variants: {
          create: variantsToWrite.map((v) => variantCreateFields(v.data!)),
        },
      },
    });
    return;
  }

  // update
  await tx.printProduct.update({
    where: { id: plan.existingId! },
    data: {
      name: plan.data!.name,
      description: plan.data!.description,
      category: plan.data!.category,
    },
  });

  for (const v of variantsToWrite) {
    if (v.action === "create") {
      await tx.printProductVariant.create({
        data: { printProductId: plan.existingId!, ...variantCreateFields(v.data!) },
      });
    } else {
      // Tiers are replaced wholesale rather than diffed — simpler and
      // matches "the file is the source of truth for this variant".
      // deleteMany({}) clears every existing tier row for this variant
      // in the same nested write as the scalar update.
      await tx.printProductVariant.update({
        where: { id: v.existingId! },
        data: {
          name: v.data!.name,
          widthMm: v.data!.widthMm,
          heightMm: v.data!.heightMm,
          finishType: v.data!.finishType,
          priceCents: v.data!.priceCents,
          costCents: v.data!.costCents,
          priceTiers: {
            deleteMany: {},
            ...(v.data!.tiers.length > 0
              ? {
                  create: v.data!.tiers.map((t) => ({
                    minQty: t.minQty,
                    maxQty: t.maxQty,
                    unitPriceCents: t.unitPriceCents,
                    unitCostCents: t.unitCostCents ?? null,
                  })),
                }
              : {}),
          },
        },
      });
    }
  }
}

export function toRowStatus(
  action: "create" | "update" | "skip",
  dryRun: boolean
): ImportRowStatus {
  if (action === "skip") return "skipped_error";
  if (dryRun) return action === "create" ? "would_create" : "would_update";
  return action === "create" ? "created" : "updated";
}

export async function analyzeImport(input: ImportRequest): Promise<ImportReport> {
  const { tenantId, providerKey, products, dryRun } = input;

  const existing = await prisma.printProduct.findMany({
    where: { tenantId, providerKey },
    select: {
      id: true,
      providerProductRef: true,
      variants: { select: { id: true, providerVariantRef: true } },
    },
  });
  const existingBySku = new Map<string, (typeof existing)[number]>();
  for (const p of existing) {
    if (p.providerProductRef) existingBySku.set(p.providerProductRef, p);
  }

  const seenProductSkus = new Set<string>();
  const plans = products.map((row, i) =>
    planProduct(row, i, existingBySku, seenProductSkus)
  );

  if (!dryRun) {
    for (const plan of plans) {
      if (plan.action === "skip") continue;
      try {
        await prisma.$transaction((tx) => applyProductPlan(tx, tenantId, providerKey, plan));
      } catch (err) {
        // A write failure downgrades this product (and all its
        // variants) to skipped_error in the report — the rest of the
        // import already committed independently and is unaffected.
        plan.action = "skip";
        plan.errors.push(
          `write_failed:${err instanceof Error ? err.message : "unknown_error"}`
        );
        for (const v of plan.variants) {
          if (v.action !== "skip") v.action = "skip";
        }
      }
    }
  }

  const productResults: ImportProductResult[] = [];
  let productsCreated = 0;
  let productsUpdated = 0;
  let productsSkipped = 0;
  let variantsCreated = 0;
  let variantsUpdated = 0;
  let variantsSkipped = 0;
  let warningsCount = 0;
  let totalVariants = 0;

  for (const plan of plans) {
    const variantResults: ImportVariantResult[] = plan.variants.map((v) => {
      totalVariants++;
      warningsCount += v.warnings.length;
      const status = toRowStatus(v.action, dryRun);
      if (status === "created" || status === "would_create") variantsCreated++;
      else if (status === "updated" || status === "would_update") variantsUpdated++;
      else variantsSkipped++;
      return {
        rowIndex: v.rowIndex,
        name: v.sourceName,
        status,
        matchedExistingId: v.existingId,
        errors: v.errors,
        warnings: v.warnings,
      };
    });

    warningsCount += plan.warnings.length;
    const productStatus = toRowStatus(plan.action, dryRun);
    if (productStatus === "created" || productStatus === "would_create") productsCreated++;
    else if (productStatus === "updated" || productStatus === "would_update") productsUpdated++;
    else productsSkipped++;

    productResults.push({
      rowIndex: plan.rowIndex,
      name: plan.sourceName,
      status: productStatus,
      matchedExistingId: plan.existingId,
      errors: plan.errors,
      warnings: plan.warnings,
      variants: variantResults,
    });
  }

  return {
    summary: {
      totalProducts: products.length,
      totalVariants,
      productsCreated,
      productsUpdated,
      productsSkipped,
      variantsCreated,
      variantsUpdated,
      variantsSkipped,
      warnings: warningsCount,
    },
    products: productResults,
  };
}

// =============================================================================
// Downloadable template
// =============================================================================

/**
 * Example payload for the "products" array a studio uploads — one flat
 * -price variant, one tiered-price variant, and inline field-by-field
 * documentation under "_readme" (comments aren't valid JSON, so this
 * is the next best thing for a hand-editable file).
 */
export function buildImportTemplate(): unknown {
  return {
    schemaVersion: 1,
    _readme: {
      category:
        "One of: print, canvas, photobook, frame, metal_print, poster. Missing or unrecognized values default to 'print' with a warning — the import still goes through.",
      sku: "Optional, both on a product and on a variant. Re-uploading a file later updates the matching product/variant instead of creating a duplicate — without a sku, every import creates a new row.",
      widthMm_heightMm: "Required on every variant, in millimeters. A variant without valid dimensions is skipped (with an error in the import report); the rest of the file still imports.",
      priceEur_costEur:
        "priceEur is the price the end customer pays; costEur is optional and only used for margin display in the Studio, never shown to customers. Required unless priceTiers is set.",
      priceTiers:
        "Optional. Quantity-break pricing: the LOWER the quantity, the FIRST tier's price is what shows as the variant's reference price. Tiers must start at minQty 1, end with maxQty null (unbounded), and cover every quantity in between with no gaps or overlaps.",
      "priceTiers[].costEur":
        "Optional per-tier cost, for labs whose cost to you also drops in steps (e.g. PhotoSì-style volume pricing). All-or-nothing: either every tier in the ladder has a costEur, or none do — a partial set is rejected as one row error. When set, it replaces the variant-level costEur for margin display.",
    },
    products: [
      {
        name: "Foto-Print Seidenmatt",
        description: "Klassischer Fotoabzug, seidenmattes Papier",
        category: "print",
        sku: "PRINT-SILK",
        variants: [
          {
            name: "10x15 cm",
            widthMm: 100,
            heightMm: 150,
            finishType: "matte",
            sku: "PRINT-SILK-10x15",
            priceEur: 0.35,
            costEur: 0.12,
          },
          {
            name: "Poster 40x60 (Staffelpreis)",
            widthMm: 400,
            heightMm: 600,
            sku: "PRINT-SILK-40x60",
            costEur: 6.5,
            priceTiers: [
              { minQty: 1, maxQty: 19, unitPriceEur: 0.35 },
              { minQty: 20, maxQty: 99, unitPriceEur: 0.3 },
              { minQty: 100, maxQty: 399, unitPriceEur: 0.25 },
              { minQty: 400, maxQty: null, unitPriceEur: 0.16 },
            ],
          },
          {
            name: "20x30 cm (Staffelpreis + Staffelkosten)",
            widthMm: 200,
            heightMm: 300,
            sku: "PRINT-SILK-20x30",
            priceTiers: [
              { minQty: 1, maxQty: 49, unitPriceEur: 0.99, costEur: 0.4 },
              { minQty: 50, maxQty: 199, unitPriceEur: 0.79, costEur: 0.32 },
              { minQty: 200, maxQty: null, unitPriceEur: 0.59, costEur: 0.24 },
            ],
          },
        ],
      },
    ],
  };
}
