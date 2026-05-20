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

  // Lokaler Markdown-State für debounced Save
  const [markdown, setMarkdown] = useState(gallery.welcomeMarkdown ?? "");
  const [markdownPreview, setMarkdownPreview] = useState(false);
  const markdownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Wenn die Galerie von außen aktualisiert wird (z.B. anderer Save),
  // den lokalen State angleichen — aber nur wenn der User gerade nicht
  // tippt (sonst überschreiben wir seine Eingabe).
  useEffect(() => {
    if (markdownTimerRef.current) return;
    setMarkdown(gallery.welcomeMarkdown ?? "");
  }, [gallery.welcomeMarkdown]);

  function debouncedSaveMarkdown(next: string) {
    setMarkdown(next);
    if (markdownTimerRef.current) clearTimeout(markdownTimerRef.current);
    markdownTimerRef.current = setTimeout(async () => {
      await api.updateGallery(gallery.id, {
        welcomeMarkdown: next || null,
      });
      markdownTimerRef.current = null;
      await onChanged();
    }, 800);
  }

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
            {t("studio.headerEditor")}
          </h2>
          <p className="text-ui-xs text-ink-tertiary mt-0.5">
            {t("studio.headerEditorHint")}
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
          <Field
            label={t("studio.welcomeMarkdown")}
            hint={t("studio.welcomeMarkdownHint")}
            actions={
              <button
                type="button"
                onClick={() => setMarkdownPreview((s) => !s)}
                className="text-ui-xs text-accent hover:text-accent-hover"
              >
                {markdownPreview ? t("studio.edit") : t("studio.preview")}
              </button>
            }
          >
            {markdownPreview ? (
              <div className="prose prose-invert prose-sm max-w-none p-3 rounded bg-surface-sunken border border-line-subtle min-h-[120px]">
                {markdown ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
                    {markdown}
                  </ReactMarkdown>
                ) : (
                  <p className="text-ink-tertiary italic">
                    {t("studio.welcomeMarkdownEmpty")}
                  </p>
                )}
              </div>
            ) : (
              <textarea
                value={markdown}
                onChange={(e) => debouncedSaveMarkdown(e.target.value)}
                rows={6}
                maxLength={20_000}
                placeholder={t("studio.welcomeMarkdownPlaceholder")}
                className="w-full px-3 py-2 rounded bg-surface-sunken border border-line-subtle text-ui text-ink-primary font-mono text-ui-sm focus:border-accent focus:outline-none resize-y"
              />
            )}
          </Field>
        </div>
      )}
    </section>
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
