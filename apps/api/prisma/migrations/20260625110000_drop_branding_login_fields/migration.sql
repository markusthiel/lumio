-- Login-Branding ist auf die Tenant-Ebene gewandert (Studio & Login).
-- Die alten Spalten am Galerie-Branding werden nicht mehr genutzt; ihre
-- Werte wurden bereits in der Migration 20260625090000_tenant_appearance
-- auf den Tenant uebernommen.
ALTER TABLE "brandings" DROP COLUMN IF EXISTS "loginBackgroundUrl";
ALTER TABLE "brandings" DROP COLUMN IF EXISTS "loginGreeting";
