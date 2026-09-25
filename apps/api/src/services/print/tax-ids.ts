/**
 * Lumio API — tax identifier validators
 *
 * Pure format / check-digit checks for the identifiers an invoice can need:
 * national tax codes (codice fiscale, NIF, OIB…), company numbers (SIREN…)
 * and VAT numbers. Deliberately free of Prisma/Fastify so it is directly
 * unit-testable (same pattern as pricing-tiers.ts).
 *
 * A check digit is verified only where the algorithm is published and could
 * be cross-checked against known-valid numbers (IT, FR, ES, PT, PL, BE, HR).
 * Everywhere else only the FORMAT is verified. These are algorithms, not
 * legal requirements — which identifiers a studio asks for, and whether they
 * are mandatory, is the studio's own setting (invoice-settings.ts). Nothing here asks a tax
 * authority whether the number exists — no VIES / Agenzia delle Entrate /
 * INSEE lookup.
 */

/** Strip whitespace, uppercase — the form a tax code is stored and checked in. */
export function normalizeTaxCode(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

/** Like normalizeTaxCode, and also without the usual separators
 *  ("IT 123.456.789-01" -> "IT12345678901"). */
export function normalizeVatNumber(raw: string): string {
  return raw.replace(/[\s.\-/]+/g, "").toUpperCase();
}

// -----------------------------------------------------------------------------
// Italy — codice fiscale (persona fisica, 16 characters)
// -----------------------------------------------------------------------------

// Value of a character at an odd (1-based: 1st, 3rd, ... 15th) position of
// the check sum.
const CF_ODD: Record<string, number> = {
  "0": 1, "1": 0, "2": 5, "3": 7, "4": 9, "5": 13, "6": 15, "7": 17, "8": 19, "9": 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21,
  K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14,
  U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
};

// Positions 6, 7, 9, 10, 12, 13, 14 are digits — with omocodia the letters
// LMNPQRSTUV may stand in for them.
const CF_PATTERN = /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/;

/** A valid 16-character Italian codice fiscale, check character included.
 *  Expects input already normalised with normalizeTaxCode. */
export function isValidItalianPersonalTaxCode(code: string): boolean {
  if (!CF_PATTERN.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const ch = code[i];
    if (i % 2 === 0) {
      // odd position (1-based)
      sum += CF_ODD[ch];
    } else {
      // even position: digit = its value, letter = alphabet index (A=0)
      sum += /[0-9]/.test(ch) ? Number(ch) : ch.charCodeAt(0) - 65;
    }
  }
  return String.fromCharCode(65 + (sum % 26)) === code[15];
}

/** 11-digit number with a Luhn-variant check digit — used by the Italian
 *  Partita IVA and by the codice fiscale of legal entities. */
export function isValidItalianElevenDigits(code: string): boolean {
  if (!/^\d{11}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let d = Number(code[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10 === Number(code[10]);
}

// -----------------------------------------------------------------------------
// France — SIREN / SIRET
// -----------------------------------------------------------------------------

function luhnValid(code: string): boolean {
  let sum = 0;
  for (let i = 0; i < code.length; i++) {
    let d = Number(code[code.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** SIREN (9 digits, Luhn). A SIRET (14 digits) is accepted too, judged by
 *  its first nine digits — La Poste's SIRETs famously fail the SIRET Luhn
 *  check, the SIREN part is what the invoice needs. */
export function isValidSiren(code: string): boolean {
  if (/^\d{9}$/.test(code)) return luhnValid(code);
  if (/^\d{14}$/.test(code)) return luhnValid(code.slice(0, 9));
  return false;
}

// -----------------------------------------------------------------------------
// Spain — NIF (DNI / NIE / CIF)
// -----------------------------------------------------------------------------

const ES_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

/** DNI (8 digits + letter) or NIE (X/Y/Z + 7 digits + letter). */
export function isValidSpanishPersonalId(code: string): boolean {
  const dni = code.match(/^(\d{8})([A-Z])$/);
  if (dni) return ES_LETTERS[Number(dni[1]) % 23] === dni[2];
  const nie = code.match(/^([XYZ])(\d{7})([A-Z])$/);
  if (nie) {
    const n = Number(`${"XYZ".indexOf(nie[1])}${nie[2]}`);
    return ES_LETTERS[n % 23] === nie[3];
  }
  return false;
}

/** CIF of a legal entity: organisation letter + 7 digits + control, which
 *  is a digit or a letter depending on the organisation type — both forms
 *  are accepted. */
export function isValidSpanishCif(code: string): boolean {
  const m = code.match(/^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/);
  if (!m) return false;
  const d = m[2];
  let even = 0;
  let odd = 0;
  for (let i = 0; i < 7; i++) {
    const n = Number(d[i]);
    if (i % 2 === 1) {
      even += n;
    } else {
      const x = n * 2;
      odd += Math.floor(x / 10) + (x % 10);
    }
  }
  const control = (10 - ((even + odd) % 10)) % 10;
  return m[3] === String(control) || m[3] === "JABCDEFGHI"[control];
}

export const isValidSpanishNif = (code: string) =>
  isValidSpanishPersonalId(code) || isValidSpanishCif(code);

// -----------------------------------------------------------------------------
// Portugal — NIF
// -----------------------------------------------------------------------------

export function isValidPortugueseNif(code: string): boolean {
  if (!/^\d{9}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(code[i]) * (9 - i);
  const check = 11 - (sum % 11);
  return (check >= 10 ? 0 : check) === Number(code[8]);
}

// -----------------------------------------------------------------------------
// Poland — NIP
// -----------------------------------------------------------------------------

export function isValidPolishNip(code: string): boolean {
  if (!/^\d{10}$/.test(code)) return false;
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(code[i]) * weights[i];
  const check = sum % 11;
  return check !== 10 && check === Number(code[9]);
}

// -----------------------------------------------------------------------------
// Belgium — enterprise / VAT number
// -----------------------------------------------------------------------------

/** 10 digits (starting 0 or 1); the last two are 97 - (first eight mod 97). */
export function isValidBelgianEnterpriseNumber(code: string): boolean {
  if (!/^[01]\d{9}$/.test(code)) return false;
  return 97 - (Number(code.slice(0, 8)) % 97) === Number(code.slice(8));
}

// -----------------------------------------------------------------------------
// Croatia — OIB (ISO 7064, MOD 11,10)
// -----------------------------------------------------------------------------

export function isValidCroatianOib(code: string): boolean {
  if (!/^\d{11}$/.test(code)) return false;
  let a = 10;
  for (let i = 0; i < 10; i++) {
    a = (a + Number(code[i])) % 10;
    if (a === 0) a = 10;
    a = (a * 2) % 11;
  }
  const control = 11 - a;
  return (control === 10 ? 0 : control) === Number(code[10]);
}

// -----------------------------------------------------------------------------
// Generic fallbacks
// -----------------------------------------------------------------------------

/** A plausible tax id / company number of any country: 4-30 letters, digits
 *  and the usual separators, starting and ending alphanumeric. */
export function isPlausibleTaxId(normalized: string): boolean {
  return /^[A-Z0-9][A-Z0-9\-./]{2,28}[A-Z0-9]$/.test(normalized);
}

// -----------------------------------------------------------------------------
// VAT numbers
// -----------------------------------------------------------------------------

/** Format of a VAT number including its prefix, per country as VIES lists
 *  them (Greece is EL there, GR elsewhere — see vatPrefixFor). Norway,
 *  Iceland, Liechtenstein, Switzerland and the UK are not (all) in VIES but
 *  have well-known formats. */
const VAT_PATTERNS: Record<string, RegExp> = {
  AT: /^ATU\d{8}$/,
  BE: /^BE[01]\d{9}$/,
  BG: /^BG\d{9,10}$/,
  CY: /^CY\d{8}[A-Z]$/,
  CZ: /^CZ\d{8,10}$/,
  DE: /^DE\d{9}$/,
  DK: /^DK\d{8}$/,
  EE: /^EE\d{9}$/,
  EL: /^EL\d{9}$/,
  ES: /^ES[A-Z0-9]\d{7}[A-Z0-9]$/,
  FI: /^FI\d{8}$/,
  FR: /^FR[A-Z0-9]{2}\d{9}$/,
  HR: /^HR\d{11}$/,
  HU: /^HU\d{8}$/,
  IE: /^IE(\d{7}[A-Z]{1,2}|\d[A-Z+*]\d{5}[A-Z])$/,
  IT: /^IT\d{11}$/,
  LT: /^LT(\d{9}|\d{12})$/,
  LU: /^LU\d{8}$/,
  LV: /^LV\d{11}$/,
  MT: /^MT\d{8}$/,
  NL: /^NL\d{9}B\d{2}$/,
  PL: /^PL\d{10}$/,
  PT: /^PT\d{9}$/,
  RO: /^RO\d{2,10}$/,
  SE: /^SE\d{12}$/,
  SI: /^SI\d{8}$/,
  SK: /^SK\d{10}$/,
  // Outside the EU VAT area
  CH: /^CHE\d{9}(MWST|TVA|IVA|TPV)?$/,
  GB: /^GB(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/,
  IS: /^IS\d{5,6}$/,
  LI: /^LI\d{5}$/,
  NO: /^NO\d{9}(MVA)?$/,
};

/** The prefix a country's VAT numbers carry (Greece: EL; Switzerland: CHE). */
export function vatPrefixFor(country: string): string {
  const c = country.toUpperCase();
  if (c === "GR") return "EL";
  if (c === "CH") return "CHE";
  return c;
}

/** Country prefix -> key into VAT_PATTERNS, or null when the string does not
 *  start with a known prefix. */
function knownVatPrefix(normalized: string): string | null {
  if (normalized.startsWith("CHE")) return "CH";
  const two = normalized.slice(0, 2);
  if (two === "GR") return "EL"; // some people write GR for Greece
  return VAT_PATTERNS[two] ? two : null;
}

/** Check digit of the identifier inside a VAT number, for the countries
 *  where one is verified. `body` is the number without its prefix. */
function vatBodyChecksum(country: string, body: string): boolean {
  switch (country) {
    case "IT":
      return isValidItalianElevenDigits(body);
    case "BE":
      return isValidBelgianEnterpriseNumber(body);
    case "PL":
      return isValidPolishNip(body);
    case "PT":
      return isValidPortugueseNif(body);
    case "ES":
      return isValidSpanishNif(body);
    case "HR":
      return isValidCroatianOib(body);
    case "FR": {
      // FR + 2-char key + SIREN. A numeric key is (12 + 3 * (SIREN mod 97))
      // mod 97; a letter key (temporary numbers) is not checked.
      const key = body.slice(0, 2);
      const siren = body.slice(2);
      if (!isValidSiren(siren)) return false;
      if (!/^\d{2}$/.test(key)) return true;
      return (12 + 3 * (Number(siren) % 97)) % 97 === Number(key);
    }
    default:
      return true;
  }
}

/**
 * Is `normalized` (see normalizeVatNumber) a plausible VAT number?
 *
 * - With a known country prefix ("DE123456789"): the format of that country,
 *   plus the check digit where one is verified.
 * - Without a prefix, and an `expectedCountry` (the invoice address): the
 *   number is read as that country's ("123456789" + PL).
 * - Without a prefix and no country: eleven digits are read as Italian (the
 *   original P.IVA behaviour); anything else must look like an EU-style
 *   number — two letters + 2-12 alphanumerics — since it may come from
 *   outside the countries above.
 */
export function isValidVatNumber(
  normalized: string,
  expectedCountry?: string
): boolean {
  let prefix = knownVatPrefix(normalized);
  let full = normalized;
  if (prefix) {
    // "GR..." typed for Greece: VIES writes EL.
    if (normalized.startsWith("GR")) full = `EL${normalized.slice(2)}`;
  } else if (expectedCountry && /^\d|^[A-Z]\d/.test(normalized)) {
    const country = vatPrefixFor(expectedCountry);
    prefix = country === "CHE" ? "CH" : country;
    if (VAT_PATTERNS[prefix]) full = `${country}${normalized}`;
    else prefix = null;
  }
  if (!prefix) {
    const it = normalized.match(/^(?:IT)?(\d{11})$/);
    if (it) return isValidItalianElevenDigits(it[1]);
    return /^[A-Z]{2}[A-Z0-9]{2,12}$/.test(normalized);
  }
  if (!VAT_PATTERNS[prefix].test(full)) return false;
  const body = full.slice(prefix === "CH" ? 3 : 2);
  return vatBodyChecksum(prefix === "EL" ? "GR" : prefix, body.replace(/(MWST|TVA|IVA|TPV|MVA)$/, ""));
}

// -----------------------------------------------------------------------------
// Tax ID types
// -----------------------------------------------------------------------------

/**
 * What a studio can tell the checkout to check a "Tax ID" field as. The list
 * is closed and small on purpose: each entry is a published check-digit
 * algorithm, not a legal requirement — whether a field is asked at all, and
 * whether it is mandatory, is the studio's own setting. `generic` checks
 * nothing but the plausible shape, and is what every field starts as.
 */
export type TaxIdType =
  | "generic"
  | "it_codice_fiscale"
  | "fr_siren"
  | "es_nif"
  | "pt_nif"
  | "hr_oib";

export const TAX_ID_TYPES: readonly TaxIdType[] = [
  "generic",
  "it_codice_fiscale",
  "fr_siren",
  "es_nif",
  "pt_nif",
  "hr_oib",
];

/** The country a typed identifier belongs to, and its national name (the
 *  default label). `generic` belongs to no country. */
export const TAX_ID_TYPE_INFO: Record<
  TaxIdType,
  { country: string | null; name: string | null }
> = {
  generic: { country: null, name: null },
  it_codice_fiscale: { country: "IT", name: "Codice fiscale" },
  fr_siren: { country: "FR", name: "SIREN" },
  es_nif: { country: "ES", name: "NIF" },
  pt_nif: { country: "PT", name: "NIF" },
  hr_oib: { country: "HR", name: "OIB" },
};

/**
 * Is `normalized` (see normalizeTaxCode) a valid tax ID of `type`?
 *
 * `kind` matters for the Italian codice fiscale only: a business may give the
 * 11-digit one of a company, a private person just the 16-character one.
 *
 * `customerCountry` scopes a typed identifier to its own country: someone
 * living elsewhere cannot have an Italian codice fiscale, so they are checked
 * only for a plausible shape. Pass no country to always apply the type.
 */
export function isValidTaxIdOfType(
  normalized: string,
  type: TaxIdType,
  kind: "private" | "business",
  customerCountry?: string
): boolean {
  const own = TAX_ID_TYPE_INFO[type].country;
  if (own && customerCountry && customerCountry.toUpperCase() !== own) {
    return isPlausibleTaxId(normalized);
  }
  switch (type) {
    case "it_codice_fiscale":
      return (
        isValidItalianPersonalTaxCode(normalized) ||
        (kind === "business" && isValidItalianElevenDigits(normalized))
      );
    case "fr_siren":
      return isValidSiren(normalized);
    case "es_nif":
      return isValidSpanishNif(normalized);
    case "pt_nif":
      return isValidPortugueseNif(normalized);
    case "hr_oib":
      return isValidCroatianOib(normalized);
    case "generic":
      return isPlausibleTaxId(normalized);
  }
}

// -----------------------------------------------------------------------------
// E-invoice address (recipient code / PEC)
// -----------------------------------------------------------------------------

export type EAddressType = "generic" | "it_sdi_or_pec";

export const E_ADDRESS_TYPES: readonly EAddressType[] = ["generic", "it_sdi_or_pec"];

export const E_ADDRESS_TYPE_INFO: Record<
  EAddressType,
  { country: string | null; name: string | null }
> = {
  generic: { country: null, name: null },
  it_sdi_or_pec: { country: "IT", name: "Codice destinatario / PEC" },
};

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * The address an electronic invoice is sent to. `generic`: any short text
 * (a code, an address). `it_sdi_or_pec`: an Italian codice destinatario
 * (exactly seven letters or digits) or a certified email address (PEC), the
 * two ways the SdI finds a recipient. Returns the normalised value, or null
 * if it is not acceptable.
 */
export function normalizeEAddress(raw: string, type: EAddressType): string | null {
  const value = raw.trim();
  if (!value || value.length > 254) return null;
  if (type === "generic") return value;
  if (EMAIL_SHAPE.test(value)) return value.toLowerCase();
  const code = value.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z0-9]{7}$/.test(code) ? code : null;
}
