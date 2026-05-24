-- Composite-Index fuer Duplikat-Erkennung pro Galerie.
--
-- Die Dup-Detection-Query gruppiert nach sha256 innerhalb einer Galerie:
--
--   SELECT sha256, array_agg(id ORDER BY "createdAt")
--   FROM files
--   WHERE "galleryId" = $1 AND sha256 IS NOT NULL
--   GROUP BY sha256
--   HAVING count(*) > 1
--
-- Ohne diesen Index muesste PostgreSQL den galleryId-Index nutzen
-- (bringt Tabellenseiten) und dann pro Row den sha256 lesen — bei
-- 10k-File-Galerien spuerbar. Mit dem Composite-Index ist's ein
-- pure Index-Scan.
CREATE INDEX IF NOT EXISTS "files_galleryId_sha256_idx"
  ON "files"("galleryId", "sha256");
