-- Tenant-Notes: interne Stichpunkte des Super-Admin pro Tenant. NIE im
-- Studio sichtbar, nur im Super-Admin-Bereich.

CREATE TABLE "tenant_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" UUID NOT NULL,
    "authorEmail" TEXT NOT NULL,
    "authorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tenant_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tenant_notes_tenantId_createdAt_idx"
  ON "tenant_notes"("tenantId", "createdAt" DESC);

ALTER TABLE "tenant_notes" ADD CONSTRAINT "tenant_notes_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
