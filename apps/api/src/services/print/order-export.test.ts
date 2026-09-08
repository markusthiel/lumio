import { describe, it, expect } from "vitest";
import { buildOrderItemsCsv, type OrderExportRow } from "./order-export.js";

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
    // Finish, Width, Height, SKU) — empty quoted cell between its
    // neighbours confirms it wasn't just omitted, shifting every
    // subsequent column left.
    const cells = lines[1].split(",");
    expect(cells[8]).toBe('""');
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
