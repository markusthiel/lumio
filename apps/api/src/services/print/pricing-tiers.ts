/**
 * Lumio API — Print Variant Price Tiers
 *
 * Single source of truth for what a valid quantity-break price ladder
 * looks like, and how to resolve a per-unit price from an ordered
 * quantity. Used identically by:
 *   - Manual variant CRUD (routes/print-shop.ts)
 *   - Bulk catalog import (services/print/catalog-import.ts)
 *   - Checkout pricing (services/print/orders.ts, priceCart())
 *
 * No other module should hand-roll ladder logic — that would let
 * manual editing and import drift apart on what "valid" means.
 */

export interface PriceTierInput {
  minQty: number;
  maxQty: number | null;
  unitPriceCents: number;
  /** What the lab charges us for one unit within this tier, in cents.
   *  Optional, all-or-nothing across the ladder — see
   *  costTierConsistency(). Margin display only, never priced into
   *  checkout, so validateTierLadder() doesn't look at it at all. */
  unitCostCents?: number | null;
}

export type ValidateTierLadderResult =
  | { ok: true; sorted: PriceTierInput[]; warnings: string[] }
  | { ok: false; error: string };

const MAX_TIERS = 20;

/**
 * Validates a full price ladder as one unit (not tier-by-tier).
 *
 * Hard requirements (violation = error, ladder rejected wholesale):
 *   - non-empty, at most MAX_TIERS entries
 *   - every minQty/unitPriceCents non-negative, minQty >= 1
 *   - sorted by minQty ascending, first tier minQty === 1
 *   - last tier maxQty === null (unbounded); every other tier has a
 *     maxQty >= its own minQty
 *   - contiguous: no gaps or overlaps between adjacent tiers
 *
 * Soft requirement (violation = warning, ladder still accepted):
 *   - price should not increase as quantity grows. Real-world lists
 *     are virtually always non-increasing; a step-up is almost always
 *     a data-entry mistake, but resolveUnitPriceForQuantity() still
 *     produces a coherent (if surprising) price for it, so it doesn't
 *     need to block.
 */
export function validateTierLadder(
  tiers: PriceTierInput[]
): ValidateTierLadderResult {
  if (tiers.length === 0) {
    return { ok: false, error: "empty_ladder" };
  }
  if (tiers.length > MAX_TIERS) {
    return { ok: false, error: "too_many_tiers" };
  }

  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);

  for (const t of sorted) {
    if (!Number.isInteger(t.minQty) || t.minQty < 1) {
      return { ok: false, error: "invalid_min_qty" };
    }
    if (
      t.maxQty !== null &&
      (!Number.isInteger(t.maxQty) || t.maxQty < t.minQty)
    ) {
      return { ok: false, error: "invalid_max_qty" };
    }
    if (!Number.isInteger(t.unitPriceCents) || t.unitPriceCents < 0) {
      return { ok: false, error: "invalid_unit_price" };
    }
  }

  if (sorted[0].minQty !== 1) {
    return { ok: false, error: "first_tier_must_start_at_1" };
  }

  const last = sorted[sorted.length - 1];
  if (last.maxQty !== null) {
    return { ok: false, error: "last_tier_must_be_unbounded" };
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].maxQty === null) {
      return { ok: false, error: "only_last_tier_may_be_unbounded" };
    }
    if (sorted[i].maxQty! + 1 !== sorted[i + 1].minQty) {
      return { ok: false, error: "gap_or_overlap_between_tiers" };
    }
  }

  const warnings: string[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i + 1].unitPriceCents > sorted[i].unitPriceCents) {
      warnings.push("price_increases_with_quantity");
      break;
    }
  }

  return { ok: true, sorted, warnings };
}

/** Reference/starting price for display before a quantity is chosen —
 *  the price of the first tier (minQty=1, what a single copy costs).
 *  Deliberately NOT the minimum across the ladder, which would be the
 *  deepest bulk-discount price and misleading as a "base" price. */
export function deriveReferencePriceCents(sortedTiers: PriceTierInput[]): number {
  return sortedTiers[0].unitPriceCents;
}

/**
 * Resolves the price PER UNIT that applies to an order of `quantity`
 * of a variant. Falls back to `basePriceCents` when there are no tiers
 * (flat pricing — the common case today). Defensive fallback to the
 * tier with the smallest minQty if quantity is below every tier's
 * range (shouldn't happen for a ladder that passed validateTierLadder,
 * since the first tier always starts at 1).
 */
export function resolveUnitPriceForQuantity(
  basePriceCents: number,
  tiers: PriceTierInput[],
  quantity: number
): number {
  if (tiers.length === 0) return basePriceCents;

  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
  const match = sorted.find(
    (t) => quantity >= t.minQty && (t.maxQty === null || quantity <= t.maxQty)
  );
  return match ? match.unitPriceCents : sorted[0].unitPriceCents;
}

/**
 * Whether a ladder's tiers carry a cost alongside their price: "none"
 * (flat costCents on the variant applies throughout, the common case),
 * "all" (every tier has its own unitCostCents — costCents becomes a
 * cached mirror of the first tier, same as price), or "partial" (some
 * tiers have a cost and others don't — not a coherent ladder, callers
 * must reject it rather than guess which unpriced tiers fall back to
 * the flat cost).
 */
export function costTierConsistency(
  tiers: PriceTierInput[]
): "none" | "all" | "partial" {
  const withCost = tiers.filter(
    (t) => t.unitCostCents !== null && t.unitCostCents !== undefined
  ).length;
  if (withCost === 0) return "none";
  if (withCost === tiers.length) return "all";
  return "partial";
}
