-- =============================================================================
-- zip_downloads.source: wer hat den Build ausgelöst?
-- =============================================================================
-- "customer" | "studio". Bisher war nicht unterscheidbar, ob eine Zeile über
-- einen Kunden-Endpoint (/g/:slug/download/...) oder einen authentifizierten
-- Studio-Endpoint (Tag-Export, Print-Order-Bundle) entstanden ist — beide
-- landen mit accessId=null in derselben Tabelle. Die Kunden-Route
-- (GET /g/:slug/download/zip/:zipId) prüfte nur accessId und konnte damit
-- ein Studio-Artefakt zurückgeben, wenn die zipId irgendwie durchsickert
-- (Link, Browser-Verlauf, Support-Screenshot) — u.a. Originale aus einer
-- Galerie mit deaktiviertem Original-Download. Siehe #45.
--
-- Default 'customer' für Rückwärtskompatibilität: bestehende Zeilen wurden
-- ausschließlich von Kunden-Endpoints erzeugt (die Studio-Endpoints, die
-- jetzt 'studio' setzen, existieren erst seit #23/#44) und bleiben über die
-- Kunden-Route weiterhin lesbar wie bisher.
--
-- source muss Teil des Unique-Constraints sein: mit accessId=null (z.B.
-- öffentliche Galerien) könnten sonst ein Kunden- und ein Studio-Export mit
-- identischem Datei-Set/Variant denselben Cache-Eintrag treffen, und der
-- zuerst schreibende Request würde den source-Wert für alle folgenden
-- festlegen.

ALTER TABLE "zip_downloads"
    ADD COLUMN "source" TEXT NOT NULL DEFAULT 'customer';

-- Alten Constraint droppen und neuen mit source anlegen
ALTER TABLE "zip_downloads"
    DROP CONSTRAINT IF EXISTS "zip_downloads_galleryId_accessId_fileIdsHash_variant_key";

ALTER TABLE "zip_downloads"
    ADD CONSTRAINT "zip_downloads_galleryId_accessId_source_fileIdsHash_variant_key"
    UNIQUE ("galleryId", "accessId", "source", "fileIdsHash", "variant");
