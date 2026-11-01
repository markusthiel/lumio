import { describe, it, expect } from "vitest";
import { FILE_ORDER_BY, nextFileSortIndex, sortFilesBy } from "./file-order.js";

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

describe("sortFilesBy", () => {
  const f = (id: string, name: string, taken: string | null) => ({
    id,
    originalFilename: name,
    takenAt: taken ? new Date(taken) : null,
  });

  it("sorts filenames naturally and case-insensitively", () => {
    const files = [f("a", "IMG_10.jpg", null), f("b", "img_2.jpg", null), f("c", "IMG_1.jpg", null)];
    expect(sortFilesBy(files, "filename").map((x) => x.id)).toEqual(["c", "b", "a"]);
  });

  it("sorts by capture date and puts files without one last, in their old order", () => {
    const files = [
      f("x", "x.jpg", null),
      f("late", "l.jpg", "2026-05-02T10:00:00Z"),
      f("y", "y.jpg", null),
      f("early", "e.jpg", "2026-05-01T10:00:00Z"),
    ];
    expect(sortFilesBy(files, "takenAt").map((x) => x.id)).toEqual(["early", "late", "x", "y"]);
  });

  it("does not mutate the input", () => {
    const files = [f("b", "b.jpg", null), f("a", "a.jpg", null)];
    sortFilesBy(files, "filename");
    expect(files.map((x) => x.id)).toEqual(["b", "a"]);
  });
});
