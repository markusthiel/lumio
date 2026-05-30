/**
 * Wendet das Studio-Erscheinungsbild (Akzentfarbe + Grundton) zur
 * Laufzeit auf das <html>-Element an. Genutzt von der StudioShell beim
 * Laden und von der Erscheinungsbild-Seite fuer sofortiges Feedback
 * nach dem Speichern (ohne Reload).
 */

const ACCENT_VARS = [
  "--accent",
  "--accent-hover",
  "--accent-subtle",
  "--line-focus",
  "--brand-accent",
  "--accent-contrast",
];

/**
 * Überschreibt die Akzentfarbe (--accent + abgeleitete Töne) aus einem
 * Hex-Wert. Der Hover-Ton wird Richtung Weiß aufgehellt; die Kontrast-
 * farbe für Text auf Accent-Flächen ergibt sich aus der relativen
 * Helligkeit. hex=null setzt alle Overrides auf den globals.css-Standard
 * (Amber) zurück.
 */
export function applyStudioAccent(hex: string | null) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const reset = () => ACCENT_VARS.forEach((v) => root.style.removeProperty(v));
  if (!hex) return reset();
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return reset();
  let h = m[1];
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const triplet = `${r} ${g} ${b}`;
  const lighten = (c: number) => Math.round(c + (255 - c) * 0.18);
  const hover = `${lighten(r)} ${lighten(g)} ${lighten(b)}`;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const contrast = luminance > 0.6 ? "14 14 16" : "245 242 244";
  root.style.setProperty("--accent", triplet);
  root.style.setProperty("--accent-hover", hover);
  root.style.setProperty("--accent-subtle", triplet);
  root.style.setProperty("--line-focus", triplet);
  root.style.setProperty("--brand-accent", triplet);
  root.style.setProperty("--accent-contrast", contrast);
}

/**
 * Setzt den Studio-Grundton. "light" aktiviert den hellen Token-Satz
 * (data-theme="light" auf <html>), "dark" entfernt das Attribut und
 * fällt auf die dunklen :root-Defaults zurück.
 */
export function applyStudioTheme(theme: "dark" | "light") {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "light") root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme");
}
