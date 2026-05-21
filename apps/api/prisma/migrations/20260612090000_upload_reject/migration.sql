-- Per-File-Reject für Upload-Link-Uploads
--
-- Erweitert das publicVisibility-Enum um "rejected" und fügt
-- Audit-Metadaten hinzu: wer hat wann mit welchem Grund abgelehnt.
--
-- Beim Reject werden die S3-Objekte (Original + Renditions) physisch
-- gelöscht (Storage-Kosten), aber der DB-Eintrag bleibt erhalten für
-- Audit-Trail und um zu verhindern dass dasselbe File via Re-Upload
-- nochmal durchrutscht.

ALTER TABLE "files" ADD COLUMN "rejectedAt" TIMESTAMP(3);
ALTER TABLE "files" ADD COLUMN "rejectedBy" UUID;
ALTER TABLE "files" ADD COLUMN "rejectedReason" TEXT;

-- Index auf rejectedAt damit "rejected"-Filter in der Studio-UI
-- ohne Full-Scan funktioniert. Partial-Index nur auf nicht-null
-- — kostet uns nichts, weil der publicVisibility-Index schon das
-- Häufige abdeckt.
CREATE INDEX "files_rejectedAt_idx" ON "files"("rejectedAt") WHERE "rejectedAt" IS NOT NULL;
