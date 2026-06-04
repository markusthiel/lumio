-- Zielsteuerung für System-Announcements (Banner): pro User / pro Tenant.
ALTER TABLE "system_announcements" ADD COLUMN "targetUserId" UUID;
ALTER TABLE "system_announcements" ADD COLUMN "targetTenantId" UUID;

CREATE INDEX "system_announcements_targetUserId_idx" ON "system_announcements"("targetUserId");
CREATE INDEX "system_announcements_targetTenantId_idx" ON "system_announcements"("targetTenantId");
