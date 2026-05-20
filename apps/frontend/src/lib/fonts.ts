/**
 * Kuratierter Font-Katalog für Galerie-Personalisierung.
 *
 * Acht Schriften sind die richtige Anzahl: groß genug für echte Wahl,
 * klein genug dass jede einzeln gepflegt werden kann und dass das CSS
 * für die @font-face nicht ausartet. Vier Sans, vier Serif —
 * abgedeckt sind die typischen Foto-Studio-Stile (Hochzeit serif,
 * Newborn neutral sans, Editorial mixed).
 *
 * Loading-Strategie:
 *   - Wir laden Fonts NICHT eager im _document — nur die tatsächlich
 *     von einer Galerie benutzten kommen ins Layout, via dynamisch
 *     gerendertem <link>-Tag im Server-Layout der /g/[slug]-Route.
 *     Das heißt: customer browser holt höchstens zwei Fonts (heading +
 *     body) und nicht den ganzen Katalog.
 *   - CDN: fonts.bunny.net. DSGVO-konformer drop-in Replacement für
 *     Google-Fonts ohne IP-Logging. Slowenischer Anbieter, EU-Server.
 *     Wenn das später nicht mehr ausreicht (z.B. weil Bunny ausfällt
 *     oder die Latenz zu schlecht wird), kann die `cssUrl`-Funktion
 *     in dieser Datei auf `/fonts/...woff2` umgestellt werden und
 *     ein Skript holt die woff2s ins Public-Verzeichnis.
 *
 * Hinzufügen einer neuen Schrift:
 *   1. Eintrag hier mit ID, label, family, fallback-stack
 *   2. Prüfen ob bei fonts.bunny.net unter diesem Namen verfügbar
 *   3. Optional: ein Beispieltext für den Studio-Picker
 */

export interface FontOption {
  /** Stabile ID, wird in der DB gespeichert. Kebab-Case. */
  id: string;
  /** Anzeigename für den Studio-Picker. */
  label: string;
  /** Anzeige-Kategorie (sans/serif/display). Reine UI-Information. */
  category: "sans" | "serif" | "display";
  /** Voller CSS-font-family-Stack inkl. Fallbacks. Wird im Customer-
   *  View direkt verwendet. */
  stack: string;
  /** Name wie bei fonts.bunny.net (URL-Pfad-Segment). */
  bunnyName: string;
  /** Gewichte, die geladen werden sollen. */
  weights: number[];
}

export const FONT_OPTIONS: FontOption[] = [
  // ---------------------------------------------------------------------------
  // SANS
  // ---------------------------------------------------------------------------
  {
    id: "inter",
    label: "Inter",
    category: "sans",
    stack:
      '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    bunnyName: "inter",
    weights: [400, 500, 700],
  },
  {
    id: "dm-sans",
    label: "DM Sans",
    category: "sans",
    stack: '"DM Sans", system-ui, sans-serif',
    bunnyName: "dm-sans",
    weights: [400, 500, 700],
  },
  {
    id: "outfit",
    label: "Outfit",
    category: "sans",
    stack: '"Outfit", system-ui, sans-serif',
    bunnyName: "outfit",
    weights: [400, 500, 700],
  },
  {
    id: "manrope",
    label: "Manrope",
    category: "sans",
    stack: '"Manrope", system-ui, sans-serif',
    bunnyName: "manrope",
    weights: [400, 500, 700],
  },

  // ---------------------------------------------------------------------------
  // SERIF — die Hochzeits-/Editorial-Liga
  // ---------------------------------------------------------------------------
  {
    id: "cormorant",
    label: "Cormorant Garamond",
    category: "serif",
    stack:
      '"Cormorant Garamond", Georgia, "Times New Roman", serif',
    bunnyName: "cormorant-garamond",
    weights: [400, 500, 700],
  },
  {
    id: "playfair",
    label: "Playfair Display",
    category: "serif",
    stack: '"Playfair Display", Georgia, serif',
    bunnyName: "playfair-display",
    weights: [400, 500, 700],
  },
  {
    id: "fraunces",
    label: "Fraunces",
    category: "serif",
    stack: '"Fraunces", Georgia, serif',
    bunnyName: "fraunces",
    weights: [400, 500, 700],
  },
  {
    id: "lora",
    label: "Lora",
    category: "serif",
    stack: '"Lora", Georgia, serif',
    bunnyName: "lora",
    weights: [400, 500, 700],
  },
];

const FONT_MAP = new Map(FONT_OPTIONS.map((f) => [f.id, f]));

/** Sicher: gibt undefined zurück für IDs, die nicht im Katalog stehen
 *  (z.B. nach einem späteren Katalog-Refactor mit gelöschten Einträgen). */
export function lookupFont(id: string | null | undefined): FontOption | undefined {
  if (!id) return undefined;
  return FONT_MAP.get(id);
}

/**
 * Baut die fonts.bunny.net CSS-URL für eine Liste von Font-IDs. Die
 * Bunny-API ist Google-Fonts-kompatibel:
 *
 *   https://fonts.bunny.net/css?family=Family+Name:wght@400;500;700|...
 *
 * Wir liefern nur die Fonts aus, die tatsächlich verwendet werden —
 * also Heading + Body der aktuellen Galerie, dedupliziert.
 *
 * Returns null wenn keine Font-IDs übergeben wurden oder alle
 * unbekannt sind (dann muss kein <link> gerendert werden).
 */
export function bunnyFontsCssUrl(
  ids: ReadonlyArray<string | null | undefined>
): string | null {
  const seen = new Set<string>();
  const families: string[] = [];
  for (const id of ids) {
    const f = lookupFont(id);
    if (!f) continue;
    if (seen.has(f.bunnyName)) continue;
    seen.add(f.bunnyName);
    // Family-Name URL-encoded; Bunny erwartet "+" als Trenner statt %20,
    // genau wie Google Fonts.
    const familyParam = f.bunnyName.replace(/-/g, "-"); // already kebab
    families.push(
      `${familyParam}:wght@${f.weights.join(";")}`
    );
  }
  if (families.length === 0) return null;
  // Format: ?family=A:wght@400|B:wght@400;700
  const query = families.join("|");
  return `https://fonts.bunny.net/css?family=${query}&display=swap`;
}

/**
 * Ermittelt den effektiven Font-Stack:
 *   1. Galerie-Override (falls gesetzt + ID gültig)
 *   2. Branding-Font (frei eintragbarer Studio-Font, kommt aus
 *      Branding.fontFamily — wir wrappen das, falls vorhanden)
 *   3. System-Sans als Default
 */
export function resolveFontStack(
  galleryFontId: string | null | undefined,
  brandingFontFamily?: string | null
): string {
  const fromGallery = lookupFont(galleryFontId);
  if (fromGallery) return fromGallery.stack;
  if (brandingFontFamily) {
    return `"${brandingFontFamily}", system-ui, sans-serif`;
  }
  return 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
}
