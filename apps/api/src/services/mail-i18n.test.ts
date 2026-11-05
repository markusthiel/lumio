/**
 * Tests for the mail locale helpers.
 *
 * The formatting assertions guard a class of bug the codebase was carrying:
 * dates and currency were formatted with `l === "de" ? "de-DE" : "en-GB"`,
 * repeated in twelve places. That works by accident for exactly two locales
 * and silently mis-formats every further one, since anything that is not
 * German falls through to British English. CONTRIBUTING.md forbids hardcoding
 * a locale identifier in Intl.*; these tests make the ban enforceable instead
 * of a convention.
 */
import { describe, it, expect } from "vitest";
import {
  localeTag,
  normalizeLocale,
  phrase,
  interpolate,
  MAIL_LOCALES,
  type MailLocale,
  type Phrase,
} from "./mail-i18n.js";

// MAIL_LOCALES itself, not a re-typed literal. A manually kept-in-sync array
// only "fails to satisfy MailLocale[]" in a comment, never in the compiler:
// a plain MailLocale[] happily accepts any subset of the union, which is how
// this stayed at two locales silently after "it" was added to the type.
const LOCALES: readonly MailLocale[] = MAIL_LOCALES;

const LONG_DATE = {
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
} as const;

describe("localeTag", () => {
  it("returns a BCP-47 tag for every supported locale", () => {
    for (const l of LOCALES) {
      expect(localeTag(l)).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
    }
  });

  it("gives every locale its own tag", () => {
    expect(new Set(LOCALES.map(localeTag)).size).toBe(LOCALES.length);
  });

  it("formats a date in each locale's own convention", () => {
    const d = new Date(Date.UTC(2026, 8, 30));
    // German puts a dot after the day number, British English does not.
    expect(d.toLocaleDateString(localeTag("de"), LONG_DATE)).toContain("30.");
    expect(d.toLocaleDateString(localeTag("en"), LONG_DATE)).not.toContain(
      "30."
    );
  });

  it("formats currency in each locale's own convention", () => {
    const eur = { style: "currency", currency: "EUR" } as const;
    // German uses a decimal comma, English a decimal point.
    expect((1234.5).toLocaleString(localeTag("de"), eur)).toMatch(/1\D?234,50/);
    expect((1234.5).toLocaleString(localeTag("en"), eur)).toMatch(/1,234\.50/);
  });
});

describe("normalizeLocale", () => {
  it("accepts a bare locale", () => {
    for (const l of LOCALES) expect(normalizeLocale(l)).toBe(l);
  });

  it("accepts a regional variant and strips the region", () => {
    expect(normalizeLocale("de-AT")).toBe("de");
    expect(normalizeLocale("de_CH")).toBe("de");
    expect(normalizeLocale("EN-GB")).toBe("en");
  });

  it("falls back for unknown or missing values", () => {
    const fallback = normalizeLocale(null);
    expect(LOCALES).toContain(fallback);
    expect(normalizeLocale("xx")).toBe(fallback);
    expect(normalizeLocale("")).toBe(fallback);
    expect(normalizeLocale(undefined)).toBe(fallback);
  });
});

describe("phrase / interpolate", () => {
  const p: Phrase = {
    de: "Hallo {name}, {count} Bilder",
    en: "Hello {name}, {count} photos",
    it: "Ciao {name}, {count} foto",
    fi: "Hei {name}, {count} kuvaa",
    fr: "Bonjour {name}, {count} photos",
  };

  it("returns the text for the requested locale", () => {
    expect(phrase(p, "de", { name: "Anna", count: 3 })).toBe(
      "Hallo Anna, 3 Bilder"
    );
  });

  it("carries the same placeholders in every locale", () => {
    const names = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort();
    const ref = names(p.en);
    for (const l of LOCALES) expect(names(p[l])).toEqual(ref);
  });

  it("leaves an unknown placeholder untouched instead of printing undefined", () => {
    expect(interpolate("Hi {name}, {missing}", { name: "X" })).toBe(
      "Hi X, {missing}"
    );
  });

  it("returns the template unchanged when no vars are given", () => {
    expect(interpolate("no vars here")).toBe("no vars here");
  });
});

describe("mail footer configuration", () => {
  // Die Fusszeile ist der einzige Text im Layout, den der Betreiber selbst
  // setzen kann. Zwei Eigenschaften sollen dabei halten: eigener Text
  // gewinnt woertlich, und er wird escaped — die Quelle ist zwar
  // vertrauenswuerdig, aber ein "<" darin soll die Mail nicht zerlegen.
  it("keeps {link} substitutable in a custom footer", () => {
    const custom = "Verschickt von {link} — gehostet in Deutschland.";
    expect(interpolate(custom, { link: "<a>Lumio</a>" })).toBe(
      "Verschickt von <a>Lumio</a> — gehostet in Deutschland."
    );
  });

  it("leaves unknown placeholders untouched rather than blanking them", () => {
    // Ein Tippfehler im konfigurierten Text soll sichtbar bleiben, nicht
    // stillschweigend zu einer Luecke werden.
    expect(interpolate("a {nope} b", { link: "x" })).toContain("{nope}");
  });

  it("translates the default footer per locale", () => {
    const sentVia: Phrase = {
      de: "Verschickt von {link}",
      en: "Sent via {link}",
      it: "Inviato tramite {link}",
      fi: "Lähetetty palvelulla {link}",
      fr: "Envoyé via {link}",
    };
    for (const l of LOCALES) {
      const out = phrase(sentVia, l, { link: "L" });
      expect(out).toContain("L");
      expect(out).not.toContain("{link}");
    }
    expect(phrase(sentVia, "de", { link: "L" })).not.toBe(
      phrase(sentVia, "en", { link: "L" })
    );
  });
});
