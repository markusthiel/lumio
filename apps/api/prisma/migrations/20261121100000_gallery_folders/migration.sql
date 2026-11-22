-- =============================================================================
-- Gallery folders (#73)
-- =============================================================================
-- A folder tree on top of galleries, per studio. Purely additive: a new table
-- and a nullable column. Existing galleries stay without a folder and the
-- gallery list looks exactly as before.

CREATE TABLE "gallery_folders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "parentId" UUID,
    "name" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gallery_folders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gallery_folders_tenantId_parentId_idx" ON "gallery_folders"("tenantId", "parentId");

ALTER TABLE "gallery_folders"
    ADD CONSTRAINT "gallery_folders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "gallery_folders"
    ADD CONSTRAINT "gallery_folders_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "gallery_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "galleries" ADD COLUMN "folderId" UUID;

CREATE INDEX "galleries_folderId_idx" ON "galleries"("folderId");

ALTER TABLE "galleries"
    ADD CONSTRAINT "galleries_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "gallery_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
