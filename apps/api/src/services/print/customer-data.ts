/**
 * Lumio API — print-shop customer data (registry + invoice request)
 *
 * Pure validation/normalisation of what the checkout collects, driven by the
 * studio's invoice settings (invoice-settings.ts): which identifiers a
 * customer is asked for, and which are mandatory, is the studio's choice.
 * The identifier checks themselves live in tax-ids.ts. Deliberately free of
 * Prisma/Fastify so it is directly unit-testable (same pattern as
 * pricing-tiers.ts).
 */
import {
  scopedMode,
  type InvoiceField,
  type InvoiceKind,
  type InvoiceSettings,
} from "./invoice-settings.js";
import {
  E_ADDRESS_TYPE_INFO,
  TAX_ID_TYPE_INFO,
  isValidTaxIdOfType,
  isValidVatNumber,
  normalizeEAddress,
  normalizeTaxCode,
  normalizeVatNumber,
} from "./tax-ids.js";

export type CheckoutValidationCode =
  | "invalid_tax_code"
  | "tax_code_required"
  | "invalid_vat_number"
  | "invalid_e_address"
  | "invoice_details_required"
  | "invalid_phone"
  | "phone_required";

/** Error with a stable code — the public route passes it through as the
 *  `error` field and the frontend translates it via `apiError.<code>`. */
export class CheckoutValidationError extends Error {
  constructor(
    public readonly code: CheckoutValidationCode,
    message: string,
    /** The field concerned, when there is one. */
    public readonly field?: InvoiceField | "phone"
  ) {
    super(message);
    this.name = "CheckoutValidationError";
  }
}

export interface CheckoutAddressInput {
  street: string;
  street2?: string;
  postalCode: string;
  city: string;
  region?: string;
  countryCode: string;
  phone?: string;
}

export interface CheckoutInvoiceInput {
  kind: InvoiceKind;
  /** The company name for a business, first + last name for a private person. */
  name: string;
  vatNumber?: string | null;
  /** The tax ID field — a codice fiscale, a NIF, a SIREN… by the studio's setting. */
  taxCode?: string | null;
  eAddress?: string | null;
  address: CheckoutAddressInput;
}

export interface CheckoutCustomerInput {
  guestFirstName: string;
  guestLastName: string;
  /** Required for a courier order, optional for pickup — see
   *  requirePhoneForDelivery(). */
  guestPhone?: string | null;
  /** Asked only if the studio's "tax ID at checkout" setting says so. */
  guestTaxCode?: string | null;
  customerAddress: CheckoutAddressInput;
  /** null/undefined = no invoice requested. */
  invoice?: CheckoutInvoiceInput | null;
}

export interface NormalizedCheckoutCustomer {
  guestName: string;
  guestFirstName: string;
  guestLastName: string;
  guestPhone: string | null;
  guestTaxCode: string | null;
  customerAddress: CheckoutAddressInput;
  invoiceRequested: boolean;
  invoiceKind: InvoiceKind | null;
  invoiceName: string | null;
  invoiceVatNumber: string | null;
  invoiceTaxCode: string | null;
  invoiceEAddress: string | null;
  billingAddress: CheckoutAddressInput | null;
}

/** Mirrors MIN_PHONE_LENGTH in the frontend's lib/print-checkout.ts — keep
 *  the two in step, or the form enables a submit the API will refuse. */
export const MIN_PHONE_LENGTH = 5;

// Checked in this order — the order the fields appear in the form, so the
// first problem reported is also the topmost faulty field.
const INVOICE_FIELD_ORDER: InvoiceField[] = ["vatNumber", "taxCode", "eAddress"];

/**
 * A courier needs a phone number to deliver; pickup does not. Called once the
 * shipping method is known (the customer data is normalised before pricing,
 * which is where the method is resolved).
 */
export function requirePhoneForDelivery(
  phone: string | null,
  isPickup: boolean
): void {
  if (!isPickup && !phone) {
    throw new CheckoutValidationError(
      "phone_required",
      "A phone number is required for delivery.",
      "phone"
    );
  }
}

/**
 * Validates and normalises the registry + invoice block against the studio's
 * invoice settings. Throws CheckoutValidationError with a stable code.
 *
 * A field the settings turn off is dropped, not stored, even if the client
 * sent it; a field they require must be present; one that is present is
 * always checked, whatever its mode.
 */
