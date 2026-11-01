import { describe, it, expect } from "vitest";
import { FILE_ORDER_BY, nextFileSortIndex } from "./file-order.js";

function fakeDb(max: number | null) {
  return {
    file: {
      aggregate: async () => ({ _max: { sortIndex: max } }),
    },
  } as unknown as Parameters<typeof nextFileSortIndex>[0];
}

describe("nextFileSortIndex", () => {
  it("starts at 0 in an empty gallery", async () => {
    expect(await nextFileSortIndex(fakeDb(null), "g")).toBe(0);
  });

  it("appends after the highest existing index", async () => {
    expect(await nextFileSortIndex(fakeDb(41), "g")).toBe(42);
  });
});

describe("FILE_ORDER_BY", () => {
  it("breaks sortIndex ties by upload time, then id", () => {
    expect(FILE_ORDER_BY).toEqual([
      { sortIndex: "asc" },
      { createdAt: "asc" },
      { id: "asc" },
    ]);
  });
});
