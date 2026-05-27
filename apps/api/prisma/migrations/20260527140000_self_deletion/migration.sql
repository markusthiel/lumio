-- Self-Service-Tenant-Loeschung (DSGVO Art. 17)
--
-- Owner kann sein Studio selbst zur Loeschung anmelden. Drei neue
-- Felder am Tenant tracken den Loeschwunsch + Stichtag fuer Hard-
-- Delete + Reminder-Mail-State.
--
-- Trennung zu archivedAt/archiveScheduledAt:
-- Self-Service = owner-getrieben, 60 Tage Karenz, am Ende Hard-Delete.
-- Archive (Super-Admin) = soft archive forever, manueller Hard-Delete.
--
-- Index auf selfDeletionScheduledFor, weil der Sweeper periodisch
-- darueber filtert (WHERE selfDeletionScheduledFor <= NOW()) — ohne
-- Index ein Full-Table-Scan, mit Index O(log n).
ALTER TABLE "tenants"
  ADD COLUMN "selfDeletionRequestedAt"      TIMESTAMP(3),
  ADD COLUMN "selfDeletionRequestedById"    UUID,
  ADD COLUMN "selfDeletionScheduledFor"     TIMESTAMP(3),
  ADD COLUMN "selfDeletionReminderMailedAt" TIMESTAMP(3);

CREATE INDEX "tenants_selfDeletionScheduledFor_idx"
  ON "tenants"("selfDeletionScheduledFor");
