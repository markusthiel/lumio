import { describe, it, expect } from "vitest";
import {
  CheckoutValidationError,
  normalizeCheckoutCustomer,
  requirePhoneForDelivery,
  type CheckoutCustomerInput,
  type CheckoutInvoiceInput,
} from "./customer-data.js";
import { DEFAULT_INVOICE_SETTINGS, type InvoiceSettings } from "./invoice-settings.js";

const itAddress = { street: "Via Roma 1", postalCode: "24121", city: "Bergamo", countryCode: "IT" };
const deAddress = { street: "Hauptstraße 1", postalCode: "10115", city: "Berlin", countryCode: "DE" };
const CF = "RSSMRA85T10A562S";

/** An Italian studio: the codice fiscale is asked of everyone, a business
 *  also needs a Partita IVA, and may give a recipient code or PEC. */
const italian: InvoiceSettings = {
  checkoutTaxId: "required",
  vatNumber: { private: "off", business: "required", label: "Partita IVA" },
  taxId: { private: "required", business: "required", label: null, type: "it_codice_fiscale" },
  eAddress: { private: "off", business: "optional", label: null, type: "it_sdi_or_pec" },
};

const customer: CheckoutCustomerInput = {
  guestFirstName: " Mario ",
  guestLastName: "Rossi ",
  guestPhone: " +39 333 1234567 ",
  guestTaxCode: "rss mra 85t10 a562 s",
  customerAddress: itAddress,
  invoice: null,
};

const invoice = (o: Partial<CheckoutInvoiceInput> = {}): CheckoutInvoiceInput => ({
  kind: "business",
  name: " Rossi Foto SRL ",
  address: itAddress,
  ...o,
});

/** The code (and field) a normalisation throws, or null if it goes through. */
function failure(fn: () => unknown): { code: string; field?: string } | null {
  try {
    fn();
    return null;
  } catch (err) {
    if (!(err instanceof CheckoutValidationError)) throw err;
    return { code: err.code, field: err.field };
  }
}

describe("registry", () => {
  it("composes the name and normalises the phone and the tax ID", () => {
    const r = normalizeCheckoutCustomer(customer, italian);
    expect(r.guestName).toBe("Mario Rossi");
    expect(r.guestFirstName).toBe("Mario");
    expect(r.guestLastName).toBe("Rossi");
    expect(r.guestPhone).toBe("+39 333 1234567");
    expect(r.guestTaxCode).toBe(CF);
    expect(r.invoiceRequested).toBe(false);
    expect(r.billingAddress).toBeNull();
    expect(r.invoiceKind).toBeNull();
  });

  it("asks for nothing beyond name, address and phone by default", () => {
    const r = normalizeCheckoutCustomer({ ...customer, guestTaxCode: undefined }, DEFAULT_INVOICE_SETTINGS);
    expect(r.guestTaxCode).toBeNull();
  });

  it("drops a tax ID the studio does not ask for, even if the client sent one", () => {
    expect(normalizeCheckoutCustomer(customer, DEFAULT_INVOICE_SETTINGS).guestTaxCode).toBeNull();
  });
});

describe("phone", () => {
  it("is optional to give, but a short one is refused", () => {
    expect(normalizeCheckoutCustomer({ ...customer, guestPhone: "" }, italian).guestPhone).toBeNull();
    expect(normalizeCheckoutCustomer({ ...customer, guestPhone: undefined }, italian).guestPhone).toBeNull();
    expect(failure(() => normalizeCheckoutCustomer({ ...customer, guestPhone: "123" }, italian)))
      .toEqual({ code: "invalid_phone", field: "phone" });
    expect(normalizeCheckoutCustomer({ ...customer, guestPhone: "12345" }, italian).guestPhone).toBe("12345");
  });

  it("is required for a courier order and not for pickup", () => {
    expect(failure(() => requirePhoneForDelivery(null, false)))
      .toEqual({ code: "phone_required", field: "phone" });
    expect(failure(() => requirePhoneForDelivery("+39 333 1234567", false))).toBeNull();
    expect(failure(() => requirePhoneForDelivery(null, true))).toBeNull();
  });
});

