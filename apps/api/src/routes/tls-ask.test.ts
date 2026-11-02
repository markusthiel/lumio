import { describe, it, expect } from "vitest";
import { normalizeAskDomain } from "./tls-ask.js";

describe("normalizeAskDomain", () => {
  it("accepts and lowercases a normal domain", () => {
    expect(normalizeAskDomain("Gallery.Project-Motion.de")).toBe("gallery.project-motion.de");
  });
  it("strips a trailing dot", () => {
    expect(normalizeAskDomain("foto.example.com.")).toBe("foto.example.com");
  });
  it("rejects bare labels, IPs-with-ports and junk", () => {
    expect(normalizeAskDomain("localhost")).toBeNull();
    expect(normalizeAskDomain("1.2.3.4:443")).toBeNull();
    expect(normalizeAskDomain("evil.com/../x")).toBeNull();
    expect(normalizeAskDomain("")).toBeNull();
    expect(normalizeAskDomain(undefined)).toBeNull();
    expect(normalizeAskDomain(["a.de"])).toBeNull();
  });
  it("rejects overlong input", () => {
    expect(normalizeAskDomain("a".repeat(251) + ".de")).toBeNull();
  });
});