export function normalizeCheckoutCustomer(
  input: CheckoutCustomerInput,
  settings: InvoiceSettings
): NormalizedCheckoutCustomer {
  const firstName = input.guestFirstName.trim();
  const lastName = input.guestLastName.trim();

  const phone = (input.guestPhone ?? "").trim();
  if (phone && phone.length < MIN_PHONE_LENGTH) {
    throw new CheckoutValidationError(
      "invalid_phone",
      "The phone number is too short.",
      "phone"
    );
  }

  const taxIdCountry = TAX_ID_TYPE_INFO[settings.taxId.type].country;
  const eAddressCountry = E_ADDRESS_TYPE_INFO[settings.eAddress.type].country;

  // ---- tax ID at checkout (asked of every customer)
  const customerCountry = input.customerAddress.countryCode;
  const checkoutMode = scopedMode(
    settings.checkoutTaxId,
    taxIdCountry,
    customerCountry
  );
  let guestTaxCode: string | null = null;
  if (checkoutMode !== "off") {
    const raw = normalizeTaxCode(input.guestTaxCode ?? "");
    if (raw) {
      if (
        !isValidTaxIdOfType(raw, settings.taxId.type, "private", customerCountry)
      ) {
        throw new CheckoutValidationError(
          "invalid_tax_code",
          "Invalid tax code.",
          "taxCode"
        );
      }
      guestTaxCode = raw;
    } else if (checkoutMode === "required") {
      throw new CheckoutValidationError(
        "tax_code_required",
        "A tax code is required.",
        "taxCode"
      );
    }
  }

  // ---- invoice block
  const out = {
    invoiceKind: null as InvoiceKind | null,
    invoiceName: null as string | null,
    invoiceVatNumber: null as string | null,
    invoiceTaxCode: null as string | null,
    invoiceEAddress: null as string | null,
    billingAddress: null as CheckoutAddressInput | null,
  };

  if (input.invoice) {
    const inv = input.invoice;
    const invoiceCountry = inv.address.countryCode.toUpperCase();

    out.invoiceKind = inv.kind;
    out.invoiceName = inv.name.trim();
    if (!out.invoiceName) {
      throw new CheckoutValidationError(
        "invoice_details_required",
        "Invoice details are incomplete."
      );
    }

    const modes: Record<InvoiceField, ReturnType<typeof scopedMode>> = {
      vatNumber: settings.vatNumber[inv.kind],
      taxCode: scopedMode(settings.taxId[inv.kind], taxIdCountry, invoiceCountry),
      eAddress: scopedMode(
        settings.eAddress[inv.kind],
        eAddressCountry,
        invoiceCountry
      ),
    };

    for (const field of INVOICE_FIELD_ORDER) {
      if (modes[field] === "off") continue;
      const value = (inv[field] ?? "").trim();
      if (!value) {
        if (modes[field] === "required") {
          throw new CheckoutValidationError(
            "invoice_details_required",
            "Invoice details are incomplete.",
            field
          );
        }
        continue;
      }
      switch (field) {
        case "vatNumber": {
          const n = normalizeVatNumber(value);
          if (!isValidVatNumber(n, invoiceCountry)) {
            throw new CheckoutValidationError(
              "invalid_vat_number",
              "Invalid VAT number.",
              field
            );
          }
          out.invoiceVatNumber = n;
          break;
        }
        case "taxCode": {
          const n = normalizeTaxCode(value);
          if (!isValidTaxIdOfType(n, settings.taxId.type, inv.kind, invoiceCountry)) {
            throw new CheckoutValidationError(
              "invalid_tax_code",
              "Invalid tax code.",
              field
            );
          }
          out.invoiceTaxCode = n;
          break;
        }
        case "eAddress": {
          // Outside the type's country the address is not an Italian one, so
          // only a plausible value is asked of it.
          const type =
            eAddressCountry && invoiceCountry !== eAddressCountry
              ? "generic"
              : settings.eAddress.type;
          const n = normalizeEAddress(value, type);
          if (!n) {
            throw new CheckoutValidationError(
              "invalid_e_address",
              "Invalid e-invoice address.",
              field
            );
          }
          out.invoiceEAddress = n;
          break;
        }
      }
    }
    out.billingAddress = inv.address;
  }

  return {
    guestName: `${firstName} ${lastName}`,
    guestFirstName: firstName,
    guestLastName: lastName,
    guestPhone: phone || null,
    guestTaxCode,
    customerAddress: input.customerAddress,
    invoiceRequested: input.invoice != null,
    ...out,
  };
}
