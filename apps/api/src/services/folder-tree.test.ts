import { describe, it, expect } from "vitest";
import {
  MAX_FOLDER_DEPTH,
  countGalleries,
  depthOf,
  descendantIds,
  fitsDepth,
  siblingWithName,
  subtreeHeight,
  visibleFolderIds,
  wouldCreateCycle,
  type FolderNode,
} from "./folder-tree.js";
import { expandTagIdsFrom } from "./tag-tree.js";

// Kunde › Land › Stadt, wie in #73
const tree: FolderNode[] = [
  { id: "meyer", parentId: null, name: "Meyer Reisen" },
  { id: "fr", parentId: "meyer", name: "Frankreich" },
  { id: "paris", parentId: "fr", name: "Paris" },
  { id: "lyon", parentId: "fr", name: "Lyon" },
  { id: "it", parentId: "meyer", name: "Italien" },
  { id: "alpen", parentId: null, name: "Alpenhotel" },
];

describe("folder tree", () => {
  it("finds all descendants", () => {
    expect([...descendantIds(tree, "meyer")].sort()).toEqual(["fr", "it", "lyon", "paris"]);
    expect(descendantIds(tree, "paris").size).toBe(0);
  });

  it("measures depth and subtree height", () => {
    expect(depthOf(tree, null)).toBe(0);
    expect(depthOf(tree, "meyer")).toBe(1);
    expect(depthOf(tree, "paris")).toBe(3);
    expect(subtreeHeight(tree, "meyer")).toBe(3);
    expect(subtreeHeight(tree, "paris")).toBe(1);
  });

  it("rejects moving a folder into itself or below itself", () => {
    expect(wouldCreateCycle(tree, "fr", "fr")).toBe(true);
    expect(wouldCreateCycle(tree, "fr", "paris")).toBe(true);
    expect(wouldCreateCycle(tree, "fr", "alpen")).toBe(false);
    expect(wouldCreateCycle(tree, "fr", null)).toBe(false);
  });

  it("enforces the depth limit for a moved subtree", () => {
    const chain: FolderNode[] = [];
    for (let i = 0; i < MAX_FOLDER_DEPTH; i++) {
      chain.push({ id: `c${i}`, parentId: i === 0 ? null : `c${i - 1}`, name: `c${i}` });
    }
    // c19 sits at the maximum depth: nothing fits below it.
    expect(fitsDepth(chain, null, `c${MAX_FOLDER_DEPTH - 1}`)).toBe(false);
    expect(fitsDepth(chain, null, `c${MAX_FOLDER_DEPTH - 2}`)).toBe(true);
    // A three-level subtree needs three free levels.
    // c16 sits at depth 17, so 17 + 3 = 20 still fits; c17 (depth 18) does not.
    expect(fitsDepth([...chain, ...tree], "meyer", `c${MAX_FOLDER_DEPTH - 4}`)).toBe(true);
    expect(fitsDepth([...chain, ...tree], "meyer", `c${MAX_FOLDER_DEPTH - 3}`)).toBe(false);
  });

  it("matches sibling names case-insensitively, only within the same parent", () => {
    expect(siblingWithName(tree, "fr", "  paris ")?.id).toBe("paris");
    expect(siblingWithName(tree, "it", "Paris")).toBeUndefined();
    expect(siblingWithName(tree, "fr", "Paris", "paris")).toBeUndefined();
  });

  it("counts galleries directly and including subfolders", () => {
    const c = countGalleries(tree, new Map([["fr", 1], ["paris", 3], ["lyon", 2]]));
    expect(c.get("paris")).toEqual({ direct: 3, deep: 3 });
    expect(c.get("fr")).toEqual({ direct: 1, deep: 6 });
    expect(c.get("meyer")).toEqual({ direct: 0, deep: 6 });
    expect(c.get("alpen")).toEqual({ direct: 0, deep: 0 });
  });

  it("hides folders whose galleries all belong to others, keeps empty ones and the path", () => {
    const total = countGalleries(tree, new Map([["paris", 2], ["lyon", 1], ["it", 4]]));
    const mine = countGalleries(tree, new Map([["lyon", 1]]));
    const v = visibleFolderIds(tree, total, mine);
    expect(v.has("lyon")).toBe(true);
    expect(v.has("fr")).toBe(true); // ancestor of a visible folder
    expect(v.has("meyer")).toBe(true);
    expect(v.has("paris")).toBe(false); // only someone else's galleries
    expect(v.has("it")).toBe(false);
    expect(v.has("alpen")).toBe(true); // empty, so everyone can file into it
  });
});

describe("tag expansion", () => {
  it("includes child tags when filtering by a parent tag", () => {
    const tags = [
      { id: "kunde", parentId: null },
      { id: "fr", parentId: "kunde" },
      { id: "paris", parentId: "fr" },
      { id: "other", parentId: null },
    ];
    const m = expandTagIdsFrom(tags, ["kunde", "paris"]);
    expect(m.get("kunde")?.sort()).toEqual(["fr", "kunde", "paris"]);
    expect(m.get("paris")).toEqual(["paris"]);
  });
});
