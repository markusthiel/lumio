-- Mail-Layout auf zwei Achsen umstellen: Logo-Position + Kopf-Stil.
ALTER TABLE "tenants" ADD COLUMN "mailLogoPosition" TEXT DEFAULT 'left';
ALTER TABLE "tenants" ADD COLUMN "mailHeaderStyle" TEXT DEFAULT 'line';

-- Bisherige Einzel-Variante (mailLayout) auf die zwei Achsen migrieren:
--   classic    -> left   / line
--   logo_right -> right  / line
--   centered   -> center / line
--   banner     -> center / banner
UPDATE "tenants" SET
  "mailLogoPosition" = CASE "mailLayout"
    WHEN 'logo_right' THEN 'right'
    WHEN 'centered'   THEN 'center'
    WHEN 'banner'     THEN 'center'
    ELSE 'left'
  END,
  "mailHeaderStyle" = CASE WHEN "mailLayout" = 'banner' THEN 'banner' ELSE 'line' END
WHERE "mailLayout" IS NOT NULL;

ALTER TABLE "tenants" DROP COLUMN "mailLayout";
