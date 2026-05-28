-- Smart-Sections: GallerySection kann optional einen Tag haben, der
-- die Files automatisch befuellt. Bei Tag-Loeschung wird die Section
-- zu einer manuellen (autoTagId = NULL), bestehende Files bleiben.
ALTER TABLE "gallery_sections"
  ADD COLUMN "autoTagId" UUID;

ALTER TABLE "gallery_sections"
  ADD CONSTRAINT "gallery_sections_autoTagId_fkey"
  FOREIGN KEY ("autoTagId") REFERENCES "tags"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "gallery_sections_autoTagId_idx" ON "gallery_sections"("autoTagId");
