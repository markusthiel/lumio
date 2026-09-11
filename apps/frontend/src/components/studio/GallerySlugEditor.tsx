"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useErrorText } from "@/lib/error-i18n";

/**
 * Owner/admin editor for the gallery's public share slug (/g/<slug>).
 * Rendered above SharePanel in the "share" tab, styled to match its
 * section convention (rounded-lg/p-4, div-wrapped heading+description)
 * since the slug is the base the share links build on top of. Hidden
 * entirely for members — a disabled field would still leak the fact
 * that the control exists.
 */
export function GallerySlugEditor({
  galleryId,
  slug,
  canEdit,
  publicAccess,
  hasPassword,
  onChanged,
}: {
  galleryId: string;
  slug: string;
  canEdit: boolean;
  publicAccess: boolean;
  hasPassword: boolean;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const errText = useErrorText();
  const [value, setValue] = useState(slug);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  if (!canEdit) return null;

  const cleaned = value.trim().toLowerCase();
  const disabled = saving || !cleaned || cleaned === slug;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.updateGallery(galleryId, { slug: cleaned });
      await onChanged();
    } catch (err) {
      setError(errText(err, t("studio.gallerySlugSaveError")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-lg border border-line-subtle bg-surface-raised p-4 space-y-3">
      <div>
        <h2 className="text-sm font-medium">{t("studio.gallerySlugHeading")}</h2>
        <p className="text-xs text-ink-tertiary mt-0.5">
          {t("studio.gallerySlugDesc")}
        </p>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-sm text-ink-tertiary font-mono whitespace-nowrap">
            {origin}/g/
          </span>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value.toLowerCase().replace(/\s/g, ""))}
            maxLength={60}
            aria-label={t("studio.gallerySlugHeading")}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="flex-1 min-w-0 rounded-md border border-line-subtle px-3 py-2 text-sm disabled:opacity-50"
          />
        </div>
        <button
          type="button"
          onClick={save}
          disabled={disabled}
          className="text-xs px-3 py-2 rounded-md bg-accent text-accent-contrast hover:bg-accent-hover disabled:opacity-50 whitespace-nowrap"
        >
          {saving ? t("common.saving") : t("common.save")}
        </button>
      </div>
      <div className="rounded-md bg-semantic-warning/10 border border-semantic-warning/30 px-3 py-2 text-xs text-ink-secondary leading-relaxed">
        {t("studio.gallerySlugWarnPre")}{" "}
        <span className="font-mono">
          {origin}/g/{slug}
        </span>{" "}
        {t("studio.gallerySlugWarnPost")}
      </div>
      {publicAccess && !hasPassword && (
        <div className="rounded-md bg-semantic-warning/10 border border-semantic-warning/30 px-3 py-2 text-xs text-ink-secondary leading-relaxed">
          {t("studio.gallerySlugWarnGuessable")}
        </div>
      )}
      {error && <p className="text-sm text-semantic-danger">{error}</p>}
    </section>
  );
}
