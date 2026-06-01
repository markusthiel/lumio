-- PDF-Mehrseiten-Support
--
-- Renditions bekommen eine Seiten-Dimension, damit ein File (eine PDF)
-- pro Seite ein eigenes thumb/preview/web haben kann. Bestehende
-- Renditions (Bilder, Videos) sind Seite 0 — verhalten sich unverändert.
--
-- files.pageCount: NULL für alles ausser PDFs; bei PDFs die Seitenzahl.

ALTER TABLE "renditions" ADD COLUMN "page" INTEGER NOT NULL DEFAULT 0;

-- Der bisherige Unique-Index (fileId, kind) muss die Seite einschliessen,
-- sonst kollidieren z.B. zwei "web"-Renditions verschiedener Seiten.
ALTER TABLE "renditions" DROP CONSTRAINT IF EXISTS "renditions_fileId_kind_key";
ALTER TABLE "renditions"
  ADD CONSTRAINT "renditions_fileId_kind_page_key" UNIQUE ("fileId", "kind", "page");

ALTER TABLE "files" ADD COLUMN "pageCount" INTEGER;
