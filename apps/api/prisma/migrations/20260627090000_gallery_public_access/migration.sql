-- Zugriffsmodus pro Galerie: true = öffentlich (jeder mit Link),
-- false = nur über gültige Freigabe-Links. Default true (bestehende
-- Galerien bleiben öffentlich, kein Verhaltenswechsel).
ALTER TABLE "galleries" ADD COLUMN "publicAccess" BOOLEAN NOT NULL DEFAULT true;
