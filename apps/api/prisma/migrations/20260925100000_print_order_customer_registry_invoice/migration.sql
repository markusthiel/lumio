-- Full customer registry (anagrafica), collected at checkout. All nullable:
-- orders placed before this migration have none of it.
ALTER TABLE "print_orders" ADD COLUMN "guestFirstName" TEXT;
ALTER TABLE "print_orders" ADD COLUMN "guestLastName" TEXT;
ALTER TABLE "print_orders" ADD COLUMN "guestPhone" TEXT;
ALTER TABLE "print_orders" ADD COLUMN "guestTaxCode" TEXT;
ALTER TABLE "print_orders" ADD COLUMN "customerAddress" JSONB;

-- Invoice request. The invoice address goes into the existing
-- "billingAddress" column.
ALTER TABLE "print_orders" ADD COLUMN "invoiceRequested" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "print_orders" ADD COLUMN "invoiceKind" TEXT;
ALTER TABLE "print_orders" ADD COLUMN "invoiceName" TEXT;
ALTER TABLE "print_orders" ADD COLUMN "invoiceVatNumber" TEXT;
ALTER TABLE "print_orders" ADD COLUMN "invoiceTaxCode" TEXT;
ALTER TABLE "print_orders" ADD COLUMN "invoiceEAddress" TEXT;

-- What the checkout asks customers for beyond name, address and phone (VAT
-- number, tax ID, e-invoice address, per customer kind; labels; check types).
-- NULL = the defaults: nothing asked.
ALTER TABLE "tenant_print_shop_config" ADD COLUMN "invoiceSettings" JSONB;
