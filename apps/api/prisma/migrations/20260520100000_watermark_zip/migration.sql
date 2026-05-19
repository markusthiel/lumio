-- =============================================================================
-- Lumio — Migration: watermark + zip downloads
-- =============================================================================

-- Watermark-Konfig auf Tenant-Ebene
ALTER TABLE "tenants"
  ADD COLUMN "watermarkImageKey" TEXT,
  ADD COLUMN "watermarkText"     TEXT;

-- ZIP Downloads
CREATE TABLE "zip_downloads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "galleryId" UUID NOT NULL,
    "accessId" UUID,
    "fileIdsHash" TEXT,
    "fileCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "storageKey" TEXT,
    "sizeBytes" BIGINT,
    "errorMessage" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "zip_downloads_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "zip_downloads_galleryId_expiresAt_idx"
  ON "zip_downloads"("galleryId", "expiresAt");
CREATE UNIQUE INDEX "zip_downloads_galleryId_accessId_fileIdsHash_key"
  ON "zip_downloads"("galleryId", "accessId", "fileIdsHash");

ALTER TABLE "zip_downloads"
  ADD CONSTRAINT "zip_downloads_galleryId_fkey"
  FOREIGN KEY ("galleryId") REFERENCES "galleries"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
