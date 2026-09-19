import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * tenantPublicOrigin(): Custom Domain > Subdomain (nur Multi-Mode) >
 * PUBLIC_URL. Der Single-Mode-Fall mit gesetzter LUMIO_DOMAIN_BASE ist
 * der stille: ohne Guard wuerde jeder Galerie-Link zu default.<base>.
 */
const cfg = vi.hoisted(() => ({
  PUBLIC_URL: "https://app.example.test",
  DEPLOYMENT_MODE: "multi" as "single" | "multi",
  LUMIO_DOMAIN_BASE: undefined as string | undefined,
}));

vi.mock("../config.js", () => ({ config: cfg }));

const origin = async (tenant: { slug: string; customDomain: string | null }) =>
  (await import("./tenant.js")).tenantPublicOrigin(tenant);

describe("tenantPublicOrigin", () => {
  beforeEach(() => {
    vi.resetModules();
    cfg.PUBLIC_URL = "https://app.example.test";
    cfg.DEPLOYMENT_MODE = "multi";
    cfg.LUMIO_DOMAIN_BASE = undefined;
  });

  it("uses the custom domain when the tenant has one", async () => {
    cfg.LUMIO_DOMAIN_BASE = "lumio.example";
    expect(
      await origin({ slug: "mueller", customDomain: "studio-mueller.de" })
    ).toBe("https://studio-mueller.de");
  });

  it("uses <slug>.<base> in multi mode without a custom domain", async () => {
    cfg.LUMIO_DOMAIN_BASE = "lumio.example";
    expect(await origin({ slug: "mueller", customDomain: null })).toBe(
      "https://mueller.lumio.example"
    );
  });

  it("falls back to PUBLIC_URL when neither is available", async () => {
    expect(await origin({ slug: "mueller", customDomain: null })).toBe(
      "https://app.example.test"
    );
  });

  it("ignores LUMIO_DOMAIN_BASE in single mode", async () => {
    cfg.DEPLOYMENT_MODE = "single";
    cfg.LUMIO_DOMAIN_BASE = "lumio.example";
    expect(await origin({ slug: "default", customDomain: null })).toBe(
      "https://app.example.test"
    );
  });

  it("takes the scheme from PUBLIC_URL, not NODE_ENV", async () => {
    cfg.PUBLIC_URL = "http://localhost:3000";
    cfg.LUMIO_DOMAIN_BASE = "lumio.example";
    expect(await origin({ slug: "mueller", customDomain: null })).toBe(
      "http://mueller.lumio.example"
    );
    expect(
      await origin({ slug: "mueller", customDomain: "studio-mueller.de" })
    ).toBe("http://studio-mueller.de");
  });

  it("trims and lowercases LUMIO_DOMAIN_BASE", async () => {
    cfg.LUMIO_DOMAIN_BASE = "  Lumio.Example \n";
    expect(await origin({ slug: "mueller", customDomain: null })).toBe(
      "https://mueller.lumio.example"
    );
  });
});
