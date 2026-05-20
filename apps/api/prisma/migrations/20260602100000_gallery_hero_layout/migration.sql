-- =============================================================================
-- Hero-Layout-Variante pro Galerie
-- =============================================================================
-- Vier Render-Varianten für den Customer-Header:
--   - minimal       — bestehender Default, kompakter Text-Block
--   - splash        — Vollbild-Hero, zentriert
--   - side_by_side  — Editorial, Text links + Bild rechts
--   - centered      — Magazin, Logo+Titel zentriert, Hero darunter
--
-- Default 'minimal' damit existierende Galerien sich nicht ändern.
-- Pro Variante bleiben die existierenden Felder (heroFileId/heroUrl,
-- eventLogoUrl, welcomeMarkdown, heroOverlayColor, heroBackgroundColor)
-- gleich — nur die Anordnung im Frontend ändert sich.

ALTER TABLE "galleries"
    ADD COLUMN "heroLayout" TEXT NOT NULL DEFAULT 'minimal';
