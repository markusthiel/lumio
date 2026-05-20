-- =============================================================================
-- Download-Varianten: Original / Web
-- =============================================================================
-- - galleries.downloadOriginalsEnabled: erlaubt Kunden, die Original-Dateien
--   herunterzuladen. Default true, damit existierende Galerien sich nicht
--   ändern. Wenn false, sind nur Web-Renditions (2560px webp) verfügbar.
--   Greift nur wenn downloadEnabled=true.
--
-- - zip_downloads.variant: "original" | "web", bestimmt was in die ZIP
--   gepackt wird. Default "original" für Rückwärtskompatibilität.
--   Bestehende ready-Einträge haben damit weiter denselben Cache-Schlüssel
--   und werden korrekt als "original" interpretiert.
--
-- Der Unique-Constraint auf zip_downloads muss um variant erweitert werden,
-- sonst kollidieren original-/web-ZIP-Anforderungen derselben Auswahl.

ALTER TABLE "galleries"
    ADD COLUMN "downloadOriginalsEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "zip_downloads"
    ADD COLUMN "variant" TEXT NOT NULL DEFAULT 'original';

-- Alten Constraint droppen und neuen mit variant anlegen
ALTER TABLE "zip_downloads"
    DROP CONSTRAINT IF EXISTS "zip_downloads_galleryId_accessId_fileIdsHash_key";

ALTER TABLE "zip_downloads"
    ADD CONSTRAINT "zip_downloads_galleryId_accessId_fileIdsHash_variant_key"
    UNIQUE ("galleryId", "accessId", "fileIdsHash", "variant");
