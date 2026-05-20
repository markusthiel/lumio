-- =============================================================================
-- Header-Customization pro Galerie
-- =============================================================================
-- Bisher: Hero-Sektion war minimalistisch hardcoded. Studio konnte nur
-- den Galerie-Titel + Beschreibung kontrollieren.
-- Jetzt: Studio kann den Header individualisieren mit Hero-Bild
-- (Galerie-File ODER Upload), Overlay-Farbe, Hintergrund-Farbe als
-- Fallback, Event-Logo und Welcome-Markdown.

ALTER TABLE "galleries"
    ADD COLUMN "heroFileId"          UUID,
    ADD COLUMN "heroUrl"             TEXT,
    ADD COLUMN "heroOverlayColor"    VARCHAR(9),
    ADD COLUMN "heroBackgroundColor" VARCHAR(7),
    ADD COLUMN "eventLogoUrl"        TEXT,
    ADD COLUMN "welcomeMarkdown"     TEXT;

-- Kein FK auf heroFileId: wenn das File gelöscht wird, wollen wir die
-- Galerie nicht beschädigen — der Frontend-Fallback rendert dann den
-- Plain-Header. Hätte ein FK ON DELETE SET NULL gemacht, aber:
-- coverFileId ist im bestehenden Schema auch FK-los, also bleiben wir
-- konsistent zur Konvention.
