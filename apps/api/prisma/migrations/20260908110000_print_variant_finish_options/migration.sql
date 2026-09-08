-- Customer-selectable finish options per variant (e.g. frame color),
-- and the snapshot columns order items need to keep their finish
-- choice historically stable.
CREATE TABLE "print_product_variant_finish_options" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "printProductVariantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "priceDeltaCents" INTEGER NOT NULL DEFAULT 0,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "print_product_variant_finish_options_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "print_product_variant_finish_options_printProductVariantId_idx" ON "print_product_variant_finish_options"("printProductVariantId");

CREATE UNIQUE INDEX "print_product_variant_finish_options_printProductVariantId__key" ON "print_product_variant_finish_options"("printProductVariantId", "name");

ALTER TABLE "print_product_variant_finish_options" ADD CONSTRAINT "print_product_variant_finish_options_printProductVariantId_fkey" FOREIGN KEY ("printProductVariantId") REFERENCES "print_product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "print_order_items" ADD COLUMN "finishOptionId" UUID;
ALTER TABLE "print_order_items" ADD COLUMN "finishOptionName" TEXT;
ALTER TABLE "print_order_items" ADD COLUMN "finishOptionSku" TEXT;

ALTER TABLE "print_order_items" ADD CONSTRAINT "print_order_items_finishOptionId_fkey" FOREIGN KEY ("finishOptionId") REFERENCES "print_product_variant_finish_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;
