/**
 * Lumio Frontend — locale-aware formatting
 *
 * Every date, number, currency and sort operation in the frontend must follow
 * the *active* interface locale. Hardcoding a locale identifier such as
 * "de-DE" produces a German date inside an English UI, which is what these
 * helpers exist to prevent.
 *
 * Two flavours:
 *   - Pure functions taking an explicit `locale` — for module-level helpers
 *     and anything outside a React component.
 *   - The `useFormat()` hook in ../i18n.tsx — binds these to the active
 *     locale so call sites don't have to pass it around.
 *
 * The `Intl` formatter instances are cached per locale + options, because
 * constructing them is comparatively expensive and tables re-render often.
 */
import type { Locale } from "./dict";

/** BCP 47 tags for our supported locales. */
const BCP47: Record<Locale, string> = {
  en: "en-US",
  de: "de-DE",
  it: "it-IT",
  fi: "fi-FI",
  fr: "fr-FR",
};

/** Fallback currency when a caller has no explicit one. */
export const DEFAULT_CURRENCY = "EUR";

export function toBcp47(locale: Locale): string {
  return BCP47[locale] ?? BCP47.en;
}

const dateTimeCache = new Map<string, Intl.DateTimeFormat>();
const numberCache = new Map<string, Intl.NumberFormat>();
const collatorCache = new Map<string, Intl.Collator>();

function cacheKey(locale: Locale, options?: object): string {
  return locale + "|" + (options ? JSON.stringify(options) : "");
}

function dateTimeFormatter(
  locale: Locale,
  options?: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  const key = cacheKey(locale, options);
  let f = dateTimeCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(toBcp47(locale), options);
    dateTimeCache.set(key, f);
  }
  return f;
}

function numberFormatter(
  locale: Locale,
  options?: Intl.NumberFormatOptions
): Intl.NumberFormat {
  const key = cacheKey(locale, options);
  let f = numberCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(toBcp47(locale), options);
    numberCache.set(key, f);
  }
  return f;
}

/**
 * Accepts what our API actually hands us: Date, ISO string, epoch millis.
 * Returns null for anything unparseable so call sites can render a dash
 * instead of "Invalid Date".
 */
function asDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const DATE_DEFAULTS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
};

const DATE_TIME_DEFAULTS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
};

/** Date only, in the given locale. Empty string for missing values. */
export function formatDate(
  locale: Locale,
  value: Date | string | number | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  const d = asDate(value);
  if (!d) return "";
  return dateTimeFormatter(locale, options ?? DATE_DEFAULTS).format(d);
}

/** Date and time, in the given locale. Empty string for missing values. */
export function formatDateTime(
  locale: Locale,
  value: Date | string | number | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  const d = asDate(value);
  if (!d) return "";
  return dateTimeFormatter(locale, options ?? DATE_TIME_DEFAULTS).format(d);
}

/** Time only, in the given locale. */
export function formatTime(
  locale: Locale,
  value: Date | string | number | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  const d = asDate(value);
  if (!d) return "";
  return dateTimeFormatter(
    locale,
    options ?? { hour: "2-digit", minute: "2-digit" }
  ).format(d);
}

/** Plain number with locale-appropriate grouping and decimal separator. */
export function formatNumber(
  locale: Locale,
  value: number | null | undefined,
  options?: Intl.NumberFormatOptions
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return numberFormatter(locale, options).format(value);
}

/**
 * Currency amount from a **minor unit** value (cents), which is how prices
 * travel through the API and Stripe.
 */
export function formatCurrencyFromMinor(
  locale: Locale,
  minorAmount: number | null | undefined,
  currency: string = DEFAULT_CURRENCY,
  options?: Intl.NumberFormatOptions
): string {
  if (minorAmount === null || minorAmount === undefined) return "";
  return formatCurrency(locale, minorAmount / 100, currency, options);
}

