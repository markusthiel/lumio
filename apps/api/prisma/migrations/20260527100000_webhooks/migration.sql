-- =============================================================================
-- Webhooks (Outbound) + WebhookDelivery (Audit/Retry)
-- =============================================================================
-- Studio-User hinterlegen pro Tenant HTTPS-URLs, die bei definierten Events
-- aufgerufen werden. Auslieferung läuft asynchron über einen Worker; dieser
-- Tabellen-Stand reicht für die Persistenz + Retry-Buchhaltung.

CREATE TABLE "webhooks" (
    "id"             UUID         NOT NULL DEFAULT gen_random_uuid(),
    "tenantId"       UUID         NOT NULL,
    "label"          TEXT         NOT NULL,
    "url"            TEXT         NOT NULL,
    "secret"         TEXT         NOT NULL,
    "events"         TEXT[]       NOT NULL,
    "active"         BOOLEAN      NOT NULL DEFAULT true,
    "lastDeliveryAt" TIMESTAMP(3),
    "lastDeliveryOk" BOOLEAN,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "webhooks_tenantId_idx" ON "webhooks"("tenantId");

ALTER TABLE "webhooks"
    ADD CONSTRAINT "webhooks_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "webhook_deliveries" (
    "id"            UUID         NOT NULL DEFAULT gen_random_uuid(),
    "webhookId"     UUID         NOT NULL,
    "eventType"     TEXT         NOT NULL,
    "payload"       JSONB        NOT NULL,
    "status"        TEXT         NOT NULL,
    "httpStatus"    INTEGER,
    "errorMessage"  TEXT,
    "attempts"      INTEGER      NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "webhook_deliveries_webhookId_createdAt_idx"
    ON "webhook_deliveries"("webhookId", "createdAt");

-- Diese Index hilft dem Worker beim Scan auf retry-bereite Deliveries:
-- WHERE status = 'pending' AND nextAttemptAt <= NOW()
CREATE INDEX "webhook_deliveries_status_nextAttemptAt_idx"
    ON "webhook_deliveries"("status", "nextAttemptAt");

ALTER TABLE "webhook_deliveries"
    ADD CONSTRAINT "webhook_deliveries_webhookId_fkey"
    FOREIGN KEY ("webhookId") REFERENCES "webhooks"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
