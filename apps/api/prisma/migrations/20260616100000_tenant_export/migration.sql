-- Tenant-Export (Datenexport für DSGVO / Pre-Delete-Backup / Self-Service)
--
-- Drei Tabellen:
--   tenant_exports       — Header pro Export-Auftrag
--   tenant_export_items  — eine Reihe pro Galerie (ZIP)
--   export_tokens        — optional, für Token-basierten Public-Download
--
-- Cascade: tenant_export ↑ tenant. tenant_export_item ↑ tenant_export.
-- export_token ↑ tenant_export. Wenn Tenant gelöscht wird, gehen alle
-- Exports automatisch mit weg (auch die S3-ZIPs räumt der cleanup_tenant-
-- Worker weil sie unter t/<tenantId>/exports/ liegen).

CREATE TABLE "tenant_exports" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "source" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "triggeredByUserId" UUID,
  "triggeredBySuperAdminId" UUID,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "tenant_exports_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE
);
CREATE INDEX "tenant_exports_tenantId_createdAt_idx"
  ON "tenant_exports"("tenantId", "createdAt");
CREATE INDEX "tenant_exports_expiresAt_idx"
  ON "tenant_exports"("expiresAt");

CREATE TABLE "tenant_export_items" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "exportId" UUID NOT NULL,
  "galleryId" UUID,
  "gallerySlug" TEXT NOT NULL,
  "galleryName" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "storageKey" TEXT,
  "sizeBytes" BIGINT,
  "fileCount" INT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "tenant_export_items_exportId_fkey"
    FOREIGN KEY ("exportId") REFERENCES "tenant_exports"("id") ON DELETE CASCADE
);
CREATE INDEX "tenant_export_items_exportId_idx"
  ON "tenant_export_items"("exportId");

CREATE TABLE "export_tokens" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "exportId" UUID NOT NULL UNIQUE,
  "token" TEXT NOT NULL UNIQUE,
  "firstAccessAt" TIMESTAMP(3),
  "accessCount" INT NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "export_tokens_exportId_fkey"
    FOREIGN KEY ("exportId") REFERENCES "tenant_exports"("id") ON DELETE CASCADE
);
