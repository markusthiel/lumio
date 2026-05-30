-- Layout-Variante für Studio-gebrandete Mails (an Endkunden).
-- classic | logo_right | centered | banner. Default classic.
ALTER TABLE "tenants" ADD COLUMN "mailLayout" TEXT DEFAULT 'classic';
