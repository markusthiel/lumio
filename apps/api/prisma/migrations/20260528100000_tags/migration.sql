-- =============================================================================
-- Tagging-System
-- =============================================================================
-- tags: hierarchisches Label-System pro Tenant
-- gallery_tags / file_tags: Many-to-Many Join-Tabellen
--
-- Hierarchie: optional, via tags.parentId → tags.id. SET NULL bei Parent-
-- Löschung, damit ein gelöschtes Eltern-Tag das Kind nicht mitreißt;
-- das Kind wird stattdessen ein Top-Level-Tag.

CREATE TABLE "tags" (
    "id"        UUID         NOT NULL DEFAULT gen_random_uuid(),
    "tenantId"  UUID         NOT NULL,
    "name"      TEXT         NOT NULL,
    "color"     TEXT         NOT NULL DEFAULT '#94a3b8',
    "parentId"  UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tags_tenantId_idx" ON "tags"("tenantId");
CREATE INDEX "tags_tenantId_parentId_idx" ON "tags"("tenantId", "parentId");

ALTER TABLE "tags"
    ADD CONSTRAINT "tags_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tags"
    ADD CONSTRAINT "tags_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "tags"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- gallery_tags: composite PK (galleryId, tagId), beide Cascade-delete
CREATE TABLE "gallery_tags" (
    "galleryId" UUID         NOT NULL,
    "tagId"     UUID         NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gallery_tags_pkey" PRIMARY KEY ("galleryId", "tagId")
);

CREATE INDEX "gallery_tags_tagId_idx" ON "gallery_tags"("tagId");

ALTER TABLE "gallery_tags"
    ADD CONSTRAINT "gallery_tags_galleryId_fkey"
    FOREIGN KEY ("galleryId") REFERENCES "galleries"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "gallery_tags"
    ADD CONSTRAINT "gallery_tags_tagId_fkey"
    FOREIGN KEY ("tagId") REFERENCES "tags"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- file_tags: dito
CREATE TABLE "file_tags" (
    "fileId"    UUID         NOT NULL,
    "tagId"     UUID         NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "file_tags_pkey" PRIMARY KEY ("fileId", "tagId")
);

CREATE INDEX "file_tags_tagId_idx" ON "file_tags"("tagId");

ALTER TABLE "file_tags"
    ADD CONSTRAINT "file_tags_fileId_fkey"
    FOREIGN KEY ("fileId") REFERENCES "files"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "file_tags"
    ADD CONSTRAINT "file_tags_tagId_fkey"
    FOREIGN KEY ("tagId") REFERENCES "tags"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
