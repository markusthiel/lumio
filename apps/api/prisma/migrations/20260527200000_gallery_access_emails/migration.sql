-- GalleryAccess: single email → multiple emails
--
-- Vorher: email Citext NULL (eine Adresse pro Access)
-- Nachher: emails TEXT[] NOT NULL DEFAULT '{}' (mehrere)
--
-- Use-Case: Brautpaar = 2 Adressen, Familie = mehrere, Agentur =
-- mehrere Ansprechpartner. Eine Adresse pro Link war ein Limit
-- ohne fachlichen Grund.
--
-- Daten-Migration: existierende single-emails landen als 1-Element-
-- Array. NULL-Werte werden zu leerem Array.

-- 1. Neue Spalte anlegen mit Default-Wert
ALTER TABLE "gallery_access"
  ADD COLUMN "emails" TEXT[] NOT NULL DEFAULT '{}';

-- 2. Bestehende email-Werte ins Array kopieren
UPDATE "gallery_access"
SET "emails" = ARRAY["email"]::TEXT[]
WHERE "email" IS NOT NULL AND "email" != '';

-- 3. Alte Spalte droppen
ALTER TABLE "gallery_access" DROP COLUMN "email";
