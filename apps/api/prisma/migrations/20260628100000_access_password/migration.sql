-- Optionaler Passwortschutz pro Freigabe-Link (zusätzlich zum
-- Galerie-Passwort). Null = kein Link-Passwort.
ALTER TABLE "gallery_access" ADD COLUMN "passwordHash" TEXT;
