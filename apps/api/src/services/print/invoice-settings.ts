/**
 * Lumio API — invoice details a studio asks its customers for
 *
 * Lumio collects the data a studio needs to issue an invoice; it does not
 * issue one, and it does not decide what a country requires. So what the
 * checkout asks for is the STUDIO's own setting: three identifier fields —
 * a VAT number, a tax ID and an e-invoice address — each off, optional or
 * required, separately for a private customer and for a business, each with
 * a label the studio words itself ("Partita IVA", "NIF", "USt-IdNr."…).
 * One more setting asks every customer for the tax ID at checkout, invoice
 * or not (a codice fiscale, say).
 *
 * What a studio may also opt into is a CHECK on a value: the tax ID and the
 * e-invoice address can be checked as a known type (a codice fiscale, a
 * SIREN…) instead of only for a plausible shape. That is the part that saves
 * a studio from chasing a customer for a mistyped or misplaced number — a
 * codice fiscale typed into the VAT number field is the classic case. It is
 * opt-in, and the default is a generic check.
 *
 * Pure and free of Prisma/Fastify, like pricing-tiers.ts.
 */
import { z } from "zod";
import {
  E_ADDRESS_TYPES,
  E_ADDRESS_TYPE_INFO,
  TAX_ID_TYPES,
  TAX_ID_TYPE_INFO,
  type EAddressType,
  type TaxIdType,
} from "./tax-ids.js";

export type FieldMode = "off" | "optional" | "required";
export type InvoiceKind = "private" | "business";
export type InvoiceField = "vatNumber" | "taxCode" | "eAddress";

interface KindModes {
  private: FieldMode;
  business: FieldMode;
}

export interface InvoiceSettings {
  /** Asked of every customer at checkout, invoice or not. Uses the tax ID
   *  field's type and label. */
  checkoutTaxId: FieldMode;
  vatNumber: KindModes & { label: string | null };
  taxId: KindModes & { label: string | null; type: TaxIdType };
  eAddress: KindModes & { label: string | null; type: EAddressType };
}

export const DEFAULT_INVOICE_SETTINGS: InvoiceSettings = {
  checkoutTaxId: "off",
  vatNumber: { private: "off", business: "off", label: null },
  taxId: { private: "off", business: "off", label: null, type: "generic" },
  eAddress: { private: "off", business: "off", label: null, type: "generic" },
};

const modeSchema = z.enum(["off", "optional", "required"]);
// A blank label means "use the default".
const labelSchema = z
  .string()
  .trim()
  .max(60)
  .nullable()
  .transform((v) => (v ? v : null));

/** The whole settings object, as the studio saves it. */
export const invoiceSettingsSchema = z.object({
  checkoutTaxId: modeSchema,
  vatNumber: z.object({
    private: modeSchema,
    business: modeSchema,
    label: labelSchema,
  }),
  taxId: z.object({
    private: modeSchema,
    business: modeSchema,
    label: labelSchema,
    type: z.enum(TAX_ID_TYPES as unknown as [TaxIdType, ...TaxIdType[]]),
  }),
  eAddress: z.object({
    private: modeSchema,
    business: modeSchema,
    label: labelSchema,
    type: z.enum(E_ADDRESS_TYPES as unknown as [EAddressType, ...EAddressType[]]),
  }),
});

/** The stored JSON as settings: anything missing or malformed reads as the
 *  defaults (everything off), never as an error at checkout. */
export function parseInvoiceSettings(json: unknown): InvoiceSettings {
  const parsed = invoiceSettingsSchema.safeParse(json);
  return parsed.success ? parsed.data : DEFAULT_INVOICE_SETTINGS;
}

/**
 * A typed identifier belongs to a country: an Italian codice fiscale cannot be
 * required of someone who lives in Germany. Outside its country a `required`
 * field is only `optional`; `off` and `optional` stay as they are.
 */
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

/** The label a field is shown with: the studio's own, else the national name
 *  of its type; null = the caller's generic, translated label. */
export function taxIdLabel(s: InvoiceSettings): string | null {
  return s.taxId.label ?? TAX_ID_TYPE_INFO[s.taxId.type].name;
}
export function eAddressLabel(s: InvoiceSettings): string | null {
  return s.eAddress.label ?? E_ADDRESS_TYPE_INFO[s.eAddress.type].name;
}

/** What the customer-facing catalog exposes: the settings, with the labels
 *  resolved and the country each typed field belongs to (so the browser can
 *  scope a requirement exactly as the server does). */
export function describeInvoiceSettings(s: InvoiceSettings) {
  return {
    checkoutTaxId: s.checkoutTaxId,
    taxId: {
      private: s.taxId.private,
      business: s.taxId.business,
      label: taxIdLabel(s),
      country: TAX_ID_TYPE_INFO[s.taxId.type].country,
    },
    vatNumber: {
      private: s.vatNumber.private,
      business: s.vatNumber.business,
      label: s.vatNumber.label,
    },
    eAddress: {
      private: s.eAddress.private,
      business: s.eAddress.business,
      label: eAddressLabel(s),
      country: E_ADDRESS_TYPE_INFO[s.eAddress.type].country,
    },
  };
}
