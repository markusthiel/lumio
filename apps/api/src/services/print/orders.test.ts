import { describe, expect, it } from "vitest";
import { allowedTransitionsFor } from "./orders.js";

describe("allowedTransitionsFor", () => {
  it("is identical for courier and pickup up to in_production", () => {
    for (const isPickupDelivery of [false, true]) {
      expect(allowedTransitionsFor("draft", isPickupDelivery)).toEqual(["cancel"]);
      expect(allowedTransitionsFor("pending_payment", isPickupDelivery)).toEqual([
        "mark_paid",
        "cancel",
      ]);
      expect(allowedTransitionsFor("paid", isPickupDelivery)).toEqual([
        "mark_in_production",
        "cancel",
        "refund",
      ]);
    }
  });

  it("forks in_production on isPickupDelivery", () => {
    expect(allowedTransitionsFor("in_production", false)).toEqual([
      "mark_shipped",
      "cancel",
      "refund",
    ]);
    expect(allowedTransitionsFor("in_production", true)).toEqual([
      "mark_ready_for_pickup",
      "cancel",
      "refund",
    ]);
  });

  it("only allows the pickup-side status when isPickupDelivery, and vice versa", () => {
    // A courier order can never reach ready_for_pickup, and a pickup
    // order can never reach shipped — but if it somehow did (e.g. a
    // stale isPickupDelivery flag), both dead-end statuses still allow
    // mark_delivered/refund so the order isn't stuck.
    expect(allowedTransitionsFor("shipped", false)).toEqual(["mark_delivered", "refund"]);
    expect(allowedTransitionsFor("shipped", true)).toEqual(["mark_delivered", "refund"]);
    expect(allowedTransitionsFor("ready_for_pickup", true)).toEqual([
      "mark_delivered",
      "refund",
    ]);
    expect(allowedTransitionsFor("ready_for_pickup", false)).toEqual([
      "mark_delivered",
      "refund",
    ]);
  });

  it("both paths converge on the shared delivered terminal status", () => {
    expect(allowedTransitionsFor("delivered", false)).toEqual(["refund"]);
    expect(allowedTransitionsFor("delivered", true)).toEqual(["refund"]);
  });

  it("terminal statuses allow nothing further", () => {
    expect(allowedTransitionsFor("cancelled", false)).toEqual([]);
    expect(allowedTransitionsFor("refunded", true)).toEqual([]);
  });

  it("unknown status allows nothing", () => {
    expect(allowedTransitionsFor("bogus", false)).toEqual([]);
  });
});
