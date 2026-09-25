import { describe, it, expect } from "vitest";
import {
  DEFAULT_INVOICE_SETTINGS,
  describeInvoiceSettings,
  eAddressLabel,
  invoiceSettingsSchema,
  parseInvoiceSettings,
  scopedMode,
  taxIdLabel,
  type InvoiceSettings,
} from "./invoice-settings.js";

const italian: InvoiceSettings = {
  checkoutTaxId: "required",
  vatNumber: { private: "off", business: "required", label: "Partita IVA" },
  taxId: { private: "required", business: "required", label: null, type: "it_codice_fiscale" },
  eAddress: { private: "off", business: "optional", label: null, type: "it_sdi_or_pec" },
};

describe("defaults", () => {
  it("ask for nothing", () => {
    expect(DEFAULT_INVOICE_SETTINGS.checkoutTaxId).toBe("off");
    for (const f of [
      DEFAULT_INVOICE_SETTINGS.vatNumber,
      DEFAULT_INVOICE_SETTINGS.taxId,
      DEFAULT_INVOICE_SETTINGS.eAddress,
    ]) {
      expect(f.private).toBe("off");
      expect(f.business).toBe("off");
      expect(f.label).toBeNull();
    }
    expect(DEFAULT_INVOICE_SETTINGS.taxId.type).toBe("generic");
  });
});

describe("parseInvoiceSettings", () => {
  it("reads nothing stored, or garbage, as the defaults — never as an error", () => {
    expect(parseInvoiceSettings(null)).toEqual(DEFAULT_INVOICE_SETTINGS);
    expect(parseInvoiceSettings(undefined)).toEqual(DEFAULT_INVOICE_SETTINGS);
    expect(parseInvoiceSettings("nope")).toEqual(DEFAULT_INVOICE_SETTINGS);
    expect(parseInvoiceSettings({ checkoutTaxId: "sometimes" })).toEqual(DEFAULT_INVOICE_SETTINGS);
  });

  it("round-trips a valid setting", () => {
    expect(parseInvoiceSettings(italian)).toEqual(italian);
  });
});

describe("invoiceSettingsSchema", () => {
  it("turns a blank label into 'use the default'", () => {
    const parsed = invoiceSettingsSchema.parse({
      ...italian,
      vatNumber: { ...italian.vatNumber, label: "   " },
    });
    expect(parsed.vatNumber.label).toBeNull();
  });

  it("trims a label and refuses an over-long one", () => {
    expect(
      invoiceSettingsSchema.parse({ ...italian, vatNumber: { ...italian.vatNumber, label: "  NIP " } })
        .vatNumber.label
    ).toBe("NIP");
    expect(
      invoiceSettingsSchema.safeParse({
        ...italian,
        vatNumber: { ...italian.vatNumber, label: "x".repeat(61) },
      }).success
    ).toBe(false);
  });

  it("refuses an unknown mode or type", () => {
    expect(invoiceSettingsSchema.safeParse({ ...italian, checkoutTaxId: "maybe" }).success).toBe(false);
    expect(
      invoiceSettingsSchema.safeParse({ ...italian, taxId: { ...italian.taxId, type: "us_ssn" } }).success
    ).toBe(false);
    expect(
      invoiceSettingsSchema.safeParse({ ...italian, eAddress: { ...italian.eAddress, type: "peppol" } }).success
    ).toBe(false);
  });
});

describe("scopedMode", () => {
  it("a required typed identifier is only optional outside its own country", () => {
    expect(scopedMode("required", "IT", "IT")).toBe("required");
    expect(scopedMode("required", "IT", "it")).toBe("required");
    expect(scopedMode("required", "IT", "DE")).toBe("optional");
  });

  it("off and optional never change", () => {
    expect(scopedMode("off", "IT", "DE")).toBe("off");
    expect(scopedMode("optional", "IT", "DE")).toBe("optional");
  });

  it("a generic (country-less) identifier is required everywhere", () => {
    expect(scopedMode("required", null, "DE")).toBe("required");
  });
});

describe("labels", () => {
  it("the studio's own wording wins, else the type's national name, else null", () => {
    expect(taxIdLabel(italian)).toBe("Codice fiscale");
    expect(taxIdLabel({ ...italian, taxId: { ...italian.taxId, label: "Tax code" } })).toBe("Tax code");
    expect(taxIdLabel(DEFAULT_INVOICE_SETTINGS)).toBeNull();
    expect(eAddressLabel(italian)).toBe("Codice destinatario / PEC");
    expect(eAddressLabel(DEFAULT_INVOICE_SETTINGS)).toBeNull();
  });
});

describe("describeInvoiceSettings", () => {
  it("exposes the settings with labels resolved and the country of each typed field", () => {
    const d = describeInvoiceSettings(italian);
    expect(d.checkoutTaxId).toBe("required");
    expect(d.taxId).toEqual({ private: "required", business: "required", label: "Codice fiscale", country: "IT" });
    expect(d.vatNumber).toEqual({ private: "off", business: "required", label: "Partita IVA" });
    expect(d.eAddress).toEqual({ private: "off", business: "optional", label: "Codice destinatario / PEC", country: "IT" });
  });

  it("a generic field belongs to no country", () => {
    const d = describeInvoiceSettings(DEFAULT_INVOICE_SETTINGS);
    expect(d.taxId.country).toBeNull();
    expect(d.eAddress.country).toBeNull();
  });
});
