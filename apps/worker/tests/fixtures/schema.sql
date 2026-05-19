-- =============================================================================
-- Lumio Worker — Test-DB Schema
--
-- Minimaler Schema-Dump für die Integration-Tests. Enthält NUR die Tabellen,
-- die der Worker-Code anfasst (process_file, process_watermark, build_zip).
-- 
-- Bei Schema-Änderungen in apps/api/prisma/schema.prisma die relevanten
-- Felder hier nachpflegen. Diese Datei ist absichtlich dupliziert statt
-- aus dem Prisma-Schema generiert, damit Worker-Tests ohne Node.js laufen.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- Minimal stub für tenants
CREATE TABLE tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  "watermarkText"     TEXT,
  "watermarkImageKey" TEXT,
  "createdAt" TIMESTAMP(3) DEFAULT NOW(),
  "updatedAt" TIMESTAMP(3) DEFAULT NOW()
);

-- Minimal stub für users (nur damit ownerId-FK aufgehen würde — wir setzen
-- ihn aber nicht, deswegen reicht das hier)
CREATE TABLE users (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email     CITEXT NOT NULL,
  "tenantId" UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE galleries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId"    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  "ownerId"     UUID,
  slug          TEXT UNIQUE NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  mode          TEXT NOT NULL DEFAULT 'sharing',
  status        TEXT NOT NULL DEFAULT 'draft',
  "downloadEnabled"   BOOLEAN DEFAULT TRUE,
  "watermarkEnabled"  BOOLEAN DEFAULT FALSE,
  "commentsEnabled"   BOOLEAN DEFAULT TRUE,
  "ratingsEnabled"    BOOLEAN DEFAULT TRUE,
  "createdAt"   TIMESTAMP(3) DEFAULT NOW(),
  "updatedAt"   TIMESTAMP(3) DEFAULT NOW()
);

CREATE TABLE files (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "galleryId"   UUID NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  "originalFilename" TEXT NOT NULL,
  "storageKey"  TEXT NOT NULL,
  "mimeType"    TEXT NOT NULL,
  "sizeBytes"   BIGINT NOT NULL,
  kind          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  width         INTEGER,
  height        INTEGER,
  "errorMessage" TEXT,
  "sortIndex"   INTEGER DEFAULT 0,
  "takenAt"     TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) DEFAULT NOW(),
  "updatedAt"   TIMESTAMP(3) DEFAULT NOW()
);

CREATE TABLE renditions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "fileId"      UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  "storageKey"  TEXT NOT NULL,
  format        TEXT NOT NULL,
  width         INTEGER,
  height        INTEGER,
  "sizeBytes"   BIGINT,
  "createdAt"   TIMESTAMP(3) DEFAULT NOW(),
  UNIQUE ("fileId", kind)
);

-- ZIP-Downloads — für build_zip-Tests
CREATE TABLE zip_downloads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "galleryId" UUID NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  "accessId"  UUID,
  "fileIdsHash" TEXT,
  "fileCount"   INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  "storageKey"  TEXT,
  "sizeBytes"   BIGINT,
  "errorMessage" TEXT,
  "notifiedAt"  TIMESTAMP(3),
  "expiresAt"   TIMESTAMP(3) NOT NULL,
  "createdAt"   TIMESTAMP(3) DEFAULT NOW(),
  "updatedAt"   TIMESTAMP(3) DEFAULT NOW()
);
