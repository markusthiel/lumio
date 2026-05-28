-- Print-Shop: alle Tabellen + Lookups + Erweiterungen an bestehenden Modellen

-- =============================================================================
-- Erweiterungen an bestehenden Tabellen
-- =============================================================================

-- BillingPlan: optionaler Cut auf Print-Bestellungen pro Plan
ALTER TABLE "billing_plans"
  ADD COLUMN "printApplicationFeeBps" INTEGER NOT NULL DEFAULT 0;

-- Gallery: per-Galerie-Override fuer Print-Shop-Sichtbarkeit
ALTER TABLE "galleries"
  ADD COLUMN "printShopEnabled" BOOLEAN;

-- =============================================================================
-- Super-Admin-Globale Provider-Aktivierung
-- =============================================================================
CREATE TABLE "super_print_provider_config" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "providerKey" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "adminNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "super_print_provider_config_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "super_print_provider_config_providerKey_key"
  ON "super_print_provider_config"("providerKey");

-- =============================================================================
-- Tenant-Print-Shop-Config (1:1)
-- =============================================================================
CREATE TABLE "tenant_print_shop_config" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "studioDisplayName" TEXT,
  "supportEmail" TEXT,
  "vatHandling" TEXT NOT NULL DEFAULT 'inclusive',
  "defaultVatBps" INTEGER NOT NULL DEFAULT 1900,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "termsUrl" TEXT,
  "privacyUrl" TEXT,
  "applicationFeeBpsOverride" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_print_shop_config_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tenant_print_shop_config_tenantId_key"
  ON "tenant_print_shop_config"("tenantId");
ALTER TABLE "tenant_print_shop_config"
  ADD CONSTRAINT "tenant_print_shop_config_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- Tenant-Stripe-Connect-Status (1:1)
-- =============================================================================
CREATE TABLE "tenant_stripe_connect" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "stripeConnectedAccountId" TEXT NOT NULL,
  "chargesEnabled" BOOLEAN NOT NULL DEFAULT false,
  "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "detailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
  "onboardedAt" TIMESTAMP(3),
  "lastWebhookSyncAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_stripe_connect_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tenant_stripe_connect_tenantId_key"
  ON "tenant_stripe_connect"("tenantId");
CREATE UNIQUE INDEX "tenant_stripe_connect_stripeConnectedAccountId_key"
  ON "tenant_stripe_connect"("stripeConnectedAccountId");
ALTER TABLE "tenant_stripe_connect"
  ADD CONSTRAINT "tenant_stripe_connect_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- Pro Tenant aktivierte Print-Provider
-- =============================================================================
CREATE TABLE "tenant_print_provider" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "providerKey" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "displayName" TEXT,
  "credentialsEnc" BYTEA,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_print_provider_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tenant_print_provider_tenantId_providerKey_key"
  ON "tenant_print_provider"("tenantId", "providerKey");
CREATE INDEX "tenant_print_provider_tenantId_idx"
  ON "tenant_print_provider"("tenantId");
ALTER TABLE "tenant_print_provider"
  ADD CONSTRAINT "tenant_print_provider_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- Produktkatalog
-- =============================================================================
CREATE TABLE "print_products" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "providerKey" TEXT NOT NULL,
  "providerProductRef" TEXT,
  "category" TEXT NOT NULL DEFAULT 'print',
  "vatBpsOverride" INTEGER,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "print_products_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "print_products_tenantId_enabled_idx"
  ON "print_products"("tenantId", "enabled");
ALTER TABLE "print_products"
  ADD CONSTRAINT "print_products_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "print_product_variants" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "printProductId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "widthMm" INTEGER NOT NULL,
  "heightMm" INTEGER NOT NULL,
  "aspectRatio" DOUBLE PRECISION,
  "finishType" TEXT,
  "providerVariantRef" TEXT,
  "priceCents" INTEGER NOT NULL,
  "costCents" INTEGER,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "print_product_variants_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "print_product_variants_printProductId_enabled_idx"
  ON "print_product_variants"("printProductId", "enabled");
ALTER TABLE "print_product_variants"
  ADD CONSTRAINT "print_product_variants_printProductId_fkey"
  FOREIGN KEY ("printProductId") REFERENCES "print_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- Versandmethoden
