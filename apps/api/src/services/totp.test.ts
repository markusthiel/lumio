import { describe, it, expect } from "vitest";
import {
  generate as otplibGenerate,
  verify as otplibVerify,
  generateSecret,
} from "otplib";
import { createLoginChallenge, verifyLoginChallenge } from "./loginChallenge.js";

describe("otplib roundtrip", () => {
  it("generates and verifies a TOTP", async () => {
    const secret = generateSecret();
    const token = await otplibGenerate({ secret });
    const result = await otplibVerify({ secret, token });
    expect(result.valid).toBe(true);
  });

  it("rejects a wrong token", async () => {
    const secret = generateSecret();
    const result = await otplibVerify({ secret, token: "000000" });
    expect(result.valid).toBe(false);
  });
});

describe("login challenge", () => {
  const ctx = {
    ipAddress: "192.0.2.1",
    userAgent: "Mozilla/5.0 (Test)",
  };

  it("round-trips a valid challenge", () => {
    const challenge = createLoginChallenge({
      userId: "11111111-1111-1111-1111-111111111111",
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    const claims = verifyLoginChallenge(challenge, ctx);
    expect(claims).not.toBeNull();
    expect(claims?.uid).toBe("11111111-1111-1111-1111-111111111111");
    expect(claims?.exp).toBeGreaterThan(Date.now());
  });

  it("rejects when IP changes", () => {
    const challenge = createLoginChallenge({
      userId: "u1",
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    const result = verifyLoginChallenge(challenge, {
      ipAddress: "203.0.113.5",
      userAgent: ctx.userAgent,
    });
    expect(result).toBeNull();
  });

  it("rejects when user agent changes", () => {
    const challenge = createLoginChallenge({
      userId: "u1",
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    const result = verifyLoginChallenge(challenge, {
      ipAddress: ctx.ipAddress,
      userAgent: "Different",
    });
    expect(result).toBeNull();
  });

  it("rejects tampered payload", () => {
    const challenge = createLoginChallenge({
      userId: "u1",
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    const [payload, sig] = challenge.split(".");
    const tampered = `${payload}A.${sig}`;
    expect(verifyLoginChallenge(tampered, ctx)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(verifyLoginChallenge("", ctx)).toBeNull();
    expect(verifyLoginChallenge("not-a-token", ctx)).toBeNull();
    expect(verifyLoginChallenge("a.b.c", ctx)).toBeNull();
  });
});
