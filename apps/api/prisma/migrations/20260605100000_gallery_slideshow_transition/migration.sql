-- =============================================================================
-- Slideshow-Übergangseffekt pro Galerie
-- =============================================================================
-- Drei Modi:
--   fade     (Default, aktuelles Verhalten)
--   slide    horizontaler Slide-In von rechts
--   kenburns langsamer Zoom + Pan ("Slideshow-Klassiker")

ALTER TABLE "galleries"
    ADD COLUMN "slideshowTransition" TEXT NOT NULL DEFAULT 'fade';
