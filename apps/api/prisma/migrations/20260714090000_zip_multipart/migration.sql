-- Mehrteilige ZIP-Downloads: große Galerien werden in mehrere Teil-ZIPs
-- aufgeteilt (Größen-Cap ZIP_PART_MAX_BYTES, Default 8 GiB). Additiv und
-- rückwärtskompatibel — bestehende Einträge behalten partCount = 0 und
-- liefern weiterhin ihr Einzel-ZIP aus storageKey.

ALTER TABLE "zip_downloads" ADD COLUMN "partCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "zip_download_parts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "zipDownloadId" UUID NOT NULL,
    "partIndex" INTEGER NOT NULL,
    "label" TEXT,
    "storageKey" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "fileCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zip_download_parts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "zip_download_parts_zipDownloadId_partIndex_key" ON "zip_download_parts"("zipDownloadId", "partIndex");

CREATE INDEX "zip_download_parts_zipDownloadId_idx" ON "zip_download_parts"("zipDownloadId");

ALTER TABLE "zip_download_parts" ADD CONSTRAINT "zip_download_parts_zipDownloadId_fkey" FOREIGN KEY ("zipDownloadId") REFERENCES "zip_downloads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
