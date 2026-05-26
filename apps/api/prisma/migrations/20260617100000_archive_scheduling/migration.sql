-- Pre-Archive-Warnung
--
-- archiveScheduledAt: Super-Admin plant eine Archivierung im Voraus.
--   Studio zeigt dem Tenant ab dann einen Banner mit Countdown.
--   Bei Erreichen des Stichtags wird NICHT automatisch archiviert,
--   sondern der Sweeper benachrichtigt den Super-Admin per Audit-Log
--   + Mail "Geplantes Archive-Datum erreicht".
--
-- archiveNoticeMailedAt: Timestamp wann die Initial-Mail an alle
--   Owner verschickt wurde (beim Setzen von archiveScheduledAt).
--
-- archiveReminderMailedAt: Timestamp wann die 7-Tage-Reminder-Mail
--   verschickt wurde. Der Sweeper schickt sie wenn:
--     archiveScheduledAt - now() <= 7 Tage  AND  archiveReminderMailedAt IS NULL
--   So vermeidet er Mehrfach-Mails bei mehreren Sweeper-Runs.
--
-- Wenn Super-Admin archiveScheduledAt zurückzieht oder ändert, sollen
-- die Mail-Tracking-Felder ebenfalls zurückgesetzt werden (Backend-Logik
-- im /super/tenants/:id/schedule-archive-Endpoint).
ALTER TABLE "tenants" ADD COLUMN "archiveScheduledAt" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN "archiveNoticeMailedAt" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN "archiveReminderMailedAt" TIMESTAMP(3);
