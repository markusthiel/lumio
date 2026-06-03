-- Billing-Archiv-Lifecycle: additive Spalten auf billing_subscriptions.
-- Rein additiv (alle nullable) — läuft ohne Datenverlust durch.
ALTER TABLE "billing_subscriptions"
  ADD COLUMN "archivedSince" TIMESTAMP(3),
  ADD COLUMN "purgeScheduledFor" TIMESTAMP(3),
  ADD COLUMN "archiveNoticeMailedAt" TIMESTAMP(3),
  ADD COLUMN "purgeReminderMailedAt" TIMESTAMP(3);

CREATE INDEX "billing_subscriptions_readOnlySince_idx" ON "billing_subscriptions"("readOnlySince");
CREATE INDEX "billing_subscriptions_purgeScheduledFor_idx" ON "billing_subscriptions"("purgeScheduledFor");
