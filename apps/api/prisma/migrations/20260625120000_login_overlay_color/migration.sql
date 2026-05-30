-- Optionale Farbfläche (mit variabler Transparenz) über dem Login-
-- Hintergrundbild. RGBA-Hex wie "#00000066". Analog zu
-- gallery.heroOverlayColor. Null = layout-abhängiger Default.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "loginOverlayColor" VARCHAR(9);
