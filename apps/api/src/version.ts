/**
 * Lumio — Produkt-Version.
 *
 * Single Source of Truth ist die Datei /VERSION im Repo-Root.
 * Diese Konstante wird von scripts/bump-version.sh synchron gehalten —
 * NICHT von Hand editieren, sondern den Bump-Script benutzen.
 *
 * Eine gesetzte ENV LUMIO_VERSION übersteuert den eingebauten Wert
 * (z.B. wenn ein CI-Build das Image mit einem anderen Tag stempeln will).
 */
const BUILTIN_VERSION = "0.17.0";

export const LUMIO_VERSION =
  process.env.LUMIO_VERSION?.trim() || BUILTIN_VERSION;
