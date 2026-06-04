-- CSP-Verstoesse, aggregiert nach (effectiveDirective, blockedUri).
CREATE TABLE "csp_violations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "effectiveDirective" TEXT NOT NULL,
    "blockedUri" TEXT NOT NULL,
    "sampleDocumentUri" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "csp_violations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "csp_violations_effectiveDirective_blockedUri_key" ON "csp_violations"("effectiveDirective", "blockedUri");

CREATE INDEX "csp_violations_lastSeenAt_idx" ON "csp_violations"("lastSeenAt");
