-- Lumio: API-Tokens für Plugins und CLI-Zugriff
--
-- tokenHash speichert SHA-256(token) hex; den Plain-Token zeigen wir
-- dem User nur einmal beim Erstellen an. scopes ist ein JSON-Array von
-- Strings ("read", "write", ...) — derzeit nur "plugin", später erweiterbar.

CREATE TABLE api_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,                -- "Lightroom @ Studio-Mac"
  "tokenHash"  TEXT NOT NULL UNIQUE,         -- sha256 hex
  scopes       TEXT NOT NULL DEFAULT '["plugin"]',
  "lastUsedAt" TIMESTAMPTZ,
  "expiresAt"  TIMESTAMPTZ,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX api_tokens_user_idx ON api_tokens("userId");
CREATE INDEX api_tokens_expires_idx ON api_tokens("expiresAt") WHERE "expiresAt" IS NOT NULL;
