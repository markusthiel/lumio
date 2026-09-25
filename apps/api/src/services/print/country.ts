/**
 * Lumio API — a country code from the free-text country in a studio's legal
 * details ("Italia", "Deutschland", "AT"…). Used only to pick the default
 * country of the checkout's address fields, so an unrecognised name simply
 * means "no default".
 */

/** The countries a name is looked up among: the EU-27 plus Norway, Iceland,
 *  Liechtenstein, Switzerland and the UK. */
const EUROPEAN_COUNTRIES = [
  "AT", "BE", "BG", "CH", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GB",
  "GR", "HR", "HU", "IE", "IS", "IT", "LI", "LT", "LU", "LV", "MT", "NL", "NO",
  "PL", "PT", "RO", "SE", "SI", "SK",
] as const;

// Locales tried when reading a country name. Enough for the usual spellings
// of these countries; anything not recognised just stays unresolved.
const NAME_LOCALES = [
  "en", "de", "it", "fr", "es", "pt", "nl", "pl", "cs", "sv", "da", "fi",
];

// Spellings the locale data does not carry.
const NAME_ALIASES: Record<string, string> = {
  "czech republic": "CZ",
  holland: "NL",
  uk: "GB",
  "great britain": "GB",
};

let nameIndex: Map<string, string> | null = null;

function buildNameIndex(): Map<string, string> {
  const index = new Map<string, string>();
  for (const locale of NAME_LOCALES) {
    let names: Intl.DisplayNames;
    try {
      names = new Intl.DisplayNames([locale], { type: "region" });
    } catch {
      continue;
    }
    for (const code of EUROPEAN_COUNTRIES) {
      const name = names.of(code);
      if (name && name !== code) index.set(name.toLowerCase(), code);
    }
  }
  return index;
}

export function inferCountryFromName(
  name: string | null | undefined
): string | null {
  const text = name?.trim().toLowerCase();
  if (!text) return null;
  const asCode = text.toUpperCase();
  if ((EUROPEAN_COUNTRIES as readonly string[]).includes(asCode)) return asCode;
  if (NAME_ALIASES[text]) return NAME_ALIASES[text];
  nameIndex ??= buildNameIndex();
  return nameIndex.get(text) ?? null;
}
