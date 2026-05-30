-- Optionaler Weichzeichner (Glas-Effekt) hinter dem Galerie-Hero-Overlay,
-- in px. Null/0 = kein Blur. Analog zu tenants.loginOverlayBlur.
ALTER TABLE "galleries" ADD COLUMN IF NOT EXISTS "heroOverlayBlur" INTEGER;
