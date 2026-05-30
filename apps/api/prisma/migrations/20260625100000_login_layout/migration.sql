-- Login-Layout-Variante (minimal | splash | side_by_side | centered).
ALTER TABLE "tenants" ADD COLUMN "loginLayout" TEXT DEFAULT 'centered';

-- Bestehende Tenants mit Hintergrundbild bekommen das Split-Layout,
-- das ihrem bisherigen automatischen "Hero"-Login am naechsten kommt.
UPDATE "tenants" SET "loginLayout" = 'side_by_side'
WHERE "loginBackgroundKey" IS NOT NULL;
