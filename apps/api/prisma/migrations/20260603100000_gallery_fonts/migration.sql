-- =============================================================================
-- Galerie-Schriftarten
-- =============================================================================
-- Zwei nullable Felder pro Galerie:
--   fontHeading: kurze ID (z.B. "cormorant") aus kuratierter Liste,
--                gilt für h1/h2 im Customer-View.
--   fontBody:    kurze ID, gilt für Description/Body/UI.
--
-- Beide null → Branding-Schrift gewinnt.
-- VARCHAR(40) reicht für Font-IDs aus unserer Whitelist; das Frontend
-- mappt die ID auf einen vollen Font-Stack inkl. Fallback.

ALTER TABLE "galleries"
    ADD COLUMN "fontHeading" VARCHAR(40),
    ADD COLUMN "fontBody"    VARCHAR(40);
