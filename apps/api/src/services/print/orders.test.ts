import { describe, expect, it } from "vitest";
import { isMissingRequiredPaymentReference } from "./orders.js";

describe("isMissingRequiredPaymentReference", () => {
  it("requires a reference for mark_paid on an offline_invoice order", () => {
    expect(
      isMissingRequiredPaymentReference("mark_paid", "offline_invoice", undefined)
    ).toBe(true);
    expect(
      isMissingRequiredPaymentReference("mark_paid", "offline_invoice", "")
    ).toBe(true);
    expect(
      isMissingRequiredPaymentReference("mark_paid", "offline_invoice", "   ")
    ).toBe(true);
  });

  it("is satisfied once a non-blank reference is given", () => {
    expect(
      isMissingRequiredPaymentReference("mark_paid", "offline_invoice", "INV-2026-042")
    ).toBe(false);
  });

  it("never requires a reference for stripe_connect orders", () => {
    expect(
      isMissingRequiredPaymentReference("mark_paid", "stripe_connect", undefined)
    ).toBe(false);
  });

  it("never requires a reference for transitions other than mark_paid", () => {
    expect(
      isMissingRequiredPaymentReference("mark_shipped", "offline_invoice", undefined)
    ).toBe(false);
    expect(
      isMissingRequiredPaymentReference("cancel", "offline_invoice", undefined)
    ).toBe(false);
  });
});
