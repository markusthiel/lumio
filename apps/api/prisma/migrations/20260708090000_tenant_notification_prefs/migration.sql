-- Studio-E-Mail-Benachrichtigungs-Einstellungen (JSON-Map eventKey→bool).
ALTER TABLE "tenants" ADD COLUMN "notificationPrefs" JSONB;

-- Throttle-Marker für die "Speicher fast voll"-Mail.
ALTER TABLE "billing_subscriptions" ADD COLUMN "storageWarnedAt" TIMESTAMP(3);

