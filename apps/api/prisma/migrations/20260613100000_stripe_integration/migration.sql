-- Stripe Integration Sprint 2 — Foundation
--
-- 1) Tenant kriegt stripeCustomerId. Existing Spalte auf
--    BillingSubscription bleibt, wird aber bei zukünftigen
--    Schreibvorgängen ignoriert (Migration zur sauberen Position
--    auf Tenant kommt später wenn alle Tenants gemigrated sind).
-- 2) BillingSubscription kriegt subscription-item-ids für die
--    zwei Item-Types (Plan + Storage-Pack).
-- 3) Neue stripe_webhook_events-Tabelle für Dedup + Audit.

ALTER TABLE "tenants" ADD COLUMN "stripeCustomerId" TEXT;
CREATE UNIQUE INDEX "tenants_stripeCustomerId_key" ON "tenants"("stripeCustomerId");

ALTER TABLE "billing_subscriptions" ADD COLUMN "stripePlanItemId" TEXT;
ALTER TABLE "billing_subscriptions" ADD COLUMN "stripeStorageAddonItemId" TEXT;

CREATE TABLE "stripe_webhook_events" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "stripeEventId" TEXT NOT NULL UNIQUE,
  "type"          TEXT NOT NULL,
  "payload"       JSONB NOT NULL,
  "status"        TEXT NOT NULL DEFAULT 'received',
  "errorMessage"  TEXT,
  "tenantId"      UUID,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt"   TIMESTAMP(3)
);

CREATE INDEX "stripe_webhook_events_tenantId_createdAt_idx"
  ON "stripe_webhook_events"("tenantId", "createdAt");
CREATE INDEX "stripe_webhook_events_type_createdAt_idx"
  ON "stripe_webhook_events"("type", "createdAt");
CREATE INDEX "stripe_webhook_events_status_createdAt_idx"
  ON "stripe_webhook_events"("status", "createdAt");
