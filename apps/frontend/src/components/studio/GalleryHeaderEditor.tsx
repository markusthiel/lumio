"use client";

/**
 * GalleryHeaderEditor — Studio-Panel für die Customer-Header-Anpassung.
 *
 * Sektionen (alle optional, alle reversibel auf "Default"):
 *   1. Event-Logo — Upload + Vorschau, "Entfernen"
 *   2. Hero-Bild — drei Modi:
 *      a) Kein Hero — Solid-Farbe wählen (oder leer = Default)
 *      b) Aus Galerie — Klick auf eine GalleryTile setzt heroFileId
 *      c) Upload — eigenes Bild
 *      Plus Overlay-Farbe für Lesbarkeit
 *   3. Welcome-Markdown — Textarea mit Live-Preview-Toggle
 *
 * Das Speichern passiert pro Feld direkt (debounced bei Text), damit
 * der Studio-User Live-Feedback in einem Vorschau-Tab haben kann ohne
 * "Speichern"-Button.
 */
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, type Gallery } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { FONT_OPTIONS } from "@/lib/fonts";

interface GalleryFile {
  id: string;
  filename: string;
  thumbUrl: string | null;
}

interface Props {
  gallery: Gallery;
  /** Files der Galerie für "Hero aus Galerie wählen" */
  files: GalleryFile[];
  /** Wird nach jedem Save aufgerufen, damit das Parent re-fetched */
  onChanged: () => Promise<void> | void;
}

