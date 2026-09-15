-- Quantity-break pricing tiers for print product variants.
--
-- Purely additive: new table only, no existing column touched, no
-- backfill needed. Existing variants have zero tier rows, so every
-- tier-aware read path (services/print/pricing-tiers.ts) falls back to
-- the untouched print_product_variants.priceCents column — flat
-- pricing behaves exactly as before until a studio deliberately adds
-- tiers to a variant.
--
-- Ladder shape (first tier minQty=1, last tier maxQty=null, no gaps or
-- overlaps) is validated at the service layer, not by the DB. The
-- unique index below only prevents two tiers from claiming the same
-- minQty on the same variant.
--
-- Generated via `prisma migrate diff` against the schema change, kept
-- verbatim (only this header comment added) so it matches what
-- `prisma migrate dev` would compute — no hand-tuned index names.

-- CreateTable
CREATE TABLE "print_product_variant_price_tiers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "printProductVariantId" UUID NOT NULL,
    "minQty" INTEGER NOT NULL,
    "maxQty" INTEGER,
    "unitPriceCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "print_product_variant_price_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "print_product_variant_price_tiers_printProductVariantId_idx" ON "print_product_variant_price_tiers"("printProductVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "print_product_variant_price_tiers_printProductVariantId_min_key" ON "print_product_variant_price_tiers"("printProductVariantId", "minQty");

-- AddForeignKey
ALTER TABLE "print_product_variant_price_tiers" ADD CONSTRAINT "print_product_variant_price_tiers_printProductVariantId_fkey" FOREIGN KEY ("printProductVariantId") REFERENCES "print_product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
