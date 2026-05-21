-- Smart Collections — gespeicherte Filter-Macros über die Galerien-Liste.
-- Filter-JSON: siehe apps/api/src/services/smart-collection-filter.ts

CREATE TABLE smart_collections (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId"  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  "ownerId"   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  icon        TEXT,
  filter      JSONB NOT NULL DEFAULT '{}'::jsonb,
  "sortOrder" INT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE INDEX "smart_collections_tenantId_ownerId_idx"
  ON smart_collections("tenantId", "ownerId");
