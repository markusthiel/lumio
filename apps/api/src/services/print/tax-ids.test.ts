import { describe, it, expect } from "vitest";
import {
  TAX_ID_TYPES,
  TAX_ID_TYPE_INFO,
  isPlausibleTaxId,
  isValidBelgianEnterpriseNumber,
  isValidCroatianOib,
  isValidItalianElevenDigits,
  isValidItalianPersonalTaxCode,
  isValidPolishNip,
  isValidPortugueseNif,
  isValidSiren,
  isValidSpanishCif,
  isValidSpanishNif,
  isValidSpanishPersonalId,
  isValidTaxIdOfType,
  isValidVatNumber,
  normalizeEAddress,
  normalizeTaxCode,
  normalizeVatNumber,
  vatPrefixFor,
} from "./tax-ids.js";

// The reference values below are well-known examples of valid numbers; each
// was also cross-checked against a separate implementation of the published
// algorithm. The "broken" variants change only the check digit.

describe("normalizeTaxCode / normalizeVatNumber", () => {
  it("strips whitespace and uppercases a tax code", () => {
    expect(normalizeTaxCode(" rss mra85t10a562s ")).toBe("RSSMRA85T10A562S");
  });

  it("also strips separators from a VAT number", () => {
    expect(normalizeVatNumber("it 123.456.789-03")).toBe("IT12345678903");
  });
});

describe("Italy", () => {
  it("accepts a valid codice fiscale", () => {
    expect(isValidItalianPersonalTaxCode("RSSMRA85T10A562S")).toBe(true);
  });

  it("rejects a wrong check character", () => {
    expect(isValidItalianPersonalTaxCode("RSSMRA85T10A562X")).toBe(false);
  });

  it("rejects a wrong length or shape", () => {
    expect(isValidItalianPersonalTaxCode("RSSMRA85T10A562")).toBe(false);
    expect(isValidItalianPersonalTaxCode("1234567890123456")).toBe(false);
    expect(isValidItalianPersonalTaxCode("")).toBe(false);
  });

  it("accepts an omocodia variant (digits swapped for LMNPQRSTUV)", () => {
    // The check character is recomputed over the letter form.
    expect(isValidItalianPersonalTaxCode("RSSMRA85T10A56NS")).toBe(false);
    expect(isValidItalianPersonalTaxCode("RSSMRA85T10A56NH")).toBe(true);
  });

  it("checks the 11-digit P.IVA / company codice fiscale", () => {
    expect(isValidItalianElevenDigits("12345678903")).toBe(true);
    expect(isValidItalianElevenDigits("12345678901")).toBe(false);
    expect(isValidItalianElevenDigits("1234567890")).toBe(false);
  });
});

describe("France — SIREN", () => {
  it("accepts a valid SIREN", () => {
    expect(isValidSiren("732829320")).toBe(true);
    expect(isValidSiren("552100554")).toBe(true);
  });

  it("rejects a broken check digit or wrong length", () => {
    expect(isValidSiren("732829321")).toBe(false);
    expect(isValidSiren("73282932")).toBe(false);
  });

  it("accepts a SIRET, judged by its SIREN", () => {
    expect(isValidSiren("73282932000074")).toBe(true);
    expect(isValidSiren("73282932100074")).toBe(false);
  });
});

describe("Spain — NIF", () => {
  it("checks the letter of a DNI and a NIE", () => {
    expect(isValidSpanishPersonalId("12345678Z")).toBe(true);
    expect(isValidSpanishPersonalId("12345678A")).toBe(false);
    expect(isValidSpanishPersonalId("X1234567L")).toBe(true);
    expect(isValidSpanishPersonalId("X1234567A")).toBe(false);
  });

  it("checks the control of a CIF, digit or letter form", () => {
    expect(isValidSpanishCif("A58818501")).toBe(true); // digit
    expect(isValidSpanishCif("A5881850A")).toBe(true); // letter form of the same control
    expect(isValidSpanishCif("A58818502")).toBe(false);
    expect(isValidSpanishCif("Z58818501")).toBe(false); // not an organisation letter
  });

  it("accepts either through isValidSpanishNif", () => {
    expect(isValidSpanishNif("12345678Z")).toBe(true);
    expect(isValidSpanishNif("A58818501")).toBe(true);
    expect(isValidSpanishNif("12345678")).toBe(false);
  });
});

