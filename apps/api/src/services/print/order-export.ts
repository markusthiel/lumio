/**
 * Lumio API — Print Order Export (CSV + Markdown summary)
 *
 * One row per order item: photo, format, quantity, SKU, price — meant
 * to save a studio from retyping order details into their invoicing
 * tool by hand. Deliberately its own tiny module (not folded into
 * orders.ts) so the formatting stays pure and unit-testable, mirroring
 * apps/api/src/services/export.ts's proofing-CSV pattern (BOM + quoted
 * cells for Excel/Numbers/LibreOffice compatibility).
 */

const CSV_BOM = "\uFEFF"; // so Excel recognizes the file as UTF-8

export interface OrderExportRow {
  fileId: string;
  filename: string;
  productName: string;
  variantName: string;
  widthMm: number;
  heightMm: number;
  sku: string | null;
  quantity: number;
  unitPriceCents: number;
  totalPriceCents: number;
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function centsToAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function buildOrderItemsCsv(
  orderNumber: string,
  currency: string,
  rows: OrderExportRow[]
): string {
  const header = [
    "Order",
    "File ID",
    "Filename",
    "Product",
    "Format",
    "Width (mm)",
    "Height (mm)",
    "SKU",
    "Quantity",
    "Unit price",
    "Line total",
    "Currency",
  ];

  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        orderNumber,
        r.fileId,
        r.filename,
        r.productName,
        r.variantName,
        String(r.widthMm),
        String(r.heightMm),
        r.sku ?? "",
        String(r.quantity),
        centsToAmount(r.unitPriceCents),
        centsToAmount(r.totalPriceCents),
        currency,
      ]
        .map(csvCell)
        .join(",")
    );
  }

  return CSV_BOM + lines.join("\r\n") + "\r\n";
}

// =============================================================================
// Markdown order summary
// =============================================================================

export interface OrderSummaryAddress {
  street: string;
  street2?: string | null;
  postalCode: string;
  city: string;
  region?: string | null;
  countryCode: string;
  phone?: string | null;
}

/**
 * PrintOrder.shippingAddress is a Prisma Json column — nothing at the
 * DB layer guarantees it still matches OrderSummaryAddress by the time
 * this runs (a raw cast would let malformed JSON reach the string
 * interpolation below and throw). Used by the export.md route instead
 * of an unchecked `as` cast; an address that doesn't match is treated
 * the same as no address (falls back to the pickup-style summary line).
 */
export function isOrderSummaryAddress(value: unknown): value is OrderSummaryAddress {
  if (!value || typeof value !== "object") return false;
  const a = value as Record<string, unknown>;
  return (
    typeof a.street === "string" &&
    typeof a.postalCode === "string" &&
    typeof a.city === "string" &&
    typeof a.countryCode === "string"
  );
}

export interface OrderSummaryHeader {
  orderNumber: string;
  status: string;
  guestName: string;
  guestEmail: string;
  paymentMode: string;
  currency: string;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  shippingMethodName: string | null;
  /** null for pickup orders, or if no address was collected. */
  shippingAddress: OrderSummaryAddress | null;
  trackingNumber: string | null;
  trackingCarrier: string | null;
  trackingUrl: string | null;
  guestNote: string | null;
  /** ISO timestamp, printed as-is — no timezone conversion, this is a
   *  server-generated file, not a locale-aware UI. */
  createdAt: string;
}

/** Pipes and newlines break a Markdown table cell — escape/strip them. */
function mdEscape(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * Human-readable order summary for a studio's own records or for
 * handing to a lab/printer — everything a CSV row can't convey at a
 * glance (who the order is for, where it ships, its current status).
 * Reuses OrderExportRow for the item table, same data as the CSV.
 */
export function buildOrderSummaryMarkdown(
  header: OrderSummaryHeader,
  rows: OrderExportRow[]
): string {
  const lines: string[] = [];
  lines.push(`# Order ${header.orderNumber}`);
  lines.push("");
  lines.push(`- **Status:** ${header.status}`);
  lines.push(`- **Placed:** ${header.createdAt}`);
  lines.push(`- **Customer:** ${header.guestName} <${header.guestEmail}>`);
  lines.push(`- **Payment mode:** ${header.paymentMode}`);
  if (header.shippingMethodName) {
    lines.push(`- **Shipping method:** ${header.shippingMethodName}`);
  }
  if (header.shippingAddress) {
    const a = header.shippingAddress;
    const addressLine = [
      a.street,
      a.street2,
      `${a.postalCode} ${a.city}`,
      a.region,
      a.countryCode,
    ]
      .filter(Boolean)
      .join(", ");
    lines.push(`- **Shipping address:** ${addressLine}`);
    if (a.phone) lines.push(`- **Phone:** ${a.phone}`);
  } else {
    lines.push(`- **Shipping:** in-store pickup — no address collected`);
  }
  if (header.trackingNumber || header.trackingUrl) {
    const trackingBits = [header.trackingCarrier, header.trackingNumber]
      .filter(Boolean)
      .join(" ");
    lines.push(
      `- **Tracking:** ${trackingBits}${header.trackingUrl ? ` (${header.trackingUrl})` : ""}`
    );
  }
  if (header.guestNote) {
    lines.push(`- **Note from customer:** ${mdEscape(header.guestNote)}`);
  }
  lines.push("");
  lines.push("## Items");
  lines.push("");
  lines.push("| Photo | Product | Format | Qty | SKU | Unit price | Line total |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of rows) {
    lines.push(
      `| ${mdEscape(r.filename)} | ${mdEscape(r.productName)} | ${mdEscape(r.variantName)} (${r.widthMm}×${r.heightMm} mm) | ${r.quantity} | ${r.sku ? mdEscape(r.sku) : "—"} | ${centsToAmount(r.unitPriceCents)} ${header.currency} | ${centsToAmount(r.totalPriceCents)} ${header.currency} |`
    );
  }
  lines.push("");
  lines.push("## Totals");
  lines.push("");
  lines.push(`- Subtotal: ${centsToAmount(header.subtotalCents)} ${header.currency}`);
  lines.push(`- Shipping: ${centsToAmount(header.shippingCents)} ${header.currency}`);
  lines.push(`- Tax: ${centsToAmount(header.taxCents)} ${header.currency}`);
  lines.push(`- **Total: ${centsToAmount(header.totalCents)} ${header.currency}**`);
  lines.push("");

  return lines.join("\n");
}
