import { en } from "./en";
import { de } from "./de";
import { it } from "./it";

export type Locale = "en" | "de" | "it";

// Recursive Dict-Type. Bewusst auf String-Werte beschränkt — wir verschachteln
// per Sektion, nicht über JSON-Strukturen.
export interface Dict {
  [key: string]: string | Dict;
}

export const dictionaries: Record<Locale, Dict> = {
  en,
  de,
  it,
};
