-- Erscheinungsbild fuer Studio-Backend, Login-Seite und E-Mails auf
-- Tenant-Ebene (entkoppelt vom Galerie-Branding).
ALTER TABLE "tenants" ADD COLUMN "studioLogoKey" TEXT;
ALTER TABLE "tenants" ADD COLUMN "studioLogoLightKey" TEXT;
ALTER TABLE "tenants" ADD COLUMN "studioAccentColor" TEXT;
ALTER TABLE "tenants" ADD COLUMN "studioTheme" TEXT DEFAULT 'dark';
ALTER TABLE "tenants" ADD COLUMN "loginLogoKey" TEXT;
ALTER TABLE "tenants" ADD COLUMN "loginBackgroundKey" TEXT;
ALTER TABLE "tenants" ADD COLUMN "loginGreeting" TEXT;
ALTER TABLE "tenants" ADD COLUMN "loginAccentColor" TEXT;
ALTER TABLE "tenants" ADD COLUMN "emailLogoKey" TEXT;

-- Bestehende Login- und Akzent-Werte vom Tenant-Default-Branding
-- uebernehmen, damit Login-Seite und Studio-Akzent nach dem Entkoppeln
-- unveraendert aussehen (kein sichtbarer Bruch fuer bestehende Tenants).
UPDATE "tenants" t
SET "loginBackgroundKey" = b."loginBackgroundUrl",
    "loginGreeting"      = b."loginGreeting",
    "loginAccentColor"   = b."accentColor",
    "loginLogoKey"       = b."logoUrl",
    "studioAccentColor"  = b."accentColor"
FROM "brandings" b
WHERE t."brandingId" = b."id";
