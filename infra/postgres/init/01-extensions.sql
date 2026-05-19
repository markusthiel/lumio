-- =============================================================================
-- Lumio — Postgres Extensions
-- =============================================================================
-- Wird beim ersten Start automatisch ausgeführt (docker-entrypoint-initdb.d).

-- UUIDs nativ
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Volltextsuche / Trigram-Suche für Datei-/Galerienamen
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Case-insensitive Text (für E-Mail-Felder)
CREATE EXTENSION IF NOT EXISTS "citext";
