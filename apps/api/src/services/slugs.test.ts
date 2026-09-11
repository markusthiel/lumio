import { describe, it, expect } from "vitest";
import {
  validateSlugFormat,
  validateGallerySlugFormat,
  GALLERY_SLUG_MAX_LENGTH,
} from "./slugs.js";

describe("validateSlugFormat (tenant default: 3-30 chars)", () => {
  it("accepts a normal slug", () => {
    expect(validateSlugFormat("acme-studio")).toEqual({ ok: true });
  });

  it("rejects fewer than 3 chars", () => {
    const res = validateSlugFormat("ab");
    expect(res.ok).toBe(false);
    expect(res.error).toBe("too_short");
    expect(res.message).toContain("3");
  });

  it("rejects more than 30 chars", () => {
    const res = validateSlugFormat("a".repeat(31));
    expect(res.ok).toBe(false);
    expect(res.error).toBe("too_long");
    expect(res.message).toContain("30");
  });

  it("accepts exactly 30 chars", () => {
    expect(validateSlugFormat("a".repeat(30))).toEqual({ ok: true });
  });

  it("rejects uppercase, spaces and underscores", () => {
    expect(validateSlugFormat("Acme-Studio").error).toBe("invalid_chars");
    expect(validateSlugFormat("acme studio").error).toBe("invalid_chars");
    expect(validateSlugFormat("acme_studio").error).toBe("invalid_chars");
  });

  it("rejects leading or trailing hyphen", () => {
    expect(validateSlugFormat("-acme").error).toBe("leading_or_trailing_hyphen");
    expect(validateSlugFormat("acme-").error).toBe("leading_or_trailing_hyphen");
  });

  it("rejects double hyphen", () => {
    expect(validateSlugFormat("acme--studio").error).toBe("double_hyphen");
  });

  it("rejects reserved words", () => {
    expect(validateSlugFormat("studio").error).toBe("reserved");
    expect(validateSlugFormat("admin").error).toBe("reserved");
    expect(validateSlugFormat("www").error).toBe("reserved");
  });
});

describe("validateGallerySlugFormat (60-char max, path segment not a DNS label)", () => {
  it("shares the same min length as the tenant default", () => {
    const res = validateGallerySlugFormat("ab");
    expect(res.ok).toBe(false);
    expect(res.error).toBe("too_short");
  });

  it("accepts up to 60 chars, where the tenant default would reject", () => {
    const slug = "a".repeat(60);
    expect(slug.length).toBe(GALLERY_SLUG_MAX_LENGTH);
    expect(validateGallerySlugFormat(slug)).toEqual({ ok: true });
    expect(validateSlugFormat(slug).error).toBe("too_long");
  });

  it("rejects 61 chars with a message reflecting the 60-char limit", () => {
    const res = validateGallerySlugFormat("a".repeat(61));
    expect(res.ok).toBe(false);
    expect(res.error).toBe("too_long");
    expect(res.message).toContain("60");
  });

  it("still enforces the shared charset/hyphen rules", () => {
    expect(validateGallerySlugFormat("Foo Bar").error).toBe("invalid_chars");
    expect(validateGallerySlugFormat("-foo").error).toBe("leading_or_trailing_hyphen");
    expect(validateGallerySlugFormat("foo--bar").error).toBe("double_hyphen");
  });

  it("still rejects reserved words shared with the tenant list", () => {
    expect(validateGallerySlugFormat("admin").error).toBe("reserved");
    expect(validateGallerySlugFormat("login").error).toBe("reserved");
  });

  it("accepts a realistic long gallery name", () => {
    expect(validateGallerySlugFormat("smith-jones-wedding-photos-2026")).toEqual({
      ok: true,
    });
  });
});
