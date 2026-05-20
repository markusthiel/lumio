-- =============================================================================
-- Grid-Layout-Variante für die Customer-Galerie
-- =============================================================================
-- Drei Modi:
--   masonry   (Default, aktuelles Verhalten — CSS-columns)
--   justified (Flickr-Style, Reihen-Layout über flex-wrap+grow)
--   equal     (alle Tiles gleich groß)

ALTER TABLE "galleries"
    ADD COLUMN "gridLayout" TEXT NOT NULL DEFAULT 'masonry';
