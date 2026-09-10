/**
 * Client-side mirror of the server's quantity-break price resolution
 * (apps/api/src/services/print/pricing-tiers.ts, resolveUnitPriceForQuantity).
 * Used only for live previews (product picker, cart) — the checkout
 * total is always recomputed and enforced server-side via priceCart(),
 * so drift here can only affect what a customer sees before paying,
 * never what they're actually charged.
 */

export interface PrintPriceTierLike {
  minQty: number;
  maxQty: number | null;
  unitPriceCents: number;
}

export function unitPriceForQuantity(
  variant: { priceCents: number; priceTiers?: PrintPriceTierLike[] },
  quantity: number
): number {
  const tiers = variant.priceTiers;
  if (!tiers || tiers.length === 0) return variant.priceCents;

  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
  const match = sorted.find(
    (t) => quantity >= t.minQty && (t.maxQty === null || quantity <= t.maxQty)
  );
  return match ? match.unitPriceCents : sorted[0].unitPriceCents;
}

/**
 * Total quantity already in the cart for one variant (format) — mirrors
 * the server's aggregation in resolveCartItemPricing(): a quantity-break
 * tier applies per FORMAT across every photo ordered in it, not per
 * individual cart line. Used to preview the tier a customer will
 * actually land on, whether they're editing an existing cart line or
 * about to add a new photo in a format they already have some of.
 */
export function aggregateQuantityForVariant(
  cartItems: Array<{ variantId: string; quantity: number }>,
  variantId: string
): number {
  return cartItems.reduce(
    (sum, it) => (it.variantId === variantId ? sum + it.quantity : sum),
    0
  );
}

/**
 * Same aggregation as aggregateQuantityForVariant(), but for every
 * variant in the cart at once (one O(n) pass instead of one per line).
 * Use this instead of calling aggregateQuantityForVariant() inside a
 * cart.map() — that would re-reduce the whole cart per line (O(n²)).
 */
export function buildQuantityByVariantMap(
  cartItems: Array<{ variantId: string; quantity: number }>
): Map<string, number> {
  const map = new Map<string, number>();
  for (const it of cartItems) {
    map.set(it.variantId, (map.get(it.variantId) ?? 0) + it.quantity);
  }
  return map;
}

/**
 * Whether shrinking one line's quantity for a format (removing an item
 * entirely, or reducing how many of it) pushes the REMAINING lines of
 * that same format into a worse (higher per-unit) tier. Per-format
 * tiers apply across the whole cart, so removing one photo can raise
 * the price of others silently — this lets the cart warn about it
 * instead of leaving the customer to notice a total that went up.
 * `quantityAfter <= 0` means no lines of this format remain, so there's
 * nothing left to warn about.
 */
export function willDowngradeTier(
  variant: { priceCents: number; priceTiers?: PrintPriceTierLike[] },
  quantityBefore: number,
  quantityAfter: number
): boolean {
  if (quantityAfter <= 0) return false;
  return (
    unitPriceForQuantity(variant, quantityAfter) >
    unitPriceForQuantity(variant, quantityBefore)
  );
}
