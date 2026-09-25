"use client";

/**
 * Form building blocks of the print-shop checkout (customer registry,
 * shipping address, invoice). Kept out of the cart-step page because the
 * same address fields appear three times (residence, shipping, invoice).
 */
import { useT } from "@/lib/i18n";
import type { FieldMode, InvoiceKind, InvoicingConfig } from "@/lib/api";
import {
  fieldLabel,
  isValidItalianEAddress,
  resolveInvoice,
  type AddressForm,
  type CheckoutForm,
} from "@/lib/print-checkout";

export function FieldRow({
  label,
  type = "text",
  required,
  value,
  onChange,
  className,
  maxLength,
  autoComplete,
  error,
}: {
  label: string;
  type?: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  className?: string;
  maxLength?: number;
  autoComplete?: string;
  /** Shown under the input, which is then flagged invalid. */
  error?: string;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="block text-xs text-ink-tertiary mb-1">
        {label} {required && <span className="text-semantic-danger">*</span>}
      </span>
      <input
        type={type}
        required={required}
        value={value}
        maxLength={maxLength}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded border bg-surface-raised px-2 py-1.5 text-sm ${
          error ? "border-semantic-danger" : "border-line-subtle"
        }`}
      />
      {error && (
        <span className="block text-xs text-semantic-danger mt-1">{error}</span>
      )}
    </label>
  );
}

/** Street, address line 2, postal code, city, province/region, country.
 *  `autoCompletePrefix` ("shipping", "billing", or "" for the residence)
 *  keeps the browser autofill from mixing the three blocks up. */
export function AddressFields({
  value,
  onChange,
  autoCompletePrefix = "",
}: {
  value: AddressForm;
  onChange: (next: AddressForm) => void;
  autoCompletePrefix?: "" | "shipping" | "billing";
}) {
  const t = useT();
  const ac = (field: string) =>
    autoCompletePrefix ? `${autoCompletePrefix} ${field}` : field;
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <FieldRow
        label={t("printShop.street")}
        required
        value={value.street}
        onChange={(v) => onChange({ ...value, street: v })}
        className="sm:col-span-2"
        autoComplete={ac("address-line1")}
      />
      <FieldRow
        label={t("printShop.addressExtra")}
        value={value.street2}
        onChange={(v) => onChange({ ...value, street2: v })}
        className="sm:col-span-2"
        autoComplete={ac("address-line2")}
      />
      <FieldRow
        label={t("printShop.postalCode")}
        required
        value={value.postalCode}
        onChange={(v) => onChange({ ...value, postalCode: v })}
        autoComplete={ac("postal-code")}
      />
      <FieldRow
        label={t("printShop.city")}
        required
        value={value.city}
        onChange={(v) => onChange({ ...value, city: v })}
        autoComplete={ac("address-level2")}
      />
      <FieldRow
        label={t("printShop.region")}
        value={value.region}
        onChange={(v) => onChange({ ...value, region: v })}
        autoComplete={ac("address-level1")}
      />
      <FieldRow
        label={t("printShop.country")}
        required
        maxLength={2}
        value={value.countryCode}
        onChange={(v) => onChange({ ...value, countryCode: v.toUpperCase() })}
        autoComplete={ac("country")}
      />
    </div>
  );
}

/**
 * The invoice request. What it asks for beyond name, address and the kind of
 * customer is the studio's own setting (lib/print-checkout.ts): a tax ID, a
 * VAT number, an e-invoice address — each off, optional or required
 * separately for a private person and for a business, and worded as the
 * studio words it ("Codice fiscale", "NIF"…).
 */
export function InvoiceSection({
  form,
  setForm,
  invoicing,
}: {
  form: CheckoutForm;
  setForm: (next: CheckoutForm) => void;
  invoicing: InvoicingConfig;
}) {
  const t = useT();
  const inv = resolveInvoice(invoicing, form);
  const modes = inv.modes;
  const label = (studio: string | null, generic: string, mode: FieldMode) => {
    const text = fieldLabel(studio, generic);
    return mode === "optional" ? `${text} (${t("printShop.optional")})` : text;
  };
  const kinds: Array<{ value: InvoiceKind; label: string }> = [
    { value: "private", label: t("printShop.invoiceKindPrivate") },
    { value: "business", label: t("printShop.invoiceKindBusiness") },
  ];
  // A typed e-invoice address (the Italian recipient code / PEC) has a fixed
  // shape; a generic one is free text.
  const eAddressTyped =
    invoicing.eAddress.country !== null &&
    inv.address.countryCode.trim().toUpperCase() === invoicing.eAddress.country;

  return (
    <section className="rounded-md border border-line-subtle bg-surface-raised p-4">
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input
          type="checkbox"
          checked={form.wantsInvoice}
          onChange={(e) => setForm({ ...form, wantsInvoice: e.target.checked })}
        />
        {t("printShop.invoiceRequest")}
      </label>
      {form.wantsInvoice && (
        <div className="mt-3 space-y-3">
          <fieldset>
            <legend className="text-xs text-ink-tertiary mb-1">
              {t("printShop.invoiceKindLegend")}
            </legend>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {kinds.map((k) => (
                <label key={k.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="invoiceKind"
                    value={k.value}
                    checked={form.invoiceKind === k.value}
                    onChange={() => setForm({ ...form, invoiceKind: k.value })}
                  />
                  {k.label}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.invoiceSameAsCustomer}
              onChange={(e) =>
                setForm({ ...form, invoiceSameAsCustomer: e.target.checked })
              }
            />
            {t("printShop.invoiceSameAsCustomer")}
          </label>

          <div className="grid sm:grid-cols-2 gap-3">
            {!form.invoiceSameAsCustomer && (
              <FieldRow
                label={
                  form.invoiceKind === "business"
                    ? t("printShop.invoiceName")
                    : t("printShop.invoiceNamePrivate")
                }
                required
                value={form.invoiceName}
                onChange={(v) => setForm({ ...form, invoiceName: v })}
                className="sm:col-span-2"
                autoComplete={form.invoiceKind === "business" ? "organization" : "name"}
              />
            )}
            {modes.vatNumber !== "off" && (
              <FieldRow
                label={label(invoicing.vatNumber.label, t("printShop.vatNumber"), modes.vatNumber)}
                required={modes.vatNumber === "required"}
                value={form.invoiceVatNumber}
                onChange={(v) => setForm({ ...form, invoiceVatNumber: v.toUpperCase() })}
              />
            )}
            {modes.taxCode !== "off" && !inv.taxCodeFromRegistry && (
              <FieldRow
                label={label(invoicing.taxId.label, t("printShop.invoiceTaxCode"), modes.taxCode)}
                required={modes.taxCode === "required"}
                value={form.invoiceTaxCode}
                onChange={(v) => setForm({ ...form, invoiceTaxCode: v.toUpperCase() })}
              />
            )}
            {modes.eAddress !== "off" && (
              <FieldRow
                label={label(invoicing.eAddress.label, t("printShop.eAddress"), modes.eAddress)}
                required={modes.eAddress === "required"}
                value={form.invoiceEAddress}
                onChange={(v) => setForm({ ...form, invoiceEAddress: v })}
                className="sm:col-span-2"
                error={
                  eAddressTyped &&
                  form.invoiceEAddress.trim() &&
                  !isValidItalianEAddress(form.invoiceEAddress)
                    ? t("printShop.eAddressInvalid")
                    : undefined
                }
              />
            )}
          </div>
          {modes.eAddress !== "off" && eAddressTyped && (
            <p className="text-xs text-ink-tertiary">{t("printShop.eAddressHint")}</p>
          )}

          {!form.invoiceSameAsCustomer && (
            <>
              <h3 className="text-xs font-semibold text-ink-secondary">
                {t("printShop.invoiceAddress")}
              </h3>
              <AddressFields
                autoCompletePrefix="billing"
                value={form.invoiceAddress}
                onChange={(invoiceAddress) => setForm({ ...form, invoiceAddress })}
              />
            </>
          )}
        </div>
      )}
    </section>
  );
}
