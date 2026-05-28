"use client";

/**
 * FileTagsSection — Manuelle Tag-Verwaltung pro File
 *
 * Sitzt in der ProofingFileDetail-Sidebar. Zeigt die aktuellen Tags des
 * Files als Chips + erlaubt zuweisen/entfernen via dem generischen
 * TagPicker.
 *
 * Wird selbst-managend: laedt die Tags pro File-Wechsel, persistiert
 * Aenderungen sofort. Optimistic-Update macht TagPicker bereits.
 */
import { useCallback, useEffect, useState } from "react";
import { api, type Tag } from "@/lib/api";
import { TagPicker } from "@/components/studio/TagPicker";

export function FileTagsSection({ fileId }: { fileId: string }) {
  const [tags, setTags] = useState<Tag[] | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.getFileTags(fileId);
      setTags(r.tags);
    } catch {
      setTags([]);
    }
  }, [fileId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (tags === null) {
    return (
      <div className="px-4 py-3 border-b border-line-subtle text-ui-xs text-ink-tertiary">
        Lade Tags…
      </div>
    );
  }

  return (
    <div className="border-b border-line-subtle">
      <div className="px-4 py-3 text-ui-sm font-medium text-ink-primary flex items-center justify-between">
        <span>Tags</span>
        {tags.length > 0 && (
          <span className="text-ui-xs text-ink-tertiary font-normal">
            {tags.length}
          </span>
        )}
      </div>
      <div className="px-4 pb-3">
        <TagPicker
          current={tags}
          onAssign={async (tagId) => {
            await api.assignTagToFile(fileId, tagId);
            await load();
          }}
          onRemove={async (tagId) => {
            await api.removeTagFromFile(fileId, tagId);
            await load();
          }}
        />
      </div>
    </div>
  );
}
