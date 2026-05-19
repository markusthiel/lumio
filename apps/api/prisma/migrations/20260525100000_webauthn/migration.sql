-- Lumio: WebAuthn-Credentials
--
-- Pro User können mehrere Passkeys registriert werden (z.B. Mac + Phone +
-- YubiKey). credentialId ist global eindeutig (RFC 8809 garantiert das),
-- aber wir indexen es zusätzlich, weil der Login-Pfad nur diesen Wert hat.

CREATE TABLE webauthn_credentials (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "credentialId"  TEXT NOT NULL UNIQUE,        -- base64url-encoded
  "publicKey"     BYTEA NOT NULL,              -- COSE public key
  "signCount"     BIGINT NOT NULL DEFAULT 0,   -- replay counter
  transports      TEXT,                        -- JSON-array von 'usb'|'nfc'|...
  label           TEXT NOT NULL,               -- "Mein MacBook", "YubiKey #1"
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "lastUsedAt"    TIMESTAMPTZ
);

CREATE INDEX webauthn_credentials_user_idx ON webauthn_credentials("userId");