describe("Portugal, Poland, Belgium, Croatia", () => {
  it("Portugal: NIF check digit", () => {
    expect(isValidPortugueseNif("999999990")).toBe(true); // "consumidor final"
    expect(isValidPortugueseNif("501964843")).toBe(true);
    expect(isValidPortugueseNif("999999991")).toBe(false);
  });

  it("Poland: NIP check digit", () => {
    expect(isValidPolishNip("1234563218")).toBe(true);
    expect(isValidPolishNip("1234563219")).toBe(false);
    expect(isValidPolishNip("123456321")).toBe(false);
  });

  it("Belgium: enterprise number mod 97", () => {
    expect(isValidBelgianEnterpriseNumber("0403019261")).toBe(true);
    expect(isValidBelgianEnterpriseNumber("0403019262")).toBe(false);
    expect(isValidBelgianEnterpriseNumber("2403019261")).toBe(false); // must start 0 or 1
  });

  it("Croatia: OIB ISO 7064", () => {
    expect(isValidCroatianOib("69435151530")).toBe(true);
    expect(isValidCroatianOib("69435151531")).toBe(false);
  });
});

describe("isValidVatNumber", () => {
  it("accepts a P.IVA with a valid check digit, with or without IT", () => {
    expect(isValidVatNumber("12345678903")).toBe(true);
    expect(isValidVatNumber("IT12345678903")).toBe(true);
  });

  it("rejects a P.IVA with a wrong check digit or the wrong digit count", () => {
    expect(isValidVatNumber("IT12345678901")).toBe(false);
    expect(isValidVatNumber("1234567890")).toBe(false);
    expect(isValidVatNumber("123456789012")).toBe(false);
  });

  it("checks the format of the country its prefix names", () => {
    expect(isValidVatNumber("DE123456789")).toBe(true);
    expect(isValidVatNumber("DE12345678")).toBe(false);
    expect(isValidVatNumber("ATU12345678")).toBe(true);
    expect(isValidVatNumber("AT12345678")).toBe(false); // Austria needs the U
    expect(isValidVatNumber("NL123456789B01")).toBe(true);
    expect(isValidVatNumber("NL123456789")).toBe(false);
    expect(isValidVatNumber("IE1234567FA")).toBe(true);
    expect(isValidVatNumber("SE123456789001")).toBe(true);
  });

  it("verifies the check digit where it is known", () => {
    expect(isValidVatNumber("FR40303265045")).toBe(true);
    expect(isValidVatNumber("FR41303265045")).toBe(false); // wrong key
    expect(isValidVatNumber("ESA58818501")).toBe(true);
    expect(isValidVatNumber("ESA58818502")).toBe(false);
    expect(isValidVatNumber("BE0403019261")).toBe(true);
    expect(isValidVatNumber("BE0403019262")).toBe(false);
    expect(isValidVatNumber("PL1234563218")).toBe(true);
    expect(isValidVatNumber("PL1234563219")).toBe(false);
    expect(isValidVatNumber("PT999999990")).toBe(true);
    expect(isValidVatNumber("HR69435151530")).toBe(true);
    expect(isValidVatNumber("HR69435151531")).toBe(false);
  });

  it("does not check a French letter key (temporary numbers) beyond format", () => {
    expect(isValidVatNumber("FRAB303265045")).toBe(true);
  });

  it("accepts Greece as EL or GR", () => {
    expect(isValidVatNumber("EL123456789")).toBe(true);
    expect(isValidVatNumber("GR123456789")).toBe(true);
    expect(isValidVatNumber("EL12345678")).toBe(false);
  });

  it("knows the formats outside the EU VAT area", () => {
    expect(isValidVatNumber("CHE123456789MWST")).toBe(true);
    expect(isValidVatNumber("CHE123456789")).toBe(true);
    expect(isValidVatNumber("GB123456789")).toBe(true);
    expect(isValidVatNumber("NO123456789MVA")).toBe(true);
    expect(isValidVatNumber("NO12345678")).toBe(false);
  });

  it("reads a number without a prefix as the expected country's", () => {
    expect(isValidVatNumber("1234563218", "PL")).toBe(true);
    expect(isValidVatNumber("1234563219", "PL")).toBe(false);
    expect(isValidVatNumber("40303265045", "FR")).toBe(true);
    expect(isValidVatNumber("A58818501", "ES")).toBe(true);
    expect(isValidVatNumber("123456789", "GR")).toBe(true);
    expect(isValidVatNumber("123456789B01", "NL")).toBe(true);
  });

  it("lets an explicit prefix win over the expected country", () => {
    // a German company with an address in Poland
    expect(isValidVatNumber("DE123456789", "PL")).toBe(true);
  });

  it("accepts an EU-style number of a country it has no pattern for, rejects garbage", () => {
    expect(isValidVatNumber("XX12345")).toBe(true);
    expect(isValidVatNumber("")).toBe(false);
    expect(isValidVatNumber("ABC")).toBe(false);
    expect(isValidVatNumber("12")).toBe(false);
  });
});

describe("vatPrefixFor", () => {
  it("maps the exceptions", () => {
    expect(vatPrefixFor("GR")).toBe("EL");
    expect(vatPrefixFor("ch")).toBe("CHE");
    expect(vatPrefixFor("de")).toBe("DE");
  });
});

