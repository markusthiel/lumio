import { describe, it, expect } from "vitest";
import {
  createVisitorToken,
  verifyVisitorToken,
  visitorCookieName,
} from "./visitor.js";

describe("visitor token", () => {
  it("round-trips a valid token", () => {
    const token = createVisitorToken({
      gid: "11111111-1111-1111-1111-111111111111",
      aid: "22222222-2222-2222-2222-222222222222",
      pw: true,
    });
    const claims = verifyVisitorToken(token);
    expect(claims).not.toBeNull();
    expect(claims?.gid).toBe("11111111-1111-1111-1111-111111111111");
    expect(claims?.aid).toBe("22222222-2222-2222-2222-222222222222");
    expect(claims?.pw).toBe(true);
    expect(claims?.exp).toBeGreaterThan(Date.now());
  });

  it("supports null accessId (anonymous visitor)", () => {
    const token = createVisitorToken({
      gid: "11111111-1111-1111-1111-111111111111",
      aid: null,
      pw: false,
    });
    const claims = verifyVisitorToken(token);
    expect(claims?.aid).toBeNull();
    expect(claims?.pw).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const token = createVisitorToken({
      gid: "11111111-1111-1111-1111-111111111111",
      aid: null,
      pw: false,
    });
    // Mit dem Signaturteil hantieren
    const [payload, sig] = token.split(".");
    const tampered = `${payload}A.${sig}`;
    expect(verifyVisitorToken(tampered)).toBeNull();
  });

  it("rejects a token with bad signature", () => {
    const token = createVisitorToken({
      gid: "11111111-1111-1111-1111-111111111111",
      aid: null,
      pw: false,
    });
    const [payload] = token.split(".");
    expect(verifyVisitorToken(`${payload}.AAAA`)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(verifyVisitorToken("")).toBeNull();
    expect(verifyVisitorToken("not-a-token")).toBeNull();
    expect(verifyVisitorToken("a.b.c")).toBeNull();
  });

  it("derives a cookie name from gallery id", () => {
    const name = visitorCookieName("11111111-1111-1111-1111-111111111111");
    expect(name).toMatch(/^lumio_v_/);
    expect(name).not.toMatch(/-/); // dashes raus
  });
});
