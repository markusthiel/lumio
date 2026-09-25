/**
 * Print-shop checkout form model: the customer registry (anagrafica),
 * the shipping address and the optional invoice block, plus the pure
 * helpers the cart step needs — "which fields does the studio ask for",
 * "is the form complete enough to submit" and "turn it into the checkout API
 * payload".
 *
 * What is asked beyond name, address and phone — a tax ID, a VAT number, an
 * e-invoice address, and whether each is required — is the studio's own
 * setting, delivered with the catalog as `invoicing`. The server enforces the
 * same rules (services/print/customer-data.ts).
 *
 * Completeness here is "required fields are filled", plus the few cheap
 * shape rules the server would otherwise reject with an opaque error: a
 * minimum phone length, a plausible email, and the fixed shape of an Italian
 * recipient code / PEC. The format and check digit of the tax identifiers
 * themselves are verified by the server, which answers with a translated
 * error code — no second copy of the checksum logic in the browser.
 */
import type {
  CheckoutAddress,
  FieldMode,
  InvoiceKind,
  InvoicingConfig,
} from "@/lib/api";
import { scopedMode } from "@/lib/invoice-settings";

export interface AddressForm {
  street: string;
  street2: string;
  postalCode: string;
  city: string;
  region: string;
  countryCode: string;
}

export interface CheckoutForm {
  // Customer registry.
  firstName: string;
  lastName: string;
  email: string;
  /** Required for a courier order, optional for pickup. */
  phone: string;
  /** Asked only where the studio's "tax ID at checkout" setting says so. */
  taxCode: string;
  /** Residence address, always asked. */
  address: AddressForm;

  /** Ship to the residence address instead of a separate one. Ignored for
   *  pickup methods, which take no shipping address. */
  shipToResidence: boolean;
  shippingAddress: AddressForm;

  wantsInvoice: boolean;
  /** Which of the studio's two sets of settings applies to the invoice. */
  invoiceKind: InvoiceKind;
  /** Invoice to the customer's own name and residence address (and tax ID,
   *  where one was given above). What the studio asks for on top of that is
   *  still asked. */
  invoiceSameAsCustomer: boolean;
  invoiceName: string;
  invoiceVatNumber: string;
  invoiceTaxCode: string;
  invoiceEAddress: string;
  invoiceAddress: AddressForm;
}

export function emptyAddress(countryCode: string): AddressForm {
  return {
    street: "",
    street2: "",
    postalCode: "",
    city: "",
    region: "",
    countryCode,
  };
}

export function emptyCheckoutForm(countryCode: string): CheckoutForm {
  return {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    taxCode: "",
    address: emptyAddress(countryCode),
    shipToResidence: true,
    shippingAddress: emptyAddress(countryCode),
    wantsInvoice: false,
    invoiceKind: "private",
    invoiceSameAsCustomer: true,
    invoiceName: "",
    invoiceVatNumber: "",
    invoiceTaxCode: "",
    invoiceEAddress: "",
    invoiceAddress: emptyAddress(countryCode),
  };
}

const filled = (v: string) => v.trim().length > 0;

/** Mirrors MIN_PHONE_LENGTH in the API's services/print/customer-data.ts —
 *  keep the two in step, or the form enables a submit the API will refuse. */
const MIN_PHONE_LENGTH = 5;

/** Loose shape check, deliberately never stricter than the server's
 *  z.string().email(), which stays the judge. Needed because the submit
 *  button is not inside a <form>, so the browser's own type="email"
 *  validation never runs. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** An Italian codice destinatario: exactly seven letters or digits. */
const RECIPIENT_CODE_SHAPE = /^[A-Za-z0-9]{7}$/;

export const isValidPhone = (v: string) => v.trim().length >= MIN_PHONE_LENGTH;
export const isValidEmail = (v: string) => EMAIL_SHAPE.test(v.trim());
/** The Italian type of e-invoice address: a recipient code or a PEC. */
export const isValidItalianEAddress = (v: string) =>
  RECIPIENT_CODE_SHAPE.test(v.replace(/\s+/g, "")) || EMAIL_SHAPE.test(v.trim());

/** A phone is required for a courier order, and optional for pickup — but a
 *  phone that is given must be plausible either way. */
export function isPhoneAcceptable(phone: string, isPickup: boolean): boolean {
  return filled(phone) ? isValidPhone(phone) : isPickup;
}

// -----------------------------------------------------------------------------
// What is asked
// -----------------------------------------------------------------------------

/** Whether the registry asks for the tax ID, and if it must be given. It is
 *  the studio's "tax ID at checkout" setting, and a typed identifier (a
 *  codice fiscale) is only *required* of customers living in its country. */
export function checkoutTaxCodeMode(
  invoicing: InvoicingConfig,
  f: CheckoutForm
): FieldMode {
  return scopedMode(
    invoicing.checkoutTaxId,
    invoicing.taxId.country,
    f.address.countryCode
  );
}

