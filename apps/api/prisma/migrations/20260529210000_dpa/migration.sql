-- Migration: dpa (Auftragsverarbeitungsvertrag, Art. 28 DSGVO)
--
-- 1. Stammdaten des Verantwortlichen am Tenant (fuer den generierten AVV).
--    Alle NULL-bar — Bestandstenants bleiben unberuehrt, fuellen die Daten
--    bei Bedarf im Studio aus.
-- 2. dpa_acceptances: dokumentierter elektronischer Abschluss. Art. 28
--    Abs. 9 DSGVO erlaubt das elektronische Format ausdruecklich.

ALTER TABLE "tenants" ADD COLUMN "legalName"       TEXT;
ALTER TABLE "tenants" ADD COLUMN "legalStreet"     TEXT;
ALTER TABLE "tenants" ADD COLUMN "legalPostalCode" TEXT;
ALTER TABLE "tenants" ADD COLUMN "legalCity"       TEXT;
ALTER TABLE "tenants" ADD COLUMN "legalCountry"    TEXT;
ALTER TABLE "tenants" ADD COLUMN "vatId"           TEXT;

CREATE TABLE "dpa_acceptances" (
    "id"               UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId"         UUID NOT NULL,
    "version"          TEXT NOT NULL,
    "acceptedByUserId" UUID,
    "acceptedByName"   TEXT,
    "ipAddress"        TEXT,
    "acceptedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dpa_acceptances_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dpa_acceptances_tenantId_idx"
    ON "dpa_acceptances" ("tenantId");

ALTER TABLE "dpa_acceptances" ADD CONSTRAINT "dpa_acceptances_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
