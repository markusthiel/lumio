-- =============================================================================
-- Super-Admin & Tenant-Verwaltung
-- =============================================================================
-- super_admins: Plattform-Operatoren, getrennt von Tenant-Usern.
-- password_reset_tokens: für initiales Passwort-Setup von neu angelegten
-- Tenant-Ownern (und später "Passwort vergessen").

CREATE TABLE "super_admins" (
    "id"            UUID         NOT NULL DEFAULT gen_random_uuid(),
    "email"         TEXT         NOT NULL,
    "passwordHash"  TEXT         NOT NULL,
    "displayName"   TEXT         NOT NULL,
    "lastLoginAt"   TIMESTAMP(3),
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "super_admins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "super_admins_email_key" ON "super_admins"("email");

CREATE TABLE "password_reset_tokens" (
    "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
    "userId"     UUID         NOT NULL,
    "tokenHash"  TEXT         NOT NULL,
    "kind"       TEXT         NOT NULL DEFAULT 'setup',
    "expiresAt"  TIMESTAMP(3) NOT NULL,
    "usedAt"     TIMESTAMP(3),
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key"
    ON "password_reset_tokens"("tokenHash");
CREATE INDEX "password_reset_tokens_userId_kind_idx"
    ON "password_reset_tokens"("userId", "kind");
CREATE INDEX "password_reset_tokens_expiresAt_idx"
    ON "password_reset_tokens"("expiresAt");

ALTER TABLE "password_reset_tokens"
    ADD CONSTRAINT "password_reset_tokens_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "super_admin_sessions" (
    "id"            UUID         NOT NULL DEFAULT gen_random_uuid(),
    "superAdminId"  UUID         NOT NULL,
    "tokenHash"     TEXT         NOT NULL,
    "ipAddress"     TEXT,
    "userAgent"     TEXT,
    "expiresAt"     TIMESTAMP(3) NOT NULL,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "super_admin_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "super_admin_sessions_tokenHash_key"
    ON "super_admin_sessions"("tokenHash");
CREATE INDEX "super_admin_sessions_superAdminId_idx"
    ON "super_admin_sessions"("superAdminId");
CREATE INDEX "super_admin_sessions_expiresAt_idx"
    ON "super_admin_sessions"("expiresAt");

ALTER TABLE "super_admin_sessions"
    ADD CONSTRAINT "super_admin_sessions_superAdminId_fkey"
    FOREIGN KEY ("superAdminId") REFERENCES "super_admins"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- events.tenantId wird nullable, damit Super-Admin-Aktionen ohne
-- Tenant-Bezug (Login/Logout) auch geloggt werden können.
ALTER TABLE "events"
    ALTER COLUMN "tenantId" DROP NOT NULL;
