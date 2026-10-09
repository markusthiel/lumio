"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Input, Textarea } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { useErrorText } from "@/lib/error-i18n";

/**
 * Name and description of a gallery, editable after it was created. First
 * section of the "settings" tab, styled like its neighbours there
 * (rounded-md/p-5, text-ui-md heading); one Save for both fields, like the
 * landing page's details section. Open to everyone who can open the
 * gallery, same as the API: only the slug is owner/admin-only, and renaming
 * does not touch the slug, so links already sent to clients keep working.
 */
export function GalleryDetailsEditor({
  galleryId,
  title,
  description,
  onChanged,
}: {
  galleryId: string;
  title: string;
  description: string | null;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const errText = useErrorText();
  const [name, setName] = useState(title);
  const [desc, setDesc] = useState(description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Follow the server values (another save reloaded the gallery), like the
  // landing page's details section.
  useEffect(() => setName(title), [title]);
  useEffect(() => setDesc(description ?? ""), [description]);

  const cleanedName = name.trim();
  const cleanedDesc = desc.trim();
  const dirty =
    cleanedName !== title || cleanedDesc !== (description ?? "").trim();
  const disabled = saving || !cleanedName || !dirty;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateGallery(galleryId, {
        title: cleanedName,
        description: cleanedDesc || null,
      });
      await onChanged();
    } catch (err) {
      setError(errText(err, t("studio.galleryDetailsSaveError")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-md border border-line-subtle bg-surface-raised p-5">
      <form onSubmit={save} className="space-y-3">
        <div>
          <h2 className="text-ui-md font-medium text-ink-primary">
            {t("studio.galleryDetailsHeading")}
          </h2>
          <p className="text-ui-sm text-ink-tertiary mt-0.5">
            {t("studio.galleryDetailsDesc")}
          </p>
        </div>

        <div className="space-y-1">
          <label
            htmlFor="gallery-name"
            className="text-ui-xs font-medium text-ink-secondary"
          >
            {t("studio.nameLabel")}
          </label>
          <Input
            id="gallery-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            required
            placeholder={t("studio.titlePlaceholder")}
          />
        </div>

        <div className="space-y-1">
          <label
            htmlFor="gallery-description"
            className="text-ui-xs font-medium text-ink-secondary"
          >
            {t("studio.descriptionLabel")}
          </label>
          <Textarea
            id="gallery-description"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            maxLength={2000}
            rows={3}
          />
        </div>

        {error && <p className="text-ui-sm text-semantic-danger">{error}</p>}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={disabled}>
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </form>
    </section>
  );
}
