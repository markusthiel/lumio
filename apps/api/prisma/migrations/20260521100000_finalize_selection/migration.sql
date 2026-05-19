-- =============================================================================
-- Lumio — Migration: gallery_access.finalizedAt + zip notifiedAt
-- =============================================================================

-- Wann der Kunde "Auswahl abschließen" geklickt hat
ALTER TABLE "gallery_access"
  ADD COLUMN "finalizedAt" TIMESTAMP(3);

-- Wann der Kunde über das fertige ZIP benachrichtigt wurde
ALTER TABLE "zip_downloads"
  ADD COLUMN "notifiedAt" TIMESTAMP(3);
