import { describe, it, expect } from "vitest";
import {
  buildOrderItemsCsv,
  buildOrderSummaryMarkdown,
  formatCrop,
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
    finishName: null,
    sku: "PRINT-SILK-10x15",
    quantity: 3,
    unitPriceCents: 35,
    totalPriceCents: 105,
    crop: null,
    imageWidth: null,
    imageHeight: null,
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
        "Finish",
        "Width (mm)",
        "Height (mm)",
        "Crop",
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
    // SKU is the 9th column (Order, File ID, Filename, Product, Format,
    // Finish, Width, Height, Crop, SKU) — empty quoted cell between its
    // neighbours confirms it wasn't just omitted, shifting every
    // subsequent column left.
    const cells = lines[1].split(",");
    expect(cells[9]).toBe('""');
  });

  it("renders the selected finish name when present, empty when absent", () => {
    const withFinish = buildOrderItemsCsv("LP-1", "EUR", [
      row({ finishName: "Cornice nera" }),
    ]);
    expect(withFinish).toContain('"Cornice nera"');

    const withoutFinish = buildOrderItemsCsv("LP-1", "EUR", [row({ finishName: null })]);
    const lines = withoutFinish.replace(/^\uFEFF/, "").split("\r\n").filter(Boolean);
    const cells = lines[1].split(",");
    expect(cells[5]).toBe('""'); // Finish is the 6th column
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

describe("buildOrderSummaryMarkdown — customer registry and invoice", () => {
  const addr = {
    street: "Via Roma 1",
    postalCode: "24121",
    city: "Bergamo",
    region: "BG",
    countryCode: "IT",
  };

  it("prints tax code, phone and customer address when present", () => {
    const md = buildOrderSummaryMarkdown(
      header({
        guestTaxCode: "RSSMRA85T10A562S",
        guestPhone: "+39 333 1234567",
        customerAddress: addr,
      }),
      [row()]
    );
    expect(md).toContain("- **Tax code:** RSSMRA85T10A562S");
    expect(md).toContain("- **Phone:** +39 333 1234567");
    expect(md).toContain("- **Customer address:** Via Roma 1, 24121 Bergamo, BG, IT");
  });

  it("does not print the phone twice when it is also on the shipping address", () => {
    const md = buildOrderSummaryMarkdown(
      header({
        guestPhone: "+39 333 1234567",
        shippingAddress: { ...addr, phone: "+39 333 1234567" },
      }),
      [row()]
    );
    expect(md.match(/\*\*Phone:\*\*/g)).toHaveLength(1);
  });

  it("still prints the phone from the shipping address on a pre-registry order", () => {
    const md = buildOrderSummaryMarkdown(
      header({ shippingAddress: { ...addr, phone: "+39 111" } }),
      [row()]
    );
    expect(md).toContain("- **Phone:** +39 111");
  });

  it("prints the invoice block only when an invoice was requested", () => {
    const without = buildOrderSummaryMarkdown(header({ invoice: null }), [row()]);
    expect(without).not.toContain("Invoice requested");

    const md = buildOrderSummaryMarkdown(
      header({
        invoice: {
          kind: "business",
          name: "Rossi Foto SRL",
          vatNumber: "IT12345678903",
          taxCode: "12345678903",
          eAddress: "KJH45Z1",
          address: addr,
        },
      }),
      [row()]
    );
    expect(md).toContain("- **Invoice requested:** yes (business)");
    expect(md).toContain("E-invoice address: KJH45Z1");
    expect(md).toContain("Invoice to: Rossi Foto SRL");
    expect(md).toContain("VAT number: IT12345678903");
    expect(md).toContain("Tax code: 12345678903");
    expect(md).toContain("Invoice address: Via Roma 1, 24121 Bergamo, BG, IT");
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

describe("formatCrop", () => {
  it("returns a dash when no crop was chosen", () => {
    expect(formatCrop(null, 6000, 4000)).toBe("—");
  });

  it("expresses the crop in pixels when image dimensions are known", () => {
    // Zentrierter 3:2-Ausschnitt aus einem 4:3-Bild — der haeufigste Fall.
    const crop = { x: 0, y: 0.125, width: 1, height: 0.75 };
    expect(formatCrop(crop, 4000, 3000)).toBe("4000×2250 px at (0, 375) of 4000×3000");
  });

  it("falls back to percentages without dimensions", () => {
    const crop = { x: 0.1, y: 0.2, width: 0.5, height: 0.6 };
    expect(formatCrop(crop, null, null)).toBe("50%×60% at (10%, 20%)");
  });

  it("rounds rather than printing sub-pixel values", () => {
    // 1/3 des Bildes: kein Fotograf schneidet auf 1333.333 Pixel.
    const crop = { x: 1 / 3, y: 0, width: 1 / 3, height: 1 };
    expect(formatCrop(crop, 4000, 3000)).toBe("1333×3000 px at (1333, 0) of 4000×3000");
  });
});
