-- Login-spezifische Branding-Felder
--
-- loginBackgroundUrl: Hero-Bild für die Login-Seite (Multi-Mode mit
--   Tenant-Subdomain). Entweder ein S3-Key (wird signiert) oder eine
--   externe URL.
-- loginGreeting: Markdown-Begrüssungstext für die Login-Seite. Frei
--   wählbar vom Tenant — z.B. "Willkommen, Team Stefan Müller
--   Fotografie. Bitte logge dich mit deinen Zugangsdaten ein."
--
-- Beide Felder sind nullable; die Login-Page hat sinnvolle Defaults
-- wenn nichts gesetzt ist.
ALTER TABLE "brandings" ADD COLUMN "loginBackgroundUrl" TEXT;
ALTER TABLE "brandings" ADD COLUMN "loginGreeting" TEXT;
