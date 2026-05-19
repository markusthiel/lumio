import { describe, it, expect } from "vitest";
import { hashFileIds } from "./zip.js";

describe("hashFileIds", () => {
  it("returns null for empty input", () => {
    expect(hashFileIds(null)).toBeNull();
    expect(hashFileIds([])).toBeNull();
  });

  it("is stable for the same set", () => {
    const a = hashFileIds(["a", "b", "c"]);
    const b = hashFileIds(["a", "b", "c"]);
    expect(a).toBe(b);
    expect(a).toHaveLength(32);
  });

  it("is order-independent", () => {
    expect(hashFileIds(["a", "b", "c"])).toBe(hashFileIds(["c", "a", "b"]));
  });

  it("differs for different sets", () => {
    expect(hashFileIds(["a", "b"])).not.toBe(hashFileIds(["a", "c"]));
  });
});
