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

/**
 * Spezialfall Hero-Sektion: berechnet die Textfarbe für einen Header,
 * der aus Hero-Bild + Overlay ODER reiner Hintergrundfarbe besteht.
 *
 * Drei Fälle:
 *   1. Solid-Background (kein Hero-Bild): Textfarbe rein aus dem Bg
 *      ableiten, wie readableTextOn.
 *   2. Hero-Bild OHNE Overlay: wir wissen nicht ob das Bild hell oder
 *      dunkel ist. Default-Annahme: Bild kann beides sein → wir geben
 *      hell zurück (klassischer Foto-Hero auf dunklem Tone) und der
 *      Caller fügt optional einen Text-Shadow hinzu.
 *   3. Hero-Bild MIT Overlay: das Overlay deckt das Bild mehr oder
 *      weniger ab. Bei kräftigem Overlay (Alpha > 60%) gewinnt die
 *      Overlay-Farbe, und wir nutzen die zur Berechnung. Bei schwachem
 *      Overlay (< 30%) gewinnt noch das Bild — Default-Hell. Im
 *      Übergangsbereich nehmen wir die Overlay-Farbe als Indikator,
 *      weil sie meist das visuelle Statement bestimmt.
 */
export function heroTextColor({
  hasHeroImage,
  backgroundColor,
  overlayColor,
}: {
  hasHeroImage: boolean;
  backgroundColor: string | null;
  /** Hex #RRGGBBAA, das letzte Paar ist Alpha. */
  overlayColor: string | null;
}): "light" | "dark" {
  if (!hasHeroImage) {
    if (!backgroundColor) return "light";
    const l = luminance(backgroundColor);
    if (l === null) return "light";
    return l > 0.5 ? "dark" : "light";
  }

  // Hero-Bild da. Wenn ein Overlay drüberliegt, bestimmt das den Look.
  if (overlayColor) {
    const alphaHex = overlayColor.length === 9 ? overlayColor.slice(7, 9) : "ff";
    const alpha = parseInt(alphaHex, 16) / 255;
    // Bei kräftigem Overlay: Overlay-Farbe gewinnt
    if (alpha >= 0.3) {
      const hex6 = overlayColor.slice(0, 7);
      const l = luminance(hex6);
      if (l === null) return "light";
      return l > 0.5 ? "dark" : "light";
    }
  }
  // Bild ohne (oder mit nur sehr schwachem) Overlay: wir nehmen die
  // sichere "Hell + Text-Shadow"-Variante. Hero-Bilder sind oft
  // visuell komplex und ein heller Text mit Schatten ist
  // universeller lesbar als ein dunkler ohne Schatten.
  return "light";
}
