-- =============================================================================
-- Galerie-Footer + Galerie-spezifische Farben
-- =============================================================================
-- footerMarkdown: Dankeschön / Kontakt / Socials am Ende der Customer-
--   Seite. Wenn null, fällt der Customer-View zurück auf den
--   Tenant-Branding-Footer.
--
-- colorBackground / colorAccent: zwei Slots, mit denen das Studio die
--   Galerie-Optik vom Tenant-Branding abweichen lassen kann.
--   Hex #RRGGBB. Default null → Branding-Werte gewinnen.

ALTER TABLE "galleries"
    ADD COLUMN "footerMarkdown"   TEXT,
    ADD COLUMN "colorBackground"  VARCHAR(7),
    ADD COLUMN "colorAccent"      VARCHAR(7);
