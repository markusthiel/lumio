import { describe, it, expect } from "vitest";

/**
 * Validations für den Bulk-Action-Endpoint isoliert in einem Helper getestet.
 * Die DB-Pfade decken wir mit Integration-Tests ab (siehe apps/worker
 * für das Pattern).
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateBulkRequest(body: unknown): { ok: true } | { error: string } {
  if (!body || typeof body !== "object") return { error: "bad_request" };
  const b = body as Record<string, unknown>;
  if (typeof b.galleryId !== "string") return { error: "bad_request" };
  if (!Array.isArray(b.fileIds)) return { error: "bad_request" };
  if (b.fileIds.length === 0) return { error: "bad_request" };
  if (b.fileIds.length > 500) return { error: "bad_request" };
  if (!["delete", "hide", "show"].includes(b.action as string)) {
    return { error: "bad_request" };
  }
  if (
    !(b.fileIds as unknown[]).every(
      (id) => typeof id === "string" && UUID_RE.test(id)
    )
  ) {
    return { error: "bad_file_id" };
  }
  return { ok: true };
}

describe("bulk-action validation", () => {
  const ok = {
    galleryId: "00000000-0000-0000-0000-000000000001",
    fileIds: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"],
    action: "delete",
  };

  it("accepts a valid request", () => {
    expect(validateBulkRequest(ok)).toEqual({ ok: true });
  });

  it("rejects empty fileIds", () => {
    expect(validateBulkRequest({ ...ok, fileIds: [] })).toEqual({
      error: "bad_request",
    });
  });

  it("rejects more than 500 fileIds", () => {
    const ids = Array.from(
      { length: 501 },
      (_, i) => `aaaaaaaa-aaaa-aaaa-aaaa-${i.toString().padStart(12, "0")}`
    );
    expect(validateBulkRequest({ ...ok, fileIds: ids })).toEqual({
      error: "bad_request",
    });
  });

  it("rejects unknown action", () => {
    expect(validateBulkRequest({ ...ok, action: "nuke" })).toEqual({
      error: "bad_request",
    });
  });

  it("rejects non-UUID fileIds", () => {
    expect(
      validateBulkRequest({ ...ok, fileIds: ["not-a-uuid"] })
    ).toEqual({ error: "bad_file_id" });
    expect(
      validateBulkRequest({ ...ok, fileIds: ["'); DROP TABLE files; --"] })
    ).toEqual({ error: "bad_file_id" });
  });

  it("accepts the three allowed actions", () => {
    for (const a of ["delete", "hide", "show"]) {
      expect(validateBulkRequest({ ...ok, action: a })).toEqual({
        ok: true,
      });
    }
  });

  it("rejects missing galleryId", () => {
    expect(validateBulkRequest({ ...ok, galleryId: undefined })).toEqual({
      error: "bad_request",
    });
  });
});