/** Everything about how the invoice block is shown and read. */
export interface ResolvedInvoice {
  name: string;
  address: AddressForm;
  /** What the studio asks for on an invoice to this kind of customer, in the
   *  invoice address's country. */
  modes: { vatNumber: FieldMode; taxCode: FieldMode; eAddress: FieldMode };
  /** The tax ID that will be sent: the one given above, when the invoice goes
   *  to the customer's own details and the checkout asked for one, else the
   *  one typed in the invoice block. */
  taxCode: string;
  /** True when the tax ID comes from the checkout, so it is not asked twice. */
  taxCodeFromRegistry: boolean;
}

export function resolveInvoice(
  invoicing: InvoicingConfig,
  f: CheckoutForm
): ResolvedInvoice {
  const same = f.invoiceSameAsCustomer;
  const address = same ? f.address : f.invoiceAddress;
  const kind = f.invoiceKind;
  const modes = {
    vatNumber: invoicing.vatNumber[kind],
    taxCode: scopedMode(
      invoicing.taxId[kind],
      invoicing.taxId.country,
      address.countryCode
    ),
    eAddress: scopedMode(
      invoicing.eAddress[kind],
      invoicing.eAddress.country,
      address.countryCode
    ),
  };
  const taxCodeFromRegistry =
    same &&
    checkoutTaxCodeMode(invoicing, f) !== "off" &&
    filled(f.taxCode) &&
    modes.taxCode !== "off";
  return {
    name: same ? `${f.firstName.trim()} ${f.lastName.trim()}` : f.invoiceName,
    address,
    modes,
    taxCode: taxCodeFromRegistry ? f.taxCode : f.invoiceTaxCode,
    taxCodeFromRegistry,
  };
}

/** A field's label: the studio's own wording, else the caller's translated one. */
export function fieldLabel(studioLabel: string | null, generic: string): string {
  return studioLabel && studioLabel.trim() ? studioLabel.trim() : generic;
}

function addressComplete(a: AddressForm): boolean {
  return (
    filled(a.street) &&
    filled(a.postalCode) &&
    filled(a.city) &&
    a.countryCode.trim().length === 2
  );
}

function toCheckoutAddress(a: AddressForm): CheckoutAddress {
  return {
    street: a.street.trim(),
    ...(filled(a.street2) ? { street2: a.street2.trim() } : {}),
    postalCode: a.postalCode.trim(),
    city: a.city.trim(),
    ...(filled(a.region) ? { region: a.region.trim() } : {}),
    countryCode: a.countryCode.trim().toUpperCase(),
  };
}

export function isCheckoutFormComplete(
  invoicing: InvoicingConfig,
  f: CheckoutForm,
  isPickup: boolean
): boolean {
  if (
    !filled(f.firstName) ||
    !filled(f.lastName) ||
    !isValidEmail(f.email) ||
    !isPhoneAcceptable(f.phone, isPickup) ||
    !addressComplete(f.address)
  ) {
    return false;
  }
  if (checkoutTaxCodeMode(invoicing, f) === "required" && !filled(f.taxCode)) {
    return false;
  }
  if (!isPickup && !f.shipToResidence && !addressComplete(f.shippingAddress)) {
    return false;
  }
  if (f.wantsInvoice) {
    const inv = resolveInvoice(invoicing, f);
    if (!filled(inv.name) || !addressComplete(inv.address)) return false;
    if (inv.modes.vatNumber === "required" && !filled(f.invoiceVatNumber)) {
      return false;
    }
    // Asked at checkout already, not a second time.
    if (
      inv.modes.taxCode === "required" &&
      !inv.taxCodeFromRegistry &&
      !filled(inv.taxCode)
    ) {
      return false;
    }
    if (inv.modes.eAddress !== "off") {
      if (!filled(f.invoiceEAddress)) {
        if (inv.modes.eAddress === "required") return false;
      } else if (
        invoicing.eAddress.country !== null &&
        inv.address.countryCode.trim().toUpperCase() === invoicing.eAddress.country &&
        !isValidItalianEAddress(f.invoiceEAddress)
      ) {
        return false;
      }
    }
  }
  return true;
}

/** The customer/address/invoice part of the checkout API payload. */
export function buildCheckoutCustomerPayload(
  invoicing: InvoicingConfig,
  f: CheckoutForm,
  isPickup: boolean
) {
  const inv = resolveInvoice(invoicing, f);
  return {
    guestFirstName: f.firstName.trim(),
    guestLastName: f.lastName.trim(),
    guestEmail: f.email.trim(),
    guestPhone: filled(f.phone) ? f.phone.trim() : null,
    guestTaxCode: checkoutTaxCodeMode(invoicing, f) !== "off" ? f.taxCode.trim() : null,
    customerAddress: toCheckoutAddress(f.address),
    ...(isPickup
      ? {}
      : {
          shippingAddress: toCheckoutAddress(
            f.shipToResidence ? f.address : f.shippingAddress
          ),
        }),
    invoice: f.wantsInvoice
      ? {
          kind: f.invoiceKind,
          name: inv.name.trim(),
          vatNumber: inv.modes.vatNumber !== "off" ? f.invoiceVatNumber.trim() : null,
          taxCode: inv.modes.taxCode !== "off" ? inv.taxCode.trim() : null,
          eAddress: inv.modes.eAddress !== "off" ? f.invoiceEAddress.trim() : null,
          address: toCheckoutAddress(inv.address),
        }
      : null,
  };
}
