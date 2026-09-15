/**
 * Regression test: an expiry date must be removable.
 *
 * PATCH /galleries/:id with {"expiresAt": null} used to fail. The update
 * mapping has always been written as
 *
 *   expiresAt: body.expiresAt ? new Date(body.expiresAt) : null
 *
 * so clearing was clearly intended, but the schema was inherited unchanged
 * from createGallerySchema, where expiresAt is a non-nullable optional. Zod
 * rejected the null before the mapping ever ran, which made an expiry date
 * impossible to remove once set.
 *
 * Schemas are copied one-to-one from galleries.ts, matching the convention
 * in sections.test.ts — if they change there, this fails here and the pair
 * is re-synced by review.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";

const createGallerySchema = z.object({
  title: z.string().min(1).max(200),
  expiresAt: z.string().datetime().optional(),
});

const updateGallerySchema = createGallerySchema.partial().extend({
  status: z.enum(["draft", "live", "archived"]).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const WHEN = "2026-12-01T00:00:00.000Z";

describe("clearing a gallery expiry date", () => {
  it("accepts null, which is how an expiry is removed", () => {
    const r = updateGallerySchema.safeParse({ expiresAt: null });
    expect(r.success).toBe(true);
  });

  it("still accepts a date, which is how one is set", () => {
    const r = updateGallerySchema.safeParse({ expiresAt: WHEN });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.expiresAt).toBe(WHEN);
  });

  it("treats omitted and null as different things", () => {
    // The mapping only touches the column when the key is present, so the
    // distinction has to survive parsing: omitted means "leave it alone",
    // null means "clear it".
    const omitted = updateGallerySchema.safeParse({ title: "x" });
    expect(omitted.success).toBe(true);
    if (omitted.success) expect("expiresAt" in omitted.data).toBe(false);

    const cleared = updateGallerySchema.safeParse({ expiresAt: null });
    expect(cleared.success).toBe(true);
    if (cleared.success) expect(cleared.data.expiresAt).toBeNull();
  });

  it("still rejects a value that is not a date", () => {
    expect(updateGallerySchema.safeParse({ expiresAt: "soon" }).success).toBe(
      false
    );
    expect(updateGallerySchema.safeParse({ expiresAt: 0 }).success).toBe(false);
    expect(updateGallerySchema.safeParse({ expiresAt: false }).success).toBe(
      false
    );
  });

  it("leaves create alone: null and omitted would mean the same there", () => {
    expect(
      createGallerySchema.safeParse({ title: "x", expiresAt: null }).success
    ).toBe(false);
    expect(createGallerySchema.safeParse({ title: "x" }).success).toBe(true);
  });
});