-- =============================================================================
CREATE TABLE "shipping_methods" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "providerKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "priceCents" INTEGER NOT NULL,
  "estimatedDaysMin" INTEGER,
  "estimatedDaysMax" INTEGER,
  "countries" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "providerShippingRef" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "shipping_methods_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "shipping_methods_tenantId_enabled_idx"
  ON "shipping_methods"("tenantId", "enabled");
ALTER TABLE "shipping_methods"
  ADD CONSTRAINT "shipping_methods_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- Orders
-- =============================================================================
CREATE TABLE "print_orders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "orderNumber" TEXT NOT NULL,
  "tenantId" UUID NOT NULL,
  "galleryId" UUID NOT NULL,
  "guestEmail" TEXT NOT NULL,
  "guestName" TEXT NOT NULL,
  "shippingAddress" JSONB NOT NULL,
  "billingAddress" JSONB,
  "paymentMode" TEXT NOT NULL,
  "stripePaymentIntentId" TEXT,
  "stripeChargeId" TEXT,
  "subtotalCents" INTEGER NOT NULL,
  "shippingCents" INTEGER NOT NULL DEFAULT 0,
  "taxCents" INTEGER NOT NULL DEFAULT 0,
  "totalCents" INTEGER NOT NULL,
  "applicationFeeCents" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "providerKey" TEXT NOT NULL,
  "providerOrderRef" TEXT,
  "shippingMethodId" UUID,
  "trackingNumber" TEXT,
  "trackingCarrier" TEXT,
  "trackingUrl" TEXT,
  "guestNote" TEXT,
  "studioNote" TEXT,
  "paidAt" TIMESTAMP(3),
  "productionStartedAt" TIMESTAMP(3),
  "shippedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "refundedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "print_orders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "print_orders_orderNumber_key" ON "print_orders"("orderNumber");
CREATE UNIQUE INDEX "print_orders_stripePaymentIntentId_key"
  ON "print_orders"("stripePaymentIntentId")
  WHERE "stripePaymentIntentId" IS NOT NULL;
CREATE INDEX "print_orders_tenantId_status_idx" ON "print_orders"("tenantId", "status");
CREATE INDEX "print_orders_tenantId_createdAt_idx" ON "print_orders"("tenantId", "createdAt");
CREATE INDEX "print_orders_galleryId_idx" ON "print_orders"("galleryId");
ALTER TABLE "print_orders"
  ADD CONSTRAINT "print_orders_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "print_orders"
  ADD CONSTRAINT "print_orders_galleryId_fkey"
  FOREIGN KEY ("galleryId") REFERENCES "galleries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "print_orders"
  ADD CONSTRAINT "print_orders_shippingMethodId_fkey"
  FOREIGN KEY ("shippingMethodId") REFERENCES "shipping_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "print_order_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "printOrderId" UUID NOT NULL,
  "printProductVariantId" UUID NOT NULL,
  "fileId" UUID NOT NULL,
  "crop" JSONB,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "unitPriceCents" INTEGER NOT NULL,
  "totalPriceCents" INTEGER NOT NULL,
  "providerItemRef" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "print_order_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "print_order_items_printOrderId_idx" ON "print_order_items"("printOrderId");
ALTER TABLE "print_order_items"
  ADD CONSTRAINT "print_order_items_printOrderId_fkey"
  FOREIGN KEY ("printOrderId") REFERENCES "print_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "print_order_items"
  ADD CONSTRAINT "print_order_items_printProductVariantId_fkey"
  FOREIGN KEY ("printProductVariantId") REFERENCES "print_product_variants"("id") ON UPDATE CASCADE;
-- File-Restrict: kein File-Delete erlaubt solange Order-Items darauf zeigen
-- (Audit-Bedarf — historische Bestellungen muessen das File noch finden).
ALTER TABLE "print_order_items"
  ADD CONSTRAINT "print_order_items_fileId_fkey"
  FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "print_order_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "printOrderId" UUID NOT NULL,
  "eventType" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "actorUserId" UUID,
  "data" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "print_order_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "print_order_events_printOrderId_createdAt_idx"
  ON "print_order_events"("printOrderId", "createdAt");
ALTER TABLE "print_order_events"
  ADD CONSTRAINT "print_order_events_printOrderId_fkey"
  FOREIGN KEY ("printOrderId") REFERENCES "print_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
