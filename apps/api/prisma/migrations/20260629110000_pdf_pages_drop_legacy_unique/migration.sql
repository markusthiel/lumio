-- Korrektur zu 20260629100000_pdf_pages
--
-- Prisma legt @@unique als UNIQUE INDEX an, nicht als Table-Constraint.
-- Der DROP CONSTRAINT in der vorherigen Migration war daher ein No-Op:
-- der alte Unique-Index "renditions_fileId_kind_key" (fileId, kind) blieb
-- bestehen und blockierte das Einfuegen mehrerer Seiten desselben Kinds
-- (UniqueViolation auf (fileId,kind)=thumb bei Seite 1+).
--
-- Korrekt per DROP INDEX entfernen. Der neue (fileId,kind,page)-Index
-- wird idempotent sichergestellt (IF NOT EXISTS -> No-Op, wo er via
-- 20260629100000 bereits als Constraint inkl. Backing-Index existiert).

DROP INDEX IF EXISTS "renditions_fileId_kind_key";

CREATE UNIQUE INDEX IF NOT EXISTS "renditions_fileId_kind_page_key"
  ON "renditions" ("fileId", "kind", "page");
