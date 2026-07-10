-- Marketing / Lifecycle E-Mail-Felder auf billing_subscriptions
ALTER TABLE "billing_subscriptions"
  ADD COLUMN "marketingEmailsEnabled"  BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "trialReminder3dMailedAt" TIMESTAMPTZ,
  ADD COLUMN "trialCancelledMailedAt"  TIMESTAMPTZ,
  ADD COLUMN "trialExpiredMailedAt"    TIMESTAMPTZ,
  ADD COLUMN "winbackMailedAt"         TIMESTAMPTZ;

-- Globale System-Einstellungen (Super-Admin Kill-Switch)
CREATE TABLE "system_config" (
  "key"       TEXT PRIMARY KEY,
  "value"     TEXT NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Startwert: Marketing-Mails aktiviert
INSERT INTO "system_config" ("key", "value", "updatedAt")
VALUES ('marketing_emails_enabled', 'true', NOW())
ON CONFLICT ("key") DO NOTHING;
