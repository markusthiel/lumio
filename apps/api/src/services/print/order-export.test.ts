import { describe, it, expect } from "vitest";
import {
  buildOrderItemsCsv,
  buildOrderSummaryMarkdown,
  isOrderSummaryAddress,
  type OrderExportRow,
  type OrderSummaryHeader,
} from "./order-export.js";

function row(overrides: Partial<OrderExportRow> = {}): OrderExportRow {
  return {
    fileId: "file-1",
    filename: "IMG_0001.jpg",
    productName: "Foto-Print Seidenmatt",
    variantName: "10x15 cm",
    widthMm: 100,
    heightMm: 150,
    sku: "PRINT-SILK-10x15",
    quantity: 3,
    unitPriceCents: 35,
    totalPriceCents: 105,
    ...overrides,
  };
}

describe("buildOrderItemsCsv", () => {
  it("starts with a UTF-8 BOM so Excel recognizes the encoding", () => {
    const csv = buildOrderItemsCsv("LP-20260908-0001", "EUR", [row()]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("includes a header row with the expected columns", () => {
    const csv = buildOrderItemsCsv("LP-20260908-0001", "EUR", [row()]);
    const [header] = csv.replace(/^\uFEFF/, "").split("\r\n");
    expect(header).toBe(
      [
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
      ]
        .map((h) => `"${h}"`)
        .join(",")
    );
  });

  it("writes one row per item with cents converted to a decimal amount", () => {
    const csv = buildOrderItemsCsv("LP-20260908-0001", "EUR", [
      row({ quantity: 3, unitPriceCents: 35, totalPriceCents: 105 }),
    ]);
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(2); // header + 1 row
    expect(lines[1]).toContain('"3"');
    expect(lines[1]).toContain('"0.35"');
    expect(lines[1]).toContain('"1.05"');
    expect(lines[1]).toContain('"EUR"');
  });

  it("repeats the order number on every row", () => {
    const csv = buildOrderItemsCsv("LP-20260908-0001", "EUR", [
      row({ fileId: "a" }),
      row({ fileId: "b" }),
    ]);
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n").filter(Boolean);
    expect(lines[1]).toMatch(/^"LP-20260908-0001"/);
    expect(lines[2]).toMatch(/^"LP-20260908-0001"/);
  });

  it("renders a missing SKU as an empty cell rather than the literal word null", () => {
    const csv = buildOrderItemsCsv("LP-20260908-0001", "EUR", [row({ sku: null })]);
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n").filter(Boolean);
    expect(lines[1]).not.toContain("null");
    // SKU is the 8th column — empty quoted cell between quantity's
    // neighbours confirms it wasn't just omitted, shifting every
    // subsequent column left.
    const cells = lines[1].split(",");
    expect(cells[7]).toBe('""');
  });

  it("escapes embedded quotes and commas in filenames", () => {
    const csv = buildOrderItemsCsv("LP-1", "EUR", [
      row({ filename: 'photo, "final version".jpg' }),
    ]);
    expect(csv).toContain('"photo, ""final version"".jpg"');
  });

  it("produces just the header when there are no items", () => {
    const csv = buildOrderItemsCsv("LP-1", "EUR", []);
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(1);
  });
});

function header(overrides: Partial<OrderSummaryHeader> = {}): OrderSummaryHeader {
  return {
    orderNumber: "LP-20260908-0001",
    status: "paid",
    guestName: "Jane Doe",
    guestEmail: "jane@example.com",
    paymentMode: "offline_invoice",
    currency: "EUR",
    subtotalCents: 105,
    shippingCents: 0,
    taxCents: 20,
    totalCents: 125,
    shippingMethodName: "Standard",
    shippingAddress: {
      street: "Teststr. 1",
      postalCode: "12345",
      city: "Berlin",
      countryCode: "DE",
    },
    trackingNumber: null,
    trackingCarrier: null,
    trackingUrl: null,
    guestNote: null,
    createdAt: "2026-09-08T12:00:00.000Z",
    ...overrides,
  };
}

describe("buildOrderSummaryMarkdown", () => {
  it("includes the order number as the top-level heading", () => {
    const md = buildOrderSummaryMarkdown(header(), [row()]);
    expect(md).toContain("# Order LP-20260908-0001");
  });

  it("includes customer, status and payment mode", () => {
    const md = buildOrderSummaryMarkdown(header(), [row()]);
    expect(md).toContain("Jane Doe <jane@example.com>");
    expect(md).toContain("**Status:** paid");
    expect(md).toContain("**Payment mode:** offline_invoice");
  });

  it("renders the shipping address when present", () => {
    const md = buildOrderSummaryMarkdown(header(), [row()]);
    expect(md).toContain("Teststr. 1, 12345 Berlin, DE");
  });

  it("notes in-store pickup instead of an address when shippingAddress is null", () => {
    const md = buildOrderSummaryMarkdown(header({ shippingAddress: null }), [row()]);
    expect(md).toContain("in-store pickup");
    expect(md).not.toContain("Teststr.");
  });

  it("includes tracking info only when present", () => {
    const withTracking = buildOrderSummaryMarkdown(
      header({ trackingNumber: "1Z999", trackingCarrier: "UPS" }),
      [row()]
    );
    expect(withTracking).toContain("**Tracking:** UPS 1Z999");

    const withoutTracking = buildOrderSummaryMarkdown(header(), [row()]);
    expect(withoutTracking).not.toContain("**Tracking:**");
  });

  it("renders one item table row per order item with cents converted to decimal", () => {
    const md = buildOrderSummaryMarkdown(header(), [
      row({ filename: "a.jpg", quantity: 3, unitPriceCents: 35, totalPriceCents: 105 }),
      row({ filename: "b.jpg", quantity: 1, unitPriceCents: 500, totalPriceCents: 500 }),
    ]);
    expect(md).toContain("| a.jpg |");
    expect(md).toContain("| b.jpg |");
    expect(md).toContain("0.35 EUR");
    expect(md).toContain("5.00 EUR");
  });

  it("renders the totals section using the header's cents fields, not the rows'", () => {
    const md = buildOrderSummaryMarkdown(header({ totalCents: 12345 }), [row()]);
    expect(md).toContain("**Total: 123.45 EUR**");
  });

  it("escapes pipe characters in filenames so they don't break the Markdown table", () => {
    const md = buildOrderSummaryMarkdown(header(), [row({ filename: "photo|weird.jpg" })]);
    expect(md).toContain("photo\\|weird.jpg");
  });

  it("renders a dash for a missing SKU rather than the literal word null", () => {
    const md = buildOrderSummaryMarkdown(header(), [row({ sku: null })]);
    expect(md).not.toContain("null");
    expect(md).toContain("| \u2014 |");
  });
});

describe("isOrderSummaryAddress", () => {
  it("accepts a well-formed address", () => {
    expect(
      isOrderSummaryAddress({
        street: "Teststr. 1",
        postalCode: "12345",
        city: "Berlin",
        countryCode: "DE",
      })
    ).toBe(true);
  });

  it("rejects null, non-objects, and objects missing required fields", () => {
    expect(isOrderSummaryAddress(null)).toBe(false);
    expect(isOrderSummaryAddress(undefined)).toBe(false);
    expect(isOrderSummaryAddress("a string")).toBe(false);
    expect(isOrderSummaryAddress({})).toBe(false);
    expect(isOrderSummaryAddress({ street: "Teststr. 1" })).toBe(false);
    expect(
      isOrderSummaryAddress({ street: "x", postalCode: "1", city: "y" }) // no countryCode
    ).toBe(false);
  });
});
