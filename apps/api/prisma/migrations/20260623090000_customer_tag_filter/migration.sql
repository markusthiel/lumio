-- Tag-Filter fuer Endkunden pro Galerie aktivierbar
-- Default false: bestehende Galerien aendern sich nicht.
ALTER TABLE "galleries"
  ADD COLUMN "customerTagFilterEnabled" BOOLEAN NOT NULL DEFAULT false;
