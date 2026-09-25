/**
 * Client-side companion of the API's invoice-settings.ts: the options the
 * settings page offers, and the one rule the checkout has to apply exactly as
 * the server does — a typed identifier belongs to a country, so it is only
 * *required* of customers who live there.
 */
import type {
  EAddressType,
  FieldMode,
  InvoiceSettings,
  TaxIdType,
} from "@/lib/api";

export const DEFAULT_INVOICE_SETTINGS: InvoiceSettings = {
  checkoutTaxId: "off",
  vatNumber: { private: "off", business: "off", label: null },
  taxId: { private: "off", business: "off", label: null, type: "generic" },
  eAddress: { private: "off", business: "off", label: null, type: "generic" },
};

/** The types a tax ID field can be checked as, with the country each belongs
 *  to and its national name (shown as the default label). */
export const TAX_ID_TYPE_OPTIONS: Array<{
  value: TaxIdType;
  name: string | null;
  country: string | null;
}> = [
  { value: "generic", name: null, country: null },
  { value: "it_codice_fiscale", name: "Codice fiscale", country: "IT" },
  { value: "fr_siren", name: "SIREN", country: "FR" },
  { value: "es_nif", name: "NIF", country: "ES" },
  { value: "pt_nif", name: "NIF", country: "PT" },
  { value: "hr_oib", name: "OIB", country: "HR" },
];

export const E_ADDRESS_TYPE_OPTIONS: Array<{
  value: EAddressType;
  name: string | null;
  country: string | null;
}> = [
  { value: "generic", name: null, country: null },
  { value: "it_sdi_or_pec", name: "Codice destinatario / PEC", country: "IT" },
];

/** Mirrors scopedMode() in the API: outside the country a typed identifier
 *  belongs to, `required` is only `optional`. */
export function scopedMode(
  mode: FieldMode,
  typeCountry: string | null,
  customerCountry: string
): FieldMode {
  if (
    mode === "required" &&
    typeCountry &&
    customerCountry.trim().toUpperCase() !== typeCountry
  ) {
    return "optional";
  }
  return mode;
}
