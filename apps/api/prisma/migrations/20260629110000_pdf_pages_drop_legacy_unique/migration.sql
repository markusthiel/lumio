-- Korrektur zu 20260629100000_pdf_pages
--
-- Auf manchen Deployments blieb der alte Unique-Constraint
-- "renditions_fileId_kind_key" (fileId, kind) trotz des DROP in der
-- vorherigen Migration bestehen. Er blockiert das Einfuegen mehrerer
-- Seiten desselben Kinds (z.B. zweimal "thumb" fuer Seite 0 und 1) und
-- liess PDF-Jobs mit UniqueViolation scheitern.
--
-- Idempotent nachziehen: alten Constraint entfernen, neuen sicherstellen.
-- Der neue (fileId, kind, page) existiert auf den meisten Deployments
-- bereits; das DO-Block legt ihn nur an, falls er fehlt.

ALTER TABLE "renditions" DROP CONSTRAINT IF EXISTS "renditions_fileId_kind_key";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'renditions_fileId_kind_page_key'
  ) THEN
    ALTER TABLE "renditions"
      ADD CONSTRAINT "renditions_fileId_kind_page_key"
      UNIQUE ("fileId", "kind", "page");
  END IF;
END $$;
