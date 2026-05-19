-- =============================================================================
-- Lumio — Migration: Gallery Templates
-- =============================================================================

CREATE TABLE "gallery_templates" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId"          UUID NOT NULL,
  "name"              TEXT NOT NULL,
  "description"       TEXT,
  "mode"              TEXT NOT NULL DEFAULT 'collaboration',
  "downloadEnabled"   BOOLEAN NOT NULL DEFAULT TRUE,
  "watermarkEnabled"  BOOLEAN NOT NULL DEFAULT FALSE,
  "commentsEnabled"   BOOLEAN NOT NULL DEFAULT TRUE,
  "ratingsEnabled"    BOOLEAN NOT NULL DEFAULT TRUE,
  "defaultExpiryDays" INTEGER,
  "defaultDescription" TEXT,
  "brandingId"        UUID,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "gallery_templates_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "gallery_templates_brandingId_fkey"
    FOREIGN KEY ("brandingId") REFERENCES "brandings"("id") ON DELETE SET NULL
);

CREATE INDEX "gallery_templates_tenantId_idx" ON "gallery_templates" ("tenantId");
