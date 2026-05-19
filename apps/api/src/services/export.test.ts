import { describe, it, expect } from "vitest";
import {
  buildCsv,
  buildXmp,
  xmpSidecarName,
  type FileExportRow,
} from "./export.js";

function row(partial: Partial<FileExportRow>): FileExportRow {
  return {
    fileId: "f1",
    filename: "IMG_0001.NEF",
    takenAt: null,
    rating: null,
    label: null,
    liked: false,
    perAccess: [],
    ...partial,
  };
}

describe("xmpSidecarName", () => {
  it("replaces the extension with .xmp", () => {
    expect(xmpSidecarName("IMG_1234.NEF")).toBe("IMG_1234.xmp");
    expect(xmpSidecarName("photo.cr3")).toBe("photo.xmp");
    expect(xmpSidecarName("a.b.c.dng")).toBe("a.b.c.xmp");
  });

  it("appends .xmp when no extension", () => {
    expect(xmpSidecarName("file")).toBe("file.xmp");
  });

  it("does not strip a leading dot", () => {
    expect(xmpSidecarName(".hidden")).toBe(".hidden.xmp");
  });
});

describe("buildXmp", () => {
  it("returns null when nothing is set", () => {
    expect(buildXmp(row({}))).toBeNull();
  });

  it("writes rating", () => {
    const xmp = buildXmp(row({ rating: 4 }))!;
    expect(xmp).toContain("<xmp:Rating>4</xmp:Rating>");
    expect(xmp).not.toContain("<xmp:Label>");
  });

  it("writes label", () => {
    const xmp = buildXmp(row({ label: "Green" }))!;
    expect(xmp).toContain("<xmp:Label>Green</xmp:Label>");
  });

  it("escapes special chars in label", () => {
    const xmp = buildXmp(row({ label: "<Tag & \"thing\">" }))!;
    expect(xmp).toContain("&lt;Tag &amp; &quot;thing&quot;&gt;");
  });

  it("treats liked-without-rating as rating 5", () => {
    const xmp = buildXmp(row({ liked: true }))!;
    expect(xmp).toContain("<xmp:Rating>5</xmp:Rating>");
  });

  it("includes the standard XMP wrapper", () => {
    const xmp = buildXmp(row({ rating: 3 }))!;
    expect(xmp).toContain("<?xpacket begin=");
    expect(xmp).toContain("<x:xmpmeta");
    expect(xmp).toContain("xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\"");
    expect(xmp).toContain("<?xpacket end=\"w\"?>");
  });
});

describe("buildCsv", () => {
  it("starts with BOM for Excel UTF-8 detection", () => {
    const csv = buildCsv([row({ filename: "a.jpg" })]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("has header row", () => {
    const csv = buildCsv([row({ filename: "a.jpg" })]);
    const lines = csv.replace(/^\ufeff/, "").split("\r\n");
    expect(lines[0]).toContain("Filename");
    expect(lines[0]).toContain("Rating");
    expect(lines[0]).toContain("Label");
  });

  it("includes per-access columns for every token seen", () => {
    const csv = buildCsv([
      row({
        filename: "a.jpg",
        perAccess: [
          { accessLabel: "Brautpaar", color: "green", rating: 5, liked: true, status: "pick" },
          { accessLabel: "Eltern", color: null, rating: 3, liked: false, status: null },
        ],
      }),
    ]);
    expect(csv).toContain("Brautpaar — Color");
    expect(csv).toContain("Eltern — Rating");
  });

  it("quotes fields containing commas and quotes", () => {
    const csv = buildCsv([row({ filename: 'has,comma "and" quotes.jpg' })]);
    // Doppelte Anführungszeichen werden verdoppelt
    expect(csv).toContain('has,comma ""and"" quotes.jpg');
  });

  it("uses CRLF line endings (Excel-friendly)", () => {
    const csv = buildCsv([row({ filename: "a.jpg" })]);
    expect(csv).toMatch(/\r\n/);
  });
});