describe("isValidTaxIdOfType", () => {
  const CF = "RSSMRA85T10A562S";

  it("a private customer needs a real 16-character codice fiscale", () => {
    expect(isValidTaxIdOfType(CF, "it_codice_fiscale", "private")).toBe(true);
    expect(isValidTaxIdOfType("ABC12345", "it_codice_fiscale", "private")).toBe(false);
    expect(isValidTaxIdOfType("12345678903", "it_codice_fiscale", "private")).toBe(false);
  });

  it("a business may also give the 11-digit codice fiscale of a company", () => {
    expect(isValidTaxIdOfType("12345678903", "it_codice_fiscale", "business")).toBe(true);
    expect(isValidTaxIdOfType("12345678901", "it_codice_fiscale", "business")).toBe(false);
    expect(isValidTaxIdOfType(CF, "it_codice_fiscale", "business")).toBe(true);
  });

  it("catches the classic slip: a codice fiscale where a VAT number belongs", () => {
    // 16 characters pass a generic 3-30 letters-and-digits check, but not a
    // VAT number check.
    expect(isPlausibleTaxId(CF)).toBe(true);
    expect(isValidVatNumber(CF, "IT")).toBe(false);
    expect(isValidVatNumber("12345678903", "IT")).toBe(true);
  });

  it("SIREN, NIF (ES and PT) and OIB are checked by their type", () => {
    expect(isValidTaxIdOfType("732829320", "fr_siren", "business")).toBe(true);
    expect(isValidTaxIdOfType("732829321", "fr_siren", "business")).toBe(false);
    expect(isValidTaxIdOfType("12345678Z", "es_nif", "private")).toBe(true);
    expect(isValidTaxIdOfType("12345678A", "es_nif", "private")).toBe(false);
    expect(isValidTaxIdOfType("501964843", "pt_nif", "business")).toBe(true);
    expect(isValidTaxIdOfType("501964844", "pt_nif", "business")).toBe(false);
    expect(isValidTaxIdOfType("69435151530", "hr_oib", "private")).toBe(true);
    expect(isValidTaxIdOfType("69435151531", "hr_oib", "private")).toBe(false);
  });

  it("a typed identifier is only checked strictly for its own country", () => {
    // someone living in Germany has no Italian codice fiscale: only a
    // plausible shape is asked of them
    expect(isValidTaxIdOfType("12/345/67890", "it_codice_fiscale", "private", "DE")).toBe(true);
    expect(isValidTaxIdOfType("A1", "it_codice_fiscale", "private", "DE")).toBe(false);
    // ... but for someone living in Italy it is strict
    expect(isValidTaxIdOfType("12/345/67890", "it_codice_fiscale", "private", "IT")).toBe(false);
    expect(isValidTaxIdOfType(CF, "it_codice_fiscale", "private", "it")).toBe(true);
  });

  it("generic accepts a plausible tax id anywhere, but not an empty or tiny one", () => {
    expect(isValidTaxIdOfType("12/345/67890", "generic", "private")).toBe(true);
    expect(isValidTaxIdOfType("A1", "generic", "private")).toBe(false);
    expect(isValidTaxIdOfType("", "generic", "business")).toBe(false);
  });

  it("every type belongs to the country its name suggests", () => {
    expect(TAX_ID_TYPE_INFO.it_codice_fiscale).toEqual({ country: "IT", name: "Codice fiscale" });
    expect(TAX_ID_TYPE_INFO.generic).toEqual({ country: null, name: null });
    for (const t of TAX_ID_TYPES) expect(TAX_ID_TYPE_INFO[t]).toBeDefined();
  });
});

describe("normalizeEAddress", () => {
  it("generic keeps any short text as typed", () => {
    expect(normalizeEAddress("  ABC-123 ", "generic")).toBe("ABC-123");
    expect(normalizeEAddress("someone@example.org", "generic")).toBe("someone@example.org");
    expect(normalizeEAddress("", "generic")).toBeNull();
    expect(normalizeEAddress("x".repeat(255), "generic")).toBeNull();
  });

  it("the Italian type takes a 7-character recipient code or a PEC", () => {
    expect(normalizeEAddress(" kjh 45 z1 ", "it_sdi_or_pec")).toBe("KJH45Z1");
    expect(normalizeEAddress("0000000", "it_sdi_or_pec")).toBe("0000000");
    expect(normalizeEAddress("Rossi@Pec.IT", "it_sdi_or_pec")).toBe("rossi@pec.it");
  });

  it("the Italian type refuses anything else", () => {
    expect(normalizeEAddress("123456", "it_sdi_or_pec")).toBeNull();
    expect(normalizeEAddress("12345678", "it_sdi_or_pec")).toBeNull();
    expect(normalizeEAddress("not an address", "it_sdi_or_pec")).toBeNull();
  });
});
