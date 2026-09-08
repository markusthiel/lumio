/**
 * Lumio API — Print Order CSV Export
 *
 * One row per order item: photo, format, quantity, SKU, price — meant
 * to save a studio from retyping order details into their invoicing
 * tool by hand. Deliberately its own tiny module (not folded into
 * orders.ts) so the CSV formatting stays pure and unit-testable,
 * mirroring apps/api/src/services/export.ts's proofing-CSV pattern
 * (BOM + quoted cells for Excel/Numbers/LibreOffice compatibility).
 */

const CSV_BOM = "\uFEFF"; // so Excel recognizes the file as UTF-8

export interface OrderExportRow {
  fileId: string;
  filename: string;
  productName: string;
  variantName: string;
  widthMm: number;
  heightMm: number;
  /** Selected finish option (e.g. frame color), if the variant offers any. */
  finishName: string | null;
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
    "Finish",
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
        r.finishName ?? "",
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
