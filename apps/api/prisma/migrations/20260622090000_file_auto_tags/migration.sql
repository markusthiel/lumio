-- Migration: file_auto_tags
--
-- KI-Auto-Tagging-Pipeline. Worker schreibt Vorschlaege als Rows in
-- file_auto_tags. Studio reviewed sie (accept → wird zu echtem FileTag,
-- reject → bleibt in der Tabelle damit Re-Tag den Vorschlag nicht
-- doppelt macht).

CREATE TABLE "file_auto_tags" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
    "fileId"      UUID NOT NULL,
    "tagName"     TEXT NOT NULL,
    "confidence"  DOUBLE PRECISION NOT NULL,
    "source"      TEXT NOT NULL,
    "status"      TEXT NOT NULL DEFAULT 'suggested',
    "reviewedBy"  UUID,
    "reviewedAt"  TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_auto_tags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "file_auto_tags_fileId_tagName_key"
    ON "file_auto_tags" ("fileId", "tagName");

CREATE INDEX "file_auto_tags_fileId_status_idx"
    ON "file_auto_tags" ("fileId", "status");

CREATE INDEX "file_auto_tags_tagName_idx"
    ON "file_auto_tags" ("tagName");

ALTER TABLE "file_auto_tags" ADD CONSTRAINT "file_auto_tags_fileId_fkey"
    FOREIGN KEY ("fileId") REFERENCES "files"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
