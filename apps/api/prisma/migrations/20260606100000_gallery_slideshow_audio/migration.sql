-- =============================================================================
-- Slideshow-Audio pro Galerie
-- =============================================================================
-- Storage-Key auf ein hochgeladenes Audio-File (MP3/AAC/OGG). Wird nur
-- im Slideshow-Modus abgespielt, nicht im normalen Browse-Modus.
-- Auto-Play in der Slideshow ist OK weil der User dort schon eine
-- explizite Geste (Slideshow-Start) gemacht hat.

ALTER TABLE "galleries"
    ADD COLUMN "slideshowAudioUrl" TEXT;
