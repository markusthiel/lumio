-- Anzeigegröße des Galerie-Logos im Kunden-Hero: small | medium | large.
-- Default "medium" (bisheriges Verhalten ~ mittlere Größe). Bestehende
-- Galerien bekommen automatisch "medium" — kein manueller Eingriff nötig.
ALTER TABLE "galleries" ADD COLUMN "eventLogoSize" TEXT NOT NULL DEFAULT 'medium';
