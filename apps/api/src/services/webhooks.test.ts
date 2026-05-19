import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { signPayload, isSupportedEvent, SUPPORTED_EVENTS } from "./webhooks.js";

/**
 * Webhook-Signing-Tests. Das Format MUSS bitgenau zur Python-Seite
 * passen (apps/worker/tasks/webhook_delivery.py._sign), sonst akzeptiert
 * kein Empfänger unsere Signaturen — egal welche Seite die Auslieferung
 * macht.
 */
describe("signPayload", () => {
  it("produces a sha256=hex digest", () => {
    const sig = signPayload({
      body: '{"a":1}',
      secret: "k",
      timestamp: 100,
    });
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("matches the known-good hmac construction (timestamp.body)", () => {
    const body = '{"hello":"world"}';
    const ts = 1700000000;
    const secret = "test_secret";
    const sig = signPayload({ body, secret, timestamp: ts });

    // Direkte Berechnung — wenn jemand die Konkatenation ändert
    // (z.B. Newline statt Punkt), fliegt der Test.
    const expected =
      "sha256=" +
      createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
    expect(sig).toBe(expected);
  });

  it("changes when timestamp differs", () => {
    const s1 = signPayload({ body: "x", secret: "k", timestamp: 1 });
    const s2 = signPayload({ body: "x", secret: "k", timestamp: 2 });
    expect(s1).not.toBe(s2);
  });

  it("changes when body differs", () => {
    const s1 = signPayload({ body: "x", secret: "k", timestamp: 1 });
    const s2 = signPayload({ body: "y", secret: "k", timestamp: 1 });
    expect(s1).not.toBe(s2);
  });

  it("changes when secret differs", () => {
    const s1 = signPayload({ body: "x", secret: "a", timestamp: 1 });
    const s2 = signPayload({ body: "x", secret: "b", timestamp: 1 });
    expect(s1).not.toBe(s2);
  });
});

describe("isSupportedEvent", () => {
  it("accepts all whitelisted events", () => {
    for (const e of SUPPORTED_EVENTS) {
      expect(isSupportedEvent(e)).toBe(true);
    }
  });

  it("rejects unknown events", () => {
    expect(isSupportedEvent("gallery.created.foo")).toBe(false);
    expect(isSupportedEvent("")).toBe(false);
    expect(isSupportedEvent("selection.finalised")).toBe(false); // wrong spelling
    expect(isSupportedEvent("Gallery.Created")).toBe(false); // case
  });
});
