-- Sprint-1-Erweiterungen für Plan-Enforcement.
--
-- 1) BillingSubscription kriegt zwei neue Spalten:
--      storageAddonGib    — Anzahl 50-GiB-Packs die der Tenant zugekauft hat
--      readOnlySince      — wann der Tenant nach Karenz auf read-only ging
--    Beide werden in Sprint 2 von der Stripe-Webhook-Logik gesetzt;
--    für Sprint 1 fügen wir sie mit Defaults hinzu, damit die Migration
--    bestehende Daten nicht stört.
--
-- 2) Default BillingPlan-Daten einfügen (solo/studio/pro). Die Stripe-
--    Price-IDs bleiben leer — werden in Sprint 2 nach Anlegen der
--    Produkte im Stripe-Dashboard nachgetragen.
--
-- 3) Bestehende Tenants kriegen eine 'pro'-Subscription mit Status
--    'active' und sind damit voll funktionsfähig — wir wollen
--    Live-Tenants nicht plötzlich an Limits stoßen lassen.

ALTER TABLE billing_subscriptions
  ADD COLUMN IF NOT EXISTS "storageAddonGib" INT NOT NULL DEFAULT 0;

ALTER TABLE billing_subscriptions
  ADD COLUMN IF NOT EXISTS "readOnlySince" TIMESTAMP(3);

-- Plan-Seed-Daten. ON CONFLICT-Schutz für den Fall dass die Migration
-- versehentlich zweimal läuft (z.B. nach Restore aus Backup).
INSERT INTO billing_plans
  (id, slug, name, description,
   "storageGib", "galleriesMax", "filesPerGallery", "usersMax",
   "customDomain", "whiteLabel", "watermarking", "analytics",
   "priceMonthlyCents", "priceYearlyCents", currency,
   "isActive", "sortOrder",
   "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'solo',   'Solo',
   'Für Hobby- und Nebenberufs-Fotografen',
   50,   10,  NULL, 1,
   false, false, false, false,
   1900,  19000, 'EUR',
   true,  10,  NOW(), NOW()),
  (gen_random_uuid(), 'studio', 'Studio',
   'Für hauptberufliche Fotografen',
   250,  50,  NULL, 1,
   true,  true,  true,  true,
   3900,  39000, 'EUR',
   true,  20,  NOW(), NOW()),
  (gen_random_uuid(), 'pro',    'Pro',
   'Für Studios mit Mitarbeitern und mehreren Marken',
   1000, NULL, NULL, 3,
   true,  true,  true,  true,
   8900,  89000, 'EUR',
   true,  30,  NOW(), NOW())
ON CONFLICT (slug) DO NOTHING;

-- Existierende Tenants auf "pro"-Plan setzen. Wir gehen davon aus,
-- dass das wenige Test-/Dev-Tenants sind. Wenn schon eine Subscription
-- existiert, lassen wir sie unverändert.
INSERT INTO billing_subscriptions
  (id, "tenantId", "planId", status, "billingInterval",
   "storageBytesUsed", "bandwidthBytesUsed", "galleriesCount",
   "storageAddonGib",
   "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  t.id,
  (SELECT id FROM billing_plans WHERE slug = 'pro' LIMIT 1),
  'active',
  'monthly',
  0, 0, 0,
  0,
  NOW(), NOW()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM billing_subscriptions s WHERE s."tenantId" = t.id
);

-- Initial-Backfill für storageBytesUsed und galleriesCount basierend auf
-- aktuellen Files/Galleries. Sprint-1-Code pflegt diese Werte ab jetzt
-- inkrementell, aber für Existing-Tenants brauchen wir einen Startwert.
--
-- Storage = SUM aller files.sizeBytes + SUM aller renditions.sizeBytes
-- pro Tenant. Filtert auf status != 'deleted' damit gelöschte Files
-- (die noch in der Tabelle stehen könnten) nicht zählen.
UPDATE billing_subscriptions s
SET "storageBytesUsed" = COALESCE((
  SELECT
    COALESCE(SUM(f."sizeBytes"), 0)
    + COALESCE((
        SELECT SUM(r."sizeBytes")
        FROM renditions r
        JOIN files f2 ON f2.id = r."fileId"
        JOIN galleries g2 ON g2.id = f2."galleryId"
        WHERE g2."tenantId" = s."tenantId"
      ), 0)
  FROM files f
  JOIN galleries g ON g.id = f."galleryId"
  WHERE g."tenantId" = s."tenantId"
), 0),
"galleriesCount" = COALESCE((
  SELECT COUNT(*) FROM galleries g
  WHERE g."tenantId" = s."tenantId" AND g.status != 'archived'
), 0),
"updatedAt" = NOW();
