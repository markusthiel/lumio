-- Token-spezifischer Payload als JSON.
--
-- Aktuell verwendet fuer kind="email_change": haelt die NEUE
-- E-Mail-Adresse die nach Click bestaetigt werden soll. Bei
-- setup/reset bleibt das Feld NULL.
--
-- Nullable damit alle bestehenden Tokens (setup/reset) unveraendert
-- bleiben.
ALTER TABLE "password_reset_tokens" ADD COLUMN "payload" JSONB;