export function GalleryHeaderEditor({ gallery, files, onChanged }: Props) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);

  async function patch(patch: Partial<Gallery>) {
    await api.updateGallery(gallery.id, patch);
    await onChanged();
  }

  async function uploadAsset(kind: "logo" | "hero", file: File) {
    const { storageKey } = await api.uploadGalleryAsset(gallery.id, kind, file);
    await patch(
      kind === "logo"
        ? { eventLogoUrl: storageKey }
        : { heroUrl: storageKey, heroFileId: null }
    );
  }

  // Asset-URLs für die Vorschau im Studio. Wir nutzen die Public-
  // Routes (sind dieselben, die Customer auch sehen), damit der Studio-
  // User exakt sieht was der Kunde sehen wird.
  const logoPreviewUrl = gallery.eventLogoUrl
    ? api.galleryAssetUrl(gallery.slug, "logo")
    : null;

  // Hero-Vorschau: wenn heroFileId, suchen wir die thumbUrl der File,
  // sonst nehmen wir den Hero-Upload-URL.
  const heroFile = gallery.heroFileId
    ? files.find((f) => f.id === gallery.heroFileId)
    : null;
  const heroPreviewUrl = heroFile?.thumbUrl
    ? heroFile.thumbUrl
    : gallery.heroUrl
    ? api.galleryAssetUrl(gallery.slug, "hero")
    : null;

  return (
    <section className="rounded-md border border-line-subtle bg-surface-raised overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((s) => !s)}
        className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-surface-overlay/40 transition-colors duration-motion"
      >
        <div>
          <h2 className="text-ui-md font-medium text-ink-primary">
            {t("studio.designEditor")}
          </h2>
          <p className="text-ui-xs text-ink-tertiary mt-0.5">
            {t("studio.designEditorHint")}
          </p>
        </div>
        <span
          className={`text-ink-tertiary text-ui-sm transition-transform duration-motion ${
            expanded ? "rotate-90" : ""
          }`}
        >
          ▶
        </span>
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-6">
          {/* Hero-Layout-Variante */}
          <Field
            label={t("studio.heroLayout")}
            hint={t("studio.heroLayoutHint")}
          >
            <HeroLayoutPicker
              value={gallery.heroLayout}
              onChange={(v) => patch({ heroLayout: v })}
            />
          </Field>

          {/* Grid-Layout-Variante */}
          <Field
            label={t("studio.gridLayout")}
            hint={t("studio.gridLayoutHint")}
          >
            <GridLayoutPicker
              value={gallery.gridLayout}
              onChange={(v) => patch({ gridLayout: v })}
            />
          </Field>

          {/* Slideshow-Übergang */}
          <Field
            label={t("studio.slideshowTransition")}
            hint={t("studio.slideshowTransitionHint")}
          >
            <SlideshowTransitionPicker
              value={gallery.slideshowTransition}
              onChange={(v) => patch({ slideshowTransition: v })}
            />
          </Field>

          {/* Event-Logo */}
          <Field
            label={t("studio.eventLogo")}
            hint={t("studio.eventLogoHint")}
          >
            <div className="flex items-center gap-3">
              {logoPreviewUrl && (
                <img
                  src={logoPreviewUrl}
                  alt=""
                  className="h-12 w-auto max-w-[160px] object-contain bg-surface-sunken rounded p-1"
                />
              )}
              <FileInputButton
                accept="image/*"
                label={
                  gallery.eventLogoUrl
                    ? t("studio.replace")
                    : t("studio.uploadLogo")
                }
                onChange={(file) => uploadAsset("logo", file)}
              />
              {gallery.eventLogoUrl && (
                <button
                  type="button"
                  onClick={() => patch({ eventLogoUrl: null })}
                  className="text-ui-sm text-semantic-danger hover:underline"
                >
                  {t("studio.remove")}
                </button>
              )}
            </div>
          </Field>

          {/* Hero-Bild */}
          <Field label={t("studio.heroImage")} hint={t("studio.heroImageHint")}>
            <div className="space-y-3">
              {heroPreviewUrl && (
                <div className="relative w-full aspect-[3/1] rounded overflow-hidden bg-surface-sunken">
                  <img
                    src={heroPreviewUrl}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                  {gallery.heroOverlayColor && (
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        backgroundColor: gallery.heroOverlayColor,
                      }}
                    />
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <FileInputButton
                  accept="image/*"
                  label={t("studio.heroUpload")}
                  onChange={(file) => uploadAsset("hero", file)}
                />
                {files.length > 0 && (
                  <HeroFromGalleryDropdown
                    files={files}
                    currentFileId={gallery.heroFileId}
                    onChoose={(fid) =>
                      patch({ heroFileId: fid, heroUrl: null })
                    }
                  />
                )}
                {(gallery.heroFileId || gallery.heroUrl) && (
                  <button
                    type="button"
                    onClick={() =>
                      patch({ heroFileId: null, heroUrl: null })
                    }
                    className="text-ui-sm text-semantic-danger hover:underline"
                  >
                    {t("studio.removeHero")}
                  </button>
                )}
              </div>
            </div>
          </Field>

          {/* Overlay-Farbe (nur sinnvoll wenn Hero-Bild da) */}
          {(gallery.heroFileId || gallery.heroUrl) && (
            <Field
              label={t("studio.heroOverlay")}
              hint={t("studio.heroOverlayHint")}
            >
              <RgbaPicker
                value={gallery.heroOverlayColor}
                onChange={(v) => patch({ heroOverlayColor: v })}
              />
            </Field>
          )}

          {/* Hintergrund-Farbe (nur sinnvoll wenn KEIN Hero-Bild) */}
          {!gallery.heroFileId && !gallery.heroUrl && (
            <Field
              label={t("studio.heroBackground")}
              hint={t("studio.heroBackgroundHint")}
            >
              <RgbPicker
                value={gallery.heroBackgroundColor}
                onChange={(v) => patch({ heroBackgroundColor: v })}
              />
            </Field>
          )}

          {/* Welcome-Markdown */}
          <MarkdownField
            label={t("studio.welcomeMarkdown")}
            hint={t("studio.welcomeMarkdownHint")}
            placeholder={t("studio.welcomeMarkdownPlaceholder")}
            emptyPreviewHint={t("studio.welcomeMarkdownEmpty")}
            value={gallery.welcomeMarkdown}
            onSave={(v) =>
              api
                .updateGallery(gallery.id, { welcomeMarkdown: v })
                .then(onChanged)
            }
          />

          {/* Footer-Markdown */}
          <MarkdownField
            label={t("studio.footerMarkdown")}
            hint={t("studio.footerMarkdownHint")}
            placeholder={t("studio.footerMarkdownPlaceholder")}
            emptyPreviewHint={t("studio.welcomeMarkdownEmpty")}
            value={gallery.footerMarkdown}
            onSave={(v) =>
              api
                .updateGallery(gallery.id, { footerMarkdown: v })
                .then(onChanged)
            }
          />

          {/* Galerie-Schriftarten */}
          <div className="rounded border border-line-subtle bg-surface-sunken/40 p-4 space-y-3">
            <div>
              <h3 className="text-ui-sm font-medium text-ink-secondary">
                {t("studio.galleryFonts")}
              </h3>
              <p className="text-ui-xs text-ink-tertiary mt-0.5">
                {t("studio.galleryFontsHint")}
              </p>
            </div>
            <Field label={t("studio.fontHeading")}>
              <FontSelect
                value={gallery.fontHeading}
                onChange={(v) => patch({ fontHeading: v })}
              />
            </Field>
            <Field label={t("studio.fontBody")}>
              <FontSelect
                value={gallery.fontBody}
                onChange={(v) => patch({ fontBody: v })}
              />
            </Field>
          </div>

          {/* Galerie-spezifische Farben */}
          <div className="rounded border border-line-subtle bg-surface-sunken/40 p-4 space-y-3">
            <div>
              <h3 className="text-ui-sm font-medium text-ink-secondary">
                {t("studio.galleryColors")}
              </h3>
              <p className="text-ui-xs text-ink-tertiary mt-0.5">
                {t("studio.galleryColorsHint")}
              </p>
            </div>
            <Field label={t("studio.colorBackground")}>
              <RgbPicker
                value={gallery.colorBackground}
                onChange={(v) => patch({ colorBackground: v })}
              />
            </Field>
            <Field label={t("studio.colorAccent")}>
              <RgbPicker
                value={gallery.colorAccent}
                onChange={(v) => patch({ colorAccent: v })}
              />
            </Field>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
/** Wiederverwendbare Markdown-Eingabe mit debounced Save + Edit/Preview-
 *  Toggle. Verwendet von Welcome- und Footer-Markdown. */
function MarkdownField({
  label,
  hint,
  placeholder,
  emptyPreviewHint,
  value,
  onSave,
}: {
  label: string;
  hint: string;
  placeholder: string;
  emptyPreviewHint: string;
  value: string | null;
  onSave: (v: string | null) => Promise<unknown> | unknown;
}) {
  const t = useT();
  const [local, setLocal] = useState(value ?? "");
  const [preview, setPreview] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Nur extern angleichen wenn der User gerade nicht tippt
    if (timerRef.current) return;
    setLocal(value ?? "");
  }, [value]);

  function debouncedSave(next: string) {
    setLocal(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      await onSave(next || null);
      timerRef.current = null;
    }, 800);
  }

  return (
    <Field
      label={label}
      hint={hint}
      actions={
        <button
          type="button"
          onClick={() => setPreview((s) => !s)}
          className="text-ui-xs text-accent hover:text-accent-hover"
        >
          {preview ? t("studio.edit") : t("studio.preview")}
        </button>
      }
    >
      {preview ? (
        <div className="prose prose-invert prose-sm max-w-none p-3 rounded bg-surface-sunken border border-line-subtle min-h-[120px]">
          {local ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
              {local}
            </ReactMarkdown>
          ) : (
            <p className="text-ink-tertiary italic">{emptyPreviewHint}</p>
          )}
        </div>
      ) : (
        <textarea
          value={local}
          onChange={(e) => debouncedSave(e.target.value)}
          rows={6}
          maxLength={20_000}
          placeholder={placeholder}
          className="w-full px-3 py-2 rounded bg-surface-sunken border border-line-subtle text-ui text-ink-primary font-mono text-ui-sm focus:border-accent focus:outline-none resize-y"
        />
      )}
    </Field>
  );
}

