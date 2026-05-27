-- Session: optionales Tagging einer Impersonate-Session durch einen
-- Super-Admin. Wenn gesetzt, ist diese Session eine Support-Session
-- mit kuerzerer TTL und Banner im Studio.

ALTER TABLE "sessions"
  ADD COLUMN "impersonatedBySuperAdminId" UUID;