describe("tax ID at checkout", () => {
  it("required: a missing one is refused, and an invalid one with its own code", () => {
    expect(failure(() => normalizeCheckoutCustomer({ ...customer, guestTaxCode: "" }, italian)))
      .toEqual({ code: "tax_code_required", field: "taxCode" });
    expect(failure(() => normalizeCheckoutCustomer({ ...customer, guestTaxCode: null }, italian)))
      .toEqual({ code: "tax_code_required", field: "taxCode" });
    expect(failure(() => normalizeCheckoutCustomer({ ...customer, guestTaxCode: "NOPE" }, italian)))
      .toEqual({ code: "invalid_tax_code", field: "taxCode" });
  });

  it("optional: may be left out, but is checked when given", () => {
    const optional: InvoiceSettings = { ...italian, checkoutTaxId: "optional" };
    expect(normalizeCheckoutCustomer({ ...customer, guestTaxCode: "" }, optional).guestTaxCode).toBeNull();
    expect(failure(() => normalizeCheckoutCustomer({ ...customer, guestTaxCode: "NOPE" }, optional))?.code)
      .toBe("invalid_tax_code");
  });

  it("an Italian codice fiscale is not required of a customer living abroad", () => {
    const abroad = { ...customer, customerAddress: deAddress };
    expect(normalizeCheckoutCustomer({ ...abroad, guestTaxCode: "" }, italian).guestTaxCode).toBeNull();
    // ... and one they do give is only checked for a plausible shape
    expect(normalizeCheckoutCustomer({ ...abroad, guestTaxCode: "12/345/67890" }, italian).guestTaxCode)
      .toBe("12/345/67890");
    expect(failure(() => normalizeCheckoutCustomer({ ...abroad, guestTaxCode: "A1" }, italian))?.code)
      .toBe("invalid_tax_code");
  });

  it("a generic tax ID is required of everyone, wherever they live", () => {
    const generic: InvoiceSettings = {
      ...DEFAULT_INVOICE_SETTINGS,
      checkoutTaxId: "required",
      taxId: { ...DEFAULT_INVOICE_SETTINGS.taxId, private: "off", business: "off" },
    };
    expect(failure(() => normalizeCheckoutCustomer({ ...customer, customerAddress: deAddress, guestTaxCode: "" }, generic)))
      .toEqual({ code: "tax_code_required", field: "taxCode" });
    expect(normalizeCheckoutCustomer({ ...customer, customerAddress: deAddress, guestTaxCode: "12/345/67890" }, generic).guestTaxCode)
      .toBe("12/345/67890");
  });
});

describe("invoice — an Italian studio's settings", () => {
  it("a private customer needs the codice fiscale, and nothing else", () => {
    const r = normalizeCheckoutCustomer(
      { ...customer, invoice: invoice({ kind: "private", name: "Mario Rossi", taxCode: "rssmra85t10a562s" }) },
      italian
    );
    expect(r.invoiceRequested).toBe(true);
    expect(r.invoiceKind).toBe("private");
    expect(r.invoiceTaxCode).toBe(CF);
    expect(r.invoiceVatNumber).toBeNull();
    expect(failure(() => normalizeCheckoutCustomer(
      { ...customer, invoice: invoice({ kind: "private", name: "Mario Rossi" }) }, italian)))
      .toEqual({ code: "invoice_details_required", field: "taxCode" });
  });

  it("a business needs P.IVA and codice fiscale (a company's 11-digit one is fine) and may give an e-invoice address", () => {
    const r = normalizeCheckoutCustomer(
      {
        ...customer,
        invoice: invoice({
          vatNumber: "IT 123.456.789-03",
          taxCode: "12345678903",
          eAddress: " kjh 45 z1 ",
        }),
      },
      italian
    );
    expect(r.invoiceKind).toBe("business");
    expect(r.invoiceName).toBe("Rossi Foto SRL");
    expect(r.invoiceVatNumber).toBe("IT12345678903");
    expect(r.invoiceTaxCode).toBe("12345678903");
    expect(r.invoiceEAddress).toBe("KJH45Z1");
    expect(r.billingAddress).toEqual(itAddress);
  });

  it("the e-invoice address is optional; a PEC is kept lower-cased", () => {
    const good = { vatNumber: "12345678903", taxCode: "12345678903" };
    expect(normalizeCheckoutCustomer({ ...customer, invoice: invoice(good) }, italian).invoiceEAddress).toBeNull();
    expect(normalizeCheckoutCustomer({ ...customer, invoice: invoice({ ...good, eAddress: "Rossi@Pec.IT" }) }, italian).invoiceEAddress)
      .toBe("rossi@pec.it");
  });

  it("refuses a missing P.IVA, reporting which field", () => {
    expect(failure(() => normalizeCheckoutCustomer(
      { ...customer, invoice: invoice({ taxCode: "12345678903" }) }, italian)))
      .toEqual({ code: "invoice_details_required", field: "vatNumber" });
  });

  it("refuses a bad P.IVA, codice fiscale or e-invoice address, each with its own code", () => {
    const good = { vatNumber: "12345678903", taxCode: "12345678903" };
    const run = (extra: Partial<CheckoutInvoiceInput>) =>
      failure(() => normalizeCheckoutCustomer({ ...customer, invoice: invoice({ ...good, ...extra }) }, italian));
    expect(run({ vatNumber: "12345678901" })).toEqual({ code: "invalid_vat_number", field: "vatNumber" });
    expect(run({ taxCode: "BADCODE" })).toEqual({ code: "invalid_tax_code", field: "taxCode" });
    expect(run({ eAddress: "123" })).toEqual({ code: "invalid_e_address", field: "eAddress" });
  });

  it("catches a codice fiscale typed into the VAT number field", () => {
    expect(failure(() => normalizeCheckoutCustomer(
      { ...customer, invoice: invoice({ vatNumber: CF, taxCode: CF }) }, italian)))
      .toEqual({ code: "invalid_vat_number", field: "vatNumber" });
  });

  it("refuses a blank invoice name", () => {
    expect(failure(() => normalizeCheckoutCustomer(
      { ...customer, invoice: invoice({ name: "   ", vatNumber: "12345678903", taxCode: "12345678903" }) },
      italian))?.code).toBe("invoice_details_required");
  });

  it("a business abroad needs no codice fiscale, and its e-invoice address is only plausibility-checked", () => {
    const r = normalizeCheckoutCustomer(
      {
        ...customer,
        invoice: invoice({ address: deAddress, vatNumber: "DE123456789", taxCode: "", eAddress: "ab" }),
      },
      italian
    );
    expect(r.invoiceVatNumber).toBe("DE123456789");
    expect(r.invoiceTaxCode).toBeNull();
    expect(r.invoiceEAddress).toBe("ab");
  });
});