// ---------------------------------------------------------------------------
function Field({
  label,
  hint,
  actions,
  children,
}: {
  label: string;
  hint?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-ui-sm text-ink-secondary">{label}</label>
        {actions}
      </div>
      {children}
      {hint && (
        <div className="mt-1 text-ui-xs text-ink-tertiary">{hint}</div>
      )}
    </div>
  );
}

function FileInputButton({
  accept,
  label,
  onChange,
}: {
  accept: string;
  label: string;
  onChange: (file: File) => Promise<void> | void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          try {
            await onChange(file);
          } finally {
            setBusy(false);
            if (inputRef.current) inputRef.current.value = "";
          }
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="h-8 px-3 rounded border border-line-strong text-ui-sm text-ink-secondary hover:text-ink-primary hover:bg-surface-overlay disabled:opacity-50 transition-colors duration-motion"
      >
        {busy ? "…" : label}
      </button>
    </>
  );
}

function HeroFromGalleryDropdown({
  files,
  currentFileId,
  onChoose,
}: {
  files: GalleryFile[];
  currentFileId: string | null;
  onChoose: (fileId: string) => Promise<void> | void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="h-8 px-3 rounded border border-line-strong text-ui-sm text-ink-secondary hover:text-ink-primary hover:bg-surface-overlay transition-colors duration-motion"
      >
        {t("studio.heroFromGallery")}
      </button>
      {open && (
        <div className="absolute z-10 mt-1 right-0 w-80 max-h-80 overflow-y-auto rounded-md border border-line-strong bg-surface-raised shadow-elev-3 p-2 grid grid-cols-3 gap-1.5">
          {files
            .filter((f) => f.thumbUrl)
            .map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={async () => {
                  await onChoose(f.id);
                  setOpen(false);
                }}
                className={`relative aspect-square rounded overflow-hidden hover:ring-2 hover:ring-accent transition-shadow duration-motion ${
                  f.id === currentFileId ? "ring-2 ring-accent" : ""
                }`}
                title={f.filename}
              >
                <img
                  src={f.thumbUrl!}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

function RgbPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => Promise<void> | void;
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value ?? "#0f172a"}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-12 rounded border border-line-subtle bg-transparent cursor-pointer"
      />
      <input
        type="text"
        value={value ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "" || /^#[0-9a-fA-F]{6}$/.test(v)) {
            onChange(v === "" ? null : v);
          }
        }}
        placeholder="#0f172a"
        className="h-8 px-2 rounded bg-surface-sunken border border-line-subtle text-ui-sm text-ink-primary font-mono w-24 focus:border-accent focus:outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-ui-xs text-ink-tertiary hover:text-ink-secondary"
        >
          {t("studio.clear")}
        </button>
      )}
    </div>
  );
}

function RgbaPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => Promise<void> | void;
}) {
  const t = useT();

  // Aufsplitten Hex8 → Hex6 + Alpha (0-100%)
  const hex6 = value && value.length >= 7 ? value.slice(0, 7) : "#000000";
  const alphaHex = value && value.length === 9 ? value.slice(7, 9) : "00";
  const alphaPercent = Math.round((parseInt(alphaHex, 16) / 255) * 100);

  function rebuild(h6: string, percent: number) {
    if (percent === 0) return null;
    const alpha = Math.round((percent / 100) * 255)
      .toString(16)
      .padStart(2, "0");
    return `${h6}${alpha}`;
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        type="color"
        value={hex6}
        onChange={(e) => onChange(rebuild(e.target.value, alphaPercent || 40))}
        className="h-8 w-12 rounded border border-line-subtle bg-transparent cursor-pointer"
      />
      <label className="text-ui-xs text-ink-tertiary flex items-center gap-1.5">
        Stärke
        <input
          type="range"
          min={0}
          max={100}
          value={alphaPercent}
          onChange={(e) => onChange(rebuild(hex6, Number(e.target.value)))}
          className="w-24"
        />
        <span className="text-ui-xs text-ink-secondary w-8 text-right tabular-nums">
          {alphaPercent}%
        </span>
      </label>
      {value && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-ui-xs text-ink-tertiary hover:text-ink-secondary"
        >
          {t("studio.clear")}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
/** Radio-Card-Picker für Hero-Layout-Varianten. Jede Karte ist ein
 *  Mini-Diagramm aus Divs, damit der Studio-User vor dem Klick sieht
 *  wie sich der Customer-Header anordnet. */
function HeroLayoutPicker({
  value,
  onChange,
}: {
  value: "minimal" | "splash" | "side_by_side" | "centered";
  onChange: (v: "minimal" | "splash" | "side_by_side" | "centered") => Promise<unknown> | unknown;
}) {
  const t = useT();
  const options: {
    id: "minimal" | "splash" | "side_by_side" | "centered";
    label: string;
    sketch: React.ReactNode;
  }[] = [
    {
      id: "minimal",
      label: t("studio.heroLayoutMinimal"),
      sketch: (
        <div className="w-full h-full p-1.5 flex flex-col gap-1">
          <div className="h-1 w-3/4 rounded-sm bg-ink-primary/60" />
          <div className="h-0.5 w-1/2 rounded-sm bg-ink-primary/30" />
        </div>
      ),
    },
    {
      id: "splash",
      label: t("studio.heroLayoutSplash"),
      sketch: (
        <div className="w-full h-full p-1.5 flex flex-col items-center justify-center gap-1">
          <div className="h-1.5 w-2/3 rounded-sm bg-ink-primary/60" />
          <div className="h-0.5 w-1/2 rounded-sm bg-ink-primary/30" />
        </div>
      ),
    },
    {
      id: "side_by_side",
      label: t("studio.heroLayoutSideBySide"),
      sketch: (
        <div className="w-full h-full p-1.5 grid grid-cols-2 gap-1.5 items-center">
          <div className="flex flex-col gap-1">
            <div className="h-1 w-3/4 rounded-sm bg-ink-primary/60" />
            <div className="h-0.5 w-1/2 rounded-sm bg-ink-primary/30" />
          </div>
          <div className="h-full rounded-sm bg-ink-primary/25" />
        </div>
      ),
    },
    {
      id: "centered",
      label: t("studio.heroLayoutCentered"),
      sketch: (
        <div className="w-full h-full p-1.5 flex flex-col gap-1">
          <div className="flex flex-col items-center gap-0.5 pt-0.5">
            <div className="h-1 w-2/3 rounded-sm bg-ink-primary/60" />
            <div className="h-0.5 w-1/2 rounded-sm bg-ink-primary/30" />
          </div>
          <div className="flex-1 mt-1 rounded-sm bg-ink-primary/25" />
        </div>
      ),
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`rounded border p-2 text-left transition-colors duration-motion ${
              active
                ? "border-accent bg-accent/10"
                : "border-line-subtle bg-surface-sunken hover:border-line-strong"
            }`}
          >
            <div className="aspect-[4/3] w-full rounded-sm bg-surface-overlay/40 overflow-hidden">
              {opt.sketch}
            </div>
            <div className="mt-2 text-ui-xs font-medium text-ink-primary">
              {opt.label}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
/** Native <select> mit allen Fonts aus FONT_OPTIONS plus "Branding-Default"
 *  als Top-Option. Live-Preview: das ausgewählte Item zeigt im Select-
 *  Trigger denselben Font-Look (browser-abhängig, aber Chrome/Firefox
 *  rendern den selected text im option-font). Wir bauen die Preview
 *  zusätzlich darunter, damit Safari auch was sieht. */
function FontSelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => Promise<unknown> | unknown;
}) {
  const t = useT();
  const selected = value ? FONT_OPTIONS.find((f) => f.id === value) : null;

  return (
    <div className="space-y-1.5">
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="h-9 px-2.5 rounded bg-surface-sunken border border-line-subtle text-ui text-ink-primary focus:border-accent focus:outline-none w-full max-w-sm"
      >
        <option value="">{t("studio.fontDefault")}</option>
        <optgroup label="Sans-Serif">
          {FONT_OPTIONS.filter((f) => f.category === "sans").map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Serif">
          {FONT_OPTIONS.filter((f) => f.category === "serif").map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </optgroup>
      </select>
      {selected && (
        <div
          className="text-ui-md text-ink-secondary px-1"
          style={{ fontFamily: selected.stack }}
        >
          The quick brown fox · 1234567890
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
/** Radio-Card-Picker für Grid-Layout-Varianten. Drei Mini-Diagramme
 *  aus Divs, damit der Studio-User vor dem Klick sieht wie sich die
 *  Bilder anordnen werden. */
function GridLayoutPicker({
  value,
  onChange,
}: {
  value: "masonry" | "justified" | "equal";
  onChange: (v: "masonry" | "justified" | "equal") => Promise<unknown> | unknown;
}) {
  const t = useT();
  const options: {
    id: "masonry" | "justified" | "equal";
    label: string;
    sketch: React.ReactNode;
  }[] = [
    {
      id: "masonry",
      label: t("studio.gridMasonry"),
      // Drei Spalten mit variabel hohen Rechtecken — wie Pinterest
      sketch: (
        <div className="w-full h-full p-1.5 grid grid-cols-3 gap-1">
          <div className="flex flex-col gap-1">
            <div className="h-3 rounded-sm bg-ink-primary/40" />
            <div className="h-5 rounded-sm bg-ink-primary/40" />
            <div className="h-2 rounded-sm bg-ink-primary/40" />
          </div>
          <div className="flex flex-col gap-1">
            <div className="h-5 rounded-sm bg-ink-primary/40" />
            <div className="h-2 rounded-sm bg-ink-primary/40" />
            <div className="h-3 rounded-sm bg-ink-primary/40" />
          </div>
          <div className="flex flex-col gap-1">
            <div className="h-2 rounded-sm bg-ink-primary/40" />
            <div className="h-4 rounded-sm bg-ink-primary/40" />
            <div className="h-4 rounded-sm bg-ink-primary/40" />
          </div>
        </div>
      ),
    },
    {
      id: "justified",
      label: t("studio.gridJustified"),
      // Reihen-basiert: pro Reihe gleich hoch, variable Breiten
      sketch: (
        <div className="w-full h-full p-1.5 flex flex-col gap-1">
          <div className="flex gap-1 h-1/3">
            <div className="flex-[3] rounded-sm bg-ink-primary/40" />
            <div className="flex-[2] rounded-sm bg-ink-primary/40" />
            <div className="flex-[2] rounded-sm bg-ink-primary/40" />
          </div>
          <div className="flex gap-1 h-1/3">
            <div className="flex-[2] rounded-sm bg-ink-primary/40" />
            <div className="flex-[3] rounded-sm bg-ink-primary/40" />
            <div className="flex-[2] rounded-sm bg-ink-primary/40" />
          </div>
          <div className="flex gap-1 h-1/3">
            <div className="flex-[3] rounded-sm bg-ink-primary/40" />
            <div className="flex-[2] rounded-sm bg-ink-primary/40" />
            <div className="flex-[3] rounded-sm bg-ink-primary/40" />
          </div>
        </div>
      ),
    },
    {
      id: "equal",
      label: t("studio.gridEqual"),
      // Striktes Quadrat-Raster
      sketch: (
        <div className="w-full h-full p-1.5 grid grid-cols-3 grid-rows-3 gap-1">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="rounded-sm bg-ink-primary/40" />
          ))}
        </div>
      ),
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`rounded border p-2 text-left transition-colors duration-motion ${
              active
                ? "border-accent bg-accent/10"
                : "border-line-subtle bg-surface-sunken hover:border-line-strong"
            }`}
          >
            <div className="aspect-[4/3] w-full rounded-sm bg-surface-overlay/40 overflow-hidden">
              {opt.sketch}
            </div>
            <div className="mt-2 text-ui-xs font-medium text-ink-primary">
              {opt.label}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
/** Picker für den Slideshow-Übergangseffekt. Klein gehalten — drei
 *  Pill-Buttons. Hier kein Diagramm, weil eine statische Skizze von
 *  Bewegung wenig verrät; der Studio-User probiert es einfach in der
 *  Slideshow aus. */
function SlideshowTransitionPicker({
  value,
  onChange,
}: {
  value: "fade" | "slide" | "kenburns";
  onChange: (v: "fade" | "slide" | "kenburns") => Promise<unknown> | unknown;
}) {
  const t = useT();
  const options: { id: "fade" | "slide" | "kenburns"; label: string }[] = [
    { id: "fade", label: t("studio.slideshowFade") },
    { id: "slide", label: t("studio.slideshowSlide") },
    { id: "kenburns", label: t("studio.slideshowKenburns") },
  ];

  return (
    <div className="inline-flex items-center gap-0.5 bg-surface-sunken rounded p-0.5 border border-line-subtle">
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`h-8 px-3 rounded text-ui-sm transition-colors duration-motion ${
              active
                ? "bg-accent text-accent-contrast"
                : "text-ink-secondary hover:text-ink-primary hover:bg-surface-overlay"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
