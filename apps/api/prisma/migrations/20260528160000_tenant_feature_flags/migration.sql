CREATE TABLE "tenant_feature_flags" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "flagKey" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL,
  "setById" UUID NOT NULL,
  "setByEmail" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_feature_flags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_feature_flags_tenantId_flagKey_key"
  ON "tenant_feature_flags"("tenantId", "flagKey");
CREATE INDEX "tenant_feature_flags_flagKey_idx"
  ON "tenant_feature_flags"("flagKey");

ALTER TABLE "tenant_feature_flags" ADD CONSTRAINT "tenant_feature_flags_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
