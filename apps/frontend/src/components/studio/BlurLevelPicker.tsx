"use client";

/**
 * Weichzeichner-Stufen-Picker (Glas-Effekt) als Button-Gruppe statt
 * px-Slider — für die meisten klarer. Gespeichert wird weiterhin der
 * px-Wert; gerendert als backdrop-filter: blur(Npx). Genutzt fürs
 * Login-Overlay (Appearance) und das Galerie-Hero-Overlay.
 */

export const BLUR_LEVELS: { label: string; px: number }[] = [
  { label: "Aus", px: 0 },
  { label: "Schwach", px: 6 },
  { label: "Standard", px: 14 },
  { label: "Stark", px: 28 },
];

export function BlurLevelPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (px: number) => void;
}) {
  // Aktiv = exakter Treffer, sonst die nächstgelegene Stufe (falls noch
  // ein alter, freier px-Wert gespeichert ist).
  const activePx = BLUR_LEVELS.reduce((best, lvl) =>
    Math.abs(lvl.px - value) < Math.abs(best.px - value) ? lvl : best
  ).px;
  return (
    <div className="grid grid-cols-4 gap-2">
      {BLUR_LEVELS.map((lvl) => {
        const on = activePx === lvl.px;
        return (
          <button
            key={lvl.label}
            type="button"
            onClick={() => onChange(lvl.px)}
            className={`rounded border px-3 py-2 text-sm font-medium transition-colors ${
              on
                ? "border-accent bg-accent/10 text-ink-primary"
                : "border-line-subtle bg-surface-sunken text-ink-secondary hover:border-line-strong"
            }`}
          >
            {lvl.label}
          </button>
        );
      })}
    </div>
  );
}
