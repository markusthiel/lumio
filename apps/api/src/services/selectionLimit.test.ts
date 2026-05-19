import { describe, it, expect } from "vitest";
import { checkSelectionLimit } from "./selectionLimit.js";

describe("checkSelectionLimit", () => {
  it("always allows when no pick is being attempted", () => {
    // Color/Rating-Setzen oder Like wegnehmen — willPick=false
    expect(
      checkSelectionLimit({
        willPick: false,
        limit: 5,
        currentOtherPicks: 99,
      })
    ).toEqual({ allowed: true });
  });

  it("allows when no limit is set", () => {
    expect(
      checkSelectionLimit({ willPick: true, limit: null, currentOtherPicks: 100 })
    ).toEqual({ allowed: true });
    expect(
      checkSelectionLimit({
        willPick: true,
        limit: undefined,
        currentOtherPicks: 100,
      })
    ).toEqual({ allowed: true });
  });

  it("allows a pick when below the limit", () => {
    expect(
      checkSelectionLimit({ willPick: true, limit: 10, currentOtherPicks: 9 })
    ).toEqual({ allowed: true });
  });

  it("rejects a pick when at the limit", () => {
    // 10 schon ausgewählt (ohne das aktuelle File), Limit 10 → kein neuer
    expect(
      checkSelectionLimit({ willPick: true, limit: 10, currentOtherPicks: 10 })
    ).toEqual({ allowed: false, limit: 10 });
  });

  it("rejects a pick when over the limit", () => {
    // Sollte nicht passieren, aber defensive sicherheitshalber
    expect(
      checkSelectionLimit({ willPick: true, limit: 10, currentOtherPicks: 15 })
    ).toEqual({ allowed: false, limit: 10 });
  });

  it("treats limit <= 0 as 'no limit' (fail-open, not fail-closed)", () => {
    // Wenn ein Studio versehentlich 0 oder negativ einträgt, wollen wir
    // nicht die ganze Galerie blockieren — Kunden würden gar nichts mehr
    // auswählen können. Lieber wie unbegrenzt behandeln.
    expect(
      checkSelectionLimit({ willPick: true, limit: 0, currentOtherPicks: 0 })
    ).toEqual({ allowed: true });
    expect(
      checkSelectionLimit({ willPick: true, limit: -5, currentOtherPicks: 0 })
    ).toEqual({ allowed: true });
  });

  it("handles the re-like edge case via currentOtherPicks", () => {
    // Kunde hat schon 10 Items geliked (Limit), klickt nun erneut auf
    // eines davon, um es abzuwählen. Der Aufrufer übergibt
    // currentOtherPicks=9 (eigenes File ausgenommen). Sollte erlauben —
    // weil Like-Toggle effektiv ja gar nicht über Limit hinausgeht.
    expect(
      checkSelectionLimit({ willPick: true, limit: 10, currentOtherPicks: 9 })
    ).toEqual({ allowed: true });
  });
});