/** Currency amount from a major unit value (euros). */
export function formatCurrency(
  locale: Locale,
  amount: number | null | undefined,
  currency: string = DEFAULT_CURRENCY,
  options?: Intl.NumberFormatOptions
): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return "";
  }
  return numberFormatter(locale, {
    style: "currency",
    currency,
    ...options,
  }).format(amount);
}

/**
 * Percentage from a ratio (0.42 → "42%"). Pass `fromRatio: false` if the
 * value is already 0–100.
 */
export function formatPercent(
  locale: Locale,
  value: number | null | undefined,
  options?: Intl.NumberFormatOptions & { fromRatio?: boolean }
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  const { fromRatio = true, ...rest } = options ?? {};
  return numberFormatter(locale, {
    style: "percent",
    maximumFractionDigits: 1,
    ...rest,
  }).format(fromRatio ? value : value / 100);
}

/**
 * Locale-aware string comparison for sorting. Uses a cached Collator, which
 * is markedly faster than `localeCompare` per element on long lists.
 */
export function compareStrings(
  locale: Locale,
  a: string,
  b: string,
  options?: Intl.CollatorOptions
): number {
  const key = cacheKey(locale, options);
  let c = collatorCache.get(key);
  if (!c) {
    c = new Intl.Collator(toBcp47(locale), {
      sensitivity: "base",
      numeric: true,
      ...options,
    });
    collatorCache.set(key, c);
  }
  return c.compare(a, b);
}

/** Byte sizes. Unit symbols are locale-independent, the number is not. */
export function formatBytes(
  locale: Locale,
  bytes: number | null | undefined,
  decimals = 1
): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const exponent = Math.min(
    Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / Math.pow(1024, exponent);
  return (
    formatNumber(locale, value, {
      maximumFractionDigits: exponent === 0 ? 0 : decimals,
    }) +
    " " +
    units[exponent]
  );
}

/** The bundle returned by `useFormat()`. */
export interface Formatters {
  locale: Locale;
  /** BCP 47 tag of the active locale, for direct `Intl.*` construction. */
  bcp47: string;
  date: (
    value: Date | string | number | null | undefined,
    options?: Intl.DateTimeFormatOptions
  ) => string;
  dateTime: (
    value: Date | string | number | null | undefined,
    options?: Intl.DateTimeFormatOptions
  ) => string;
  time: (
    value: Date | string | number | null | undefined,
    options?: Intl.DateTimeFormatOptions
  ) => string;
  number: (
    value: number | null | undefined,
    options?: Intl.NumberFormatOptions
  ) => string;
  currency: (
    amount: number | null | undefined,
    currency?: string,
    options?: Intl.NumberFormatOptions
  ) => string;
  currencyFromMinor: (
    minorAmount: number | null | undefined,
    currency?: string,
    options?: Intl.NumberFormatOptions
  ) => string;
  percent: (
    value: number | null | undefined,
    options?: Intl.NumberFormatOptions & { fromRatio?: boolean }
  ) => string;
  bytes: (bytes: number | null | undefined, decimals?: number) => string;
  compare: (a: string, b: string, options?: Intl.CollatorOptions) => number;
}

/** Builds the formatter bundle for a locale. */
export function createFormatters(locale: Locale): Formatters {
  return {
    locale,
    bcp47: toBcp47(locale),
    date: (v, o) => formatDate(locale, v, o),
    dateTime: (v, o) => formatDateTime(locale, v, o),
    time: (v, o) => formatTime(locale, v, o),
    number: (v, o) => formatNumber(locale, v, o),
    currency: (v, c, o) => formatCurrency(locale, v, c, o),
    currencyFromMinor: (v, c, o) => formatCurrencyFromMinor(locale, v, c, o),
    percent: (v, o) => formatPercent(locale, v, o),
    bytes: (v, d) => formatBytes(locale, v, d),
    compare: (a, b, o) => compareStrings(locale, a, b, o),
  };
}
