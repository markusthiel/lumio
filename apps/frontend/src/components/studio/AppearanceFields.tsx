"use client";

import React from "react";

/**
 * Farb-Eingabe: sichtbares Swatch + nativer Picker als unsichtbares
 * Overlay (umgeht das kollabierende Default-Rendering von
 * <input type="color"> in Chrome/Brave) plus ein Hex-Textfeld.
 */
export function ColorField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value.trim());
  return (
    <div className="flex items-center gap-2">
      <label
        className="relative w-10 h-9 rounded border border-line-subtle cursor-pointer overflow-hidden shrink-0"
        style={{ backgroundColor: valid ? value : "transparent" }}
        title="Farbe wählen"
      >
        <input
          type="color"
          value={valid ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="absolute -inset-1 w-[calc(100%+8px)] h-[calc(100%+8px)] opacity-0 cursor-pointer"
        />
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 rounded-md border border-line-subtle px-3 py-2 text-sm font-mono"
        pattern="^#[0-9a-fA-F]{6}$"
        spellCheck={false}
      />
    </div>
  );
}

/**
 * Overlay-Farbe mit variabler Transparenz. Wert ist ein RGBA-Hex
 * (#rrggbbaa) oder null (kein Overlay). Color-Picker für die Farbe,
 * Slider für die Stärke (Alpha 0–100 %). Gleiche Mechanik wie das
 * Hero-Overlay im Galerie-Editor.
 */
export function OverlayField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const hex6 = value && value.length >= 7 ? value.slice(0, 7) : "#000000";
  const alphaHex = value && value.length === 9 ? value.slice(7, 9) : "00";
  const alphaPercent = Math.round((parseInt(alphaHex, 16) / 255) * 100);

  function rebuild(h6: string, percent: number): string | null {
    if (percent === 0) return null;
    const alpha = Math.round((percent / 100) * 255)
      .toString(16)
      .padStart(2, "0");
    return `${h6}${alpha}`;
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <label
        className="relative w-10 h-9 rounded border border-line-subtle cursor-pointer overflow-hidden shrink-0"
        style={{ backgroundColor: value ?? "transparent" }}
        title="Farbe wählen"
      >
        <input
          type="color"
          value={hex6}
          onChange={(e) =>
            onChange(rebuild(e.target.value, alphaPercent || 40))
          }
          className="absolute -inset-1 w-[calc(100%+8px)] h-[calc(100%+8px)] opacity-0 cursor-pointer"
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-ink-secondary flex-1 min-w-[180px]">
        Stärke
        <input
          type="range"
          min={0}
          max={100}
          value={alphaPercent}
          onChange={(e) => onChange(rebuild(hex6, Number(e.target.value)))}
          className="flex-1 accent-accent"
        />
        <span className="w-9 text-right tabular-nums text-ink-primary">
          {alphaPercent}%
        </span>
      </label>
      {value && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-sm text-ink-tertiary hover:text-ink-primary"
        >
          Entfernen
        </button>
      )}
    </div>
  );
}

/**
 * Asset-Upload-Feld mit Vorschau, Hochladen/Ersetzen/Entfernen.
 * Der eigentliche Upload-Flow (init → PUT → complete) liegt beim Aufrufer
 * via onFile/onRemove.
 */
export function AssetField({
  label,
  imageUrl,
  accept,
  hint,
  uploading,
  inputRef,
  onPick,
  onFile,
  onRemove,
  previewHeight = "small",
  previewTone = "neutral",
  previewBgColor = null,
}: {
  label: string;
  imageUrl: string | null;
  accept: string;
  hint: string;
  uploading: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPick: () => void;
  onFile: (file: File) => void;
  onRemove: () => void;
  /** "small" für Logo/Favicon, "large" für Hero-Background. */
  previewHeight?: "small" | "large";
  /** Hintergrund des Vorschau-Containers — zeigt schon vor dem Upload,
   *  auf welchem Grund das Logo landet:
   *    "dark"    fast schwarz  → helle/weiße Logos
   *    "light"   weiß          → dunkle Logos
   *    "neutral" Standard-Fläche */
  previewTone?: "dark" | "light" | "neutral";
  /** Überschreibt previewTone mit einer konkreten Hintergrundfarbe
   *  (z.B. der Akzentfarbe), um zu zeigen wie ein Logo z.B. auf einem
   *  farbigen Mail-Banner wirkt. */
  previewBgColor?: string | null;
}) {
  const previewCls =
    previewHeight === "large" ? "min-h-[180px] max-h-[260px]" : "min-h-[64px]";
  const imageCls =
    previewHeight === "large"
      ? "max-h-[240px] max-w-full object-cover w-full rounded"
      : "max-h-12 max-w-full object-contain";
  const previewBg = previewBgColor
    ? "border-black/10"
    : previewTone === "dark"
      ? "bg-[#0a0a0c] border-[#1a1a1f]"
      : previewTone === "light"
      ? "bg-white border-[#e2e2e6]"
      : "bg-surface-raised border-line-subtle";
  const emptyTextCls = previewBgColor
    ? "text-white/80"
    : previewTone === "light"
      ? "text-neutral-400"
      : "text-ink-tertiary";
  const previewStyle = previewBgColor
    ? { backgroundColor: previewBgColor }
    : undefined;
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-ink-secondary">{label}</label>
      <div className="rounded-md border border-line-subtle bg-surface-sunken p-3 space-y-2">
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            if (e.target) e.target.value = "";
          }}
        />
        {imageUrl ? (
          <div
            className={`border rounded p-2 flex items-center justify-center ${previewBg} ${previewCls}`}
            style={previewStyle}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="" className={imageCls} />
          </div>
        ) : (
          <div
            className={`border rounded text-xs text-center flex items-center justify-center ${previewBg} ${previewCls}`}
            style={previewStyle}
          >
            <span className={emptyTextCls}>Noch nichts hochgeladen.</span>
          </div>
        )}
        <div className="flex justify-between items-center gap-2">
          <button
            onClick={onPick}
            disabled={uploading}
            className="text-xs px-2 py-1 rounded border border-line-subtle hover:bg-surface-raised disabled:opacity-50"
          >
            {uploading ? "…" : imageUrl ? "Ersetzen" : "Hochladen"}
          </button>
          {imageUrl && (
            <button
              onClick={onRemove}
              className="text-xs text-semantic-danger hover:underline"
            >
              Entfernen
            </button>
          )}
        </div>
        <div className="text-[10px] text-ink-tertiary">{hint}</div>
      </div>
    </div>
  );
}
