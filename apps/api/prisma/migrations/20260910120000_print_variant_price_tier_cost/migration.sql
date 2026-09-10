-- Optional per-tier cost, riding along the existing price tier ladder
-- instead of a separate cost-tier table: a supplier price list has one
-- row per quantity breakpoint carrying both what we charge and what it
-- costs us, so the two naturally share minQty/maxQty.
--
-- Purely additive, nullable column, no backfill: every existing tier
-- gets unitCostCents = NULL, which reads as "not tiered on cost" —
-- services/print/pricing-tiers.ts falls back to the untouched flat
-- print_product_variants.costCents for those, exactly as before.

-- AlterTable
ALTER TABLE "print_product_variant_price_tiers" ADD COLUMN "unitCostCents" INTEGER;