describe("invoice — other studios' settings", () => {
  it("a French studio asks a business for its SIREN in the tax ID field, and checks it", () => {
    const french: InvoiceSettings = {
      ...DEFAULT_INVOICE_SETTINGS,
      vatNumber: { private: "off", business: "optional", label: "N° TVA" },
      taxId: { private: "off", business: "required", label: "SIREN", type: "fr_siren" },
    };
    const fr = { street: "1 rue de la Paix", postalCode: "75002", city: "Paris", countryCode: "FR" };
    const base = { ...customer, customerAddress: fr };
    const r = normalizeCheckoutCustomer(
      { ...base, invoice: invoice({ address: fr, taxCode: "732 829 320", vatNumber: "FR40303265045" }) },
      french
    );
    expect(r.invoiceTaxCode).toBe("732829320");
    expect(r.invoiceVatNumber).toBe("FR40303265045");
    expect(failure(() => normalizeCheckoutCustomer({ ...base, invoice: invoice({ address: fr }) }, french)))
      .toEqual({ code: "invoice_details_required", field: "taxCode" });
    expect(failure(() => normalizeCheckoutCustomer({ ...base, invoice: invoice({ address: fr, taxCode: "732829321" }) }, french))
      ?.code).toBe("invalid_tax_code");
    // private: nothing asked
    expect(normalizeCheckoutCustomer({ ...base, invoice: invoice({ kind: "private", name: "Marie Dupont", address: fr }) }, french)
      .invoiceTaxCode).toBeNull();
  });

  it("a German studio asks for nothing; a VAT number is checked only if the studio asks for one", () => {
    const de = { ...customer, customerAddress: deAddress };
    const none = normalizeCheckoutCustomer(
      { ...de, invoice: invoice({ kind: "private", name: "Erika Mustermann", address: deAddress }) },
      DEFAULT_INVOICE_SETTINGS
    );
    expect(none.invoiceRequested).toBe(true);
    expect(none.invoiceVatNumber).toBeNull();
    expect(normalizeCheckoutCustomer(
      { ...de, invoice: invoice({ address: deAddress, vatNumber: "DE123456789" }) }, DEFAULT_INVOICE_SETTINGS)
      .invoiceVatNumber).toBeNull(); // not asked -> dropped

    const asked: InvoiceSettings = {
      ...DEFAULT_INVOICE_SETTINGS,
      vatNumber: { private: "off", business: "optional", label: "USt-IdNr." },
    };
    expect(normalizeCheckoutCustomer({ ...de, invoice: invoice({ address: deAddress, vatNumber: "DE123456789" }) }, asked)
      .invoiceVatNumber).toBe("DE123456789");
    expect(failure(() => normalizeCheckoutCustomer({ ...de, invoice: invoice({ address: deAddress, vatNumber: "DE12" }) }, asked))
      ?.code).toBe("invalid_vat_number");
  });

  it("a field the settings turn off is dropped even if the client sends it", () => {
    const r = normalizeCheckoutCustomer(
      {
        ...customer,
        invoice: invoice({
          kind: "private",
          name: "Mario Rossi",
          taxCode: CF,
          vatNumber: "12345678903",
          eAddress: "0000000",
        }),
      },
      italian
    );
    expect(r.invoiceTaxCode).toBe(CF); // asked of a private customer
    expect(r.invoiceVatNumber).toBeNull(); // off for a private customer
    expect(r.invoiceEAddress).toBeNull(); // off for a private customer
  });
});
