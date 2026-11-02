import { describe, it, expect } from "vitest";
import { uploadFailureHint } from "./files.js";

describe("uploadFailureHint", () => {
  it("points at bucket CORS for network errors and names the origin", () => {
    const h = uploadFailureHint({ kind: "network", targetHost: "s3.example.com", pageHost: "gallery.kunde.de" });
    expect(h).toContain("CORS");
    expect(h).toContain("https://gallery.kunde.de");
    expect(h).toContain("s3.example.com");
  });
  it("explains a missing ETag", () => {
    expect(uploadFailureHint({ kind: "etag" })).toContain("ETag");
  });
  it("explains a rejected signature", () => {
    expect(uploadFailureHint({ kind: "http", httpStatus: 403 })).toContain("signed URL");
  });
  it("returns nothing for unclassified errors", () => {
    expect(uploadFailureHint({ kind: "http", httpStatus: 500 })).toBeUndefined();
    expect(uploadFailureHint({ kind: "other" })).toBeUndefined();
  });
});
