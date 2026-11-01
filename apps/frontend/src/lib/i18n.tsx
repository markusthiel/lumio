"use client";

/**
 * Lumio Frontend — i18n
 *
 * Deliberately lightweight:
 *   - Dictionary lookup with a fallback chain (active → 'en' → key)
 *   - Locale derived from a cookie OR navigator.language
 *   - Pluralisation via Intl.PluralRules
 *   - Dates, numbers, currencies and sorting via the helpers in i18n/format,
 *     always bound to the active locale — see useFormat()
 *
 * English is the primary language and the fallback for missing keys; every
 * other locale is a translation of en.ts. See CONTRIBUTING.md.
 *
 * Currently supported:
 *   - 'en' (default)
 *   - 'de'
 *   - 'it'
 *   - 'fi'
 *   - 'fr'
 *
 * Strings live in lib/i18n/<locale>.ts.
 */
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { dictionaries, type Locale, type Dict } from "./i18n/dict";
import { createFormatters, type Formatters } from "./i18n/format";

const LOCALE_COOKIE = "lumio_locale";
const DEFAULT_LOCALE: Locale = "en";
const SUPPORTED: Locale[] = ["en", "de", "it", "fi", "fr"];

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp("(?:^|; )" + name + "=([^;]*)")
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string) {
  if (typeof document === "undefined") return;
  document.cookie =
    name +
    "=" +
    encodeURIComponent(value) +
    "; path=/; max-age=" +
    365 * 24 * 60 * 60 +
    "; samesite=lax";
}

function detectLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const fromCookie = readCookie(LOCALE_COOKIE);
  if (fromCookie && SUPPORTED.includes(fromCookie as Locale)) {
    return fromCookie as Locale;
  }
  const fromNav = navigator.language?.split("-")[0];
  if (fromNav && SUPPORTED.includes(fromNav as Locale)) {
    return fromNav as Locale;
  }
  return DEFAULT_LOCALE;
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  // Resolve the real locale only after hydration, otherwise SSR and client
  // markup diverge.
  useEffect(() => {
    setLocaleState(detectLocale());
  }, []);

  // Keep the document language in sync with the interface language. The SSR
  // default is lang="en"; screen readers, browser translation prompts and
  // CSS :lang() selectors all depend on this being accurate.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = (l: Locale) => {
    writeCookie(LOCALE_COOKIE, l);
    setLocaleState(l);
  };

  const value = useMemo<I18nContextValue>(() => {
    const t = (
      key: string,
      vars?: Record<string, string | number>
    ): string => {
      const dict = dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE];
      const fallback = dictionaries[DEFAULT_LOCALE];
      const raw =
        lookup(dict, key) ?? lookup(fallback, key) ?? key;
      if (!vars) return raw;
      return raw.replace(/\{(\w+)\}/g, (_, k) =>
        vars[k] !== undefined ? String(vars[k]) : `{${k}}`
      );
    };
    return { locale, setLocale, t };
  }, [locale]);

  return (
    <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
  );
}

function lookup(dict: Dict, key: string): string | null {
  // Punkt-separierte Pfade: "login.title"
  const parts = key.split(".");
  let current: unknown = dict;
  for (const p of parts) {
    if (typeof current !== "object" || current === null) return null;
    current = (current as Record<string, unknown>)[p];
  }
  return typeof current === "string" ? current : null;
}

export function useT(): I18nContextValue["t"] {
  const ctx = useContext(I18nContext);
  // Fallback wenn der Provider noch nicht gemountet ist (SSR/Edge-Cases):
  // direkter Lookup im Default-Dict.
  if (!ctx) {
    return (key, vars) => {
      const raw = lookup(dictionaries[DEFAULT_LOCALE], key) ?? key;
      if (!vars) return raw;
      return raw.replace(/\{(\w+)\}/g, (_, k) =>
        vars[k] !== undefined ? String(vars[k]) : `{${k}}`
      );
    };
  }
  return ctx.t;
}

export function useLocale() {
  const ctx = useContext(I18nContext);
  return {
    locale: ctx?.locale ?? DEFAULT_LOCALE,
    setLocale: ctx?.setLocale ?? (() => {}),
    supported: SUPPORTED,
  };
}

/**
 * Date, number, currency and sort formatters bound to the active locale.
 *
 * Use this instead of calling `toLocaleDateString` / `Intl.*` with a literal
 * locale — a hardcoded "de-DE" renders German dates inside the English UI.
 *
 *   const fmt = useFormat();
 *   fmt.date(gallery.createdAt)            // 08/14/2026 vs. 14.08.2026
 *   fmt.currencyFromMinor(order.totalCents, order.currency)
 *   items.sort((a, b) => fmt.compare(a.name, b.name))
 */
export function useFormat(): Formatters {
  const { locale } = useLocale();
  return useMemo(() => createFormatters(locale), [locale]);
}

/**
 * Plural helper: picks `one` or `other` based on the count.
 * Example: plural(t, 'files.count', n) → "1 file" / "5 files"
 *
 * Pass the active locale from useLocale() so the plural category matches the
 * rendered language; it falls back to cookie/navigator detection otherwise.
 */
export function plural(
  t: I18nContextValue["t"],
  baseKey: string,
  count: number,
  locale?: Locale
): string {
  const rules = new Intl.PluralRules(locale ?? detectLocale());
  const cat = rules.select(count); // "one" | "other" | …
  return t(`${baseKey}.${cat}`, { count }) || t(`${baseKey}.other`, { count });
}
