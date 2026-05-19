/**
 * Lumio API — Selection-Limit-Check
 *
 * Reine Entscheidungslogik, ob ein Kunde aktuell einen Like/Pick setzen
 * darf. Die DB-Lookups bleiben im Aufrufer, damit dieser Helper testbar
 * bleibt ohne Prisma-Mocking.
 *
 * Aufruf-Erwartung:
 *
 *   const decision = checkSelectionLimit({
 *     willPick: body.status === "pick" || body.liked === true,
 *     limit: gallery.selectionLimit,        // number | null
 *     currentOtherPicks: ...,               // ohne das aktuelle File
 *   });
 *   if (decision.allowed === false) return reply.status(409).send(...)
 *
 * `currentOtherPicks` heißt: die Anzahl der schon-gewählten Items, mit
 * dem aktuellen File ausgeschlossen. Damit ist das Verhalten beim
 * Re-Like-Toggle korrekt: wer ein File schon geliked hat und nochmal
 * draufklickt, zählt nicht doppelt.
 */

export type SelectionLimitDecision =
  | { allowed: true }
  | { allowed: false; limit: number };

export function checkSelectionLimit(input: {
  willPick: boolean;
  limit: number | null | undefined;
  currentOtherPicks: number;
}): SelectionLimitDecision {
  // Keine Pick-Aktion → immer erlaubt (Color, Rating, Kommentar etc.
  // zählen nicht gegen das Limit. Color ist privates Sortierwerkzeug,
  // Rating gibt's auf der Customer-Seite ohnehin nur als Anzeige.)
  if (!input.willPick) return { allowed: true };

  // Kein Limit gesetzt → unbegrenzt
  if (input.limit === null || input.limit === undefined) {
    return { allowed: true };
  }

  // 0 oder negativ wäre Konfigurationsunsinn; verhalten uns wie "kein Limit"
  // statt "keine Auswahl erlaubt", damit eine fehlerhafte Eingabe im Studio
  // nicht die Galerie für alle Kunden bricht.
  if (input.limit <= 0) return { allowed: true };

  if (input.currentOtherPicks >= input.limit) {
    return { allowed: false, limit: input.limit };
  }
  return { allowed: true };
}
