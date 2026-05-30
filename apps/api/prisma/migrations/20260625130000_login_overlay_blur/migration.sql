-- Optionaler Weichzeichner (Glas-Effekt) hinter der Login-Farbfläche, in px.
-- Null/0 = kein Blur. Wirkt nur zusammen mit einem Hintergrundbild.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "loginOverlayBlur" INTEGER;
