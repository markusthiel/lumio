"use client";

/**
 * Lumio Frontend — i18n
 *
 * Sehr leichtgewichtige Lösung:
 *   - Dictionary-Lookup mit Fallback-Chain (current → 'en' → key)
 *   - Locale wird aus Cookie ODER navigator.language abgeleitet
 *   - Pluralisation über Intl.PluralRules
 *   - Datums-/Zahlenformate über Intl.* direkt
 *
 * Wir unterstützen aktuell:
 *   - 'en' (Default)
 *   - 'de'
 *
 * Strings werden in lib/i18n/<locale>.ts gepflegt.
 */
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { dictionaries, type Locale, type Dict } from "./i18n/dict";

const LOCALE_COOKIE = "lumio_locale";
const DEFAULT_LOCALE: Locale = "en";
const SUPPORTED: Locale[] = ["en", "de"];

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

  // Erst nach Hydration den echten Locale setzen — sonst Mismatch zwischen
  // SSR und Client
  useEffect(() => {
    setLocaleState(detectLocale());
  }, []);

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
 * Plural-Helper: liefert `one` oder `other` basierend auf der Anzahl.
 * Beispiel: plural(t, 'files.count', n) → "1 file" / "5 files"
 */
export function plural(
  t: I18nContextValue["t"],
  baseKey: string,
  count: number
): string {
  const rules = new Intl.PluralRules(detectLocale());
  const cat = rules.select(count); // "one" | "other" | …
  return t(`${baseKey}.${cat}`, { count }) || t(`${baseKey}.other`, { count });
}
