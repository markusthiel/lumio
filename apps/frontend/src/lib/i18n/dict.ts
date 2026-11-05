import { en } from "./en";
import { de } from "./de";
import { it } from "./it";
import { fi } from "./fi";
import { fr } from "./fr";

export type Locale = "en" | "de" | "it" | "fi" | "fr";

// Recursive Dict-Type. Bewusst auf String-Werte beschränkt — wir verschachteln
// per Sektion, nicht über JSON-Strukturen.
//
// Für den Lookup zur Laufzeit; als Typ für eine Sprachdatei ist eine
// Index-Signatur zu schwach: sie erlaubt jede Teilmenge. Dafür LocaleDict.
export interface Dict {
  [key: string]: string | Dict;
}

/**
 * Struktur einer vollständigen Sprachdatei, abgeleitet aus en.ts.
 *
 * Vorher waren alle Sprachdateien als `Dict` typisiert — eine
 * Index-Signatur, die jede Teilmenge durchgehen lässt. Eine Datei mit der
 * Hälfte der Keys hat sauber typgeprüft, obwohl CONTRIBUTING.md
 * Übersetzern zusagte, `tsc --noEmit` fange fehlende Keys. Tat es nicht;
 * gemeldet von canja006 in Issue #12.
 *
 * `npm run check:i18n` hat das schon gefangen, aber ein Compilerfehler beim
 * Tippen ist besser als ein Skript, das man laufen lassen muss.
 */
export type LocaleDict = typeof en;

export const dictionaries: Record<Locale, LocaleDict> = {
  en,
  de,
  it,
  fi,
  fr,
};
