/**
 * Farbe-Helper: berechnet die optimale Textfarbe (hell oder dunkel)
 * für eine gegebene Hintergrundfarbe.
 *
 * Algorithmus: WCAG relative luminance.
 *   - Y = 0.2126·R + 0.7152·G + 0.0722·B
 *   - Threshold 0.5 — alles drüber kriegt schwarzen Text, alles
 *     drunter weißen.
 *
 * Das ist nicht WCAG-AA-konform für ALLE Farbpaarungen, aber für den
 * Use-Case "Studio wählt eine Galerie-Hintergrundfarbe, Text soll
 * lesbar bleiben" reicht es. Die wirklich kritischen Paarungen
 * (z.B. mittel-graues #888 wo beides nicht super klappt) sind eh
 * problematisch — der Bilder-Galerie-Hintergrund ist typisch
 * entweder klar hell (Newborn/Wedding-Pastel) oder klar dunkel
 * (Dramatic Portrait), nicht im Mittenbereich.
 */

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return {
    r: (n >> 16) & 0xff,
    g: (n >> 8) & 0xff,
    b: n & 0xff,
  };
}

/** Relative Luminance nach WCAG. Returns 0..1. */
export function luminance(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  // sRGB-Linearisierung
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

/** Liefert "#ffffff" oder "#0a0a0a" je nach welche Farbe besser
 *  lesbar auf bg ist. */
export function readableTextOn(bg: string): string {
  const l = luminance(bg);
  // null (ungültiger Hex) → konservativ weiß zurückgeben, weil unser
  // Default-Hintergrund dunkel ist.
  if (l === null) return "#ffffff";
  return l > 0.5 ? "#0a0a0a" : "#ffffff";
}

/** Liefert "rgba(0,0,0,0.7)" oder "rgba(255,255,255,0.7)" — gedämpfte
 *  Textfarbe für sekundäre Informationen. Behält den Kontrast aber
 *  ist subtler. */
export function mutedTextOn(bg: string): string {
  const l = luminance(bg);
  if (l === null) return "rgba(255,255,255,0.7)";
  return l > 0.5 ? "rgba(10,10,10,0.65)" : "rgba(255,255,255,0.7)";
}
