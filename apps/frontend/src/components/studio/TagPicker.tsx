"use client";

/**
 * TagPicker — wiederverwendbare Tag-Assign-UI.
 *
 * Verhalten:
 *   - Zeigt die aktuell zugewiesenen Tags als Chips mit X zum Entfernen
 *   - "+" öffnet ein kleines Popover mit der vollen Tag-Liste; Klick
 *     fügt zu
 *   - Optimistic-Update: lokal sofort, Rollback bei API-Fehler
 *
 * Wird sowohl für Galerien als auch für Files verwendet — der Caller
 * gibt den passenden onAssign/onRemove-Callback rein.
 *
 * Bewusst KEIN inline-Create. Tags zu erstellen geht nur unter
 * /studio/tags. Das hält den Picker schlank und verhindert Tippfehler-
 * basierte Tag-Wildwucherung.
 */
import { useEffect, useRef, useState } from "react";
import type { Tag, TagSummary } from "@/lib/api";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";

interface Props {
  current: Tag[];
  onAssign: (tagId: string) => Promise<void> | void;
  onRemove: (tagId: string) => Promise<void> | void;
}

export function TagPicker({ current, onAssign, onRemove }: Props) {
  const t = useT();
  const [allTags, setAllTags] = useState<TagSummary[] | null>(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Lazy-Load: erst beim Öffnen die Tag-Liste holen. Sonst feuert jede
  // Galerie-Detail-Page einen unnötigen /tags-Call.
  useEffect(() => {
    if (!open || allTags) return;
    void api.listTags().then((res) => setAllTags(res.tags));
  }, [open, allTags]);

  // Click-Outside zum Schließen
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const currentIds = new Set(current.map((t) => t.id));
  const assignable = (allTags ?? []).filter((t) => !currentIds.has(t.id));

  return (
    <div ref={containerRef} className="relative inline-flex flex-wrap gap-1 items-center">
      {current.map((tag) => (
        <Chip
          key={tag.id}
          tag={tag}
          onRemove={() => onRemove(tag.id)}
        />
      ))}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 h-6 px-2 rounded-xs text-ui-xs text-ink-tertiary hover:text-ink-secondary border border-dashed border-line-subtle hover:border-line-strong transition-colors duration-motion"
      >
        + {t("studio.tagAdd")}
      </button>

      {open && (
        <div className="absolute z-20 top-full left-0 mt-1 w-64 max-h-72 overflow-y-auto rounded-md border border-line-strong bg-surface-raised shadow-lg p-1">
          {allTags === null ? (
            <div className="text-ui-sm text-ink-tertiary px-2 py-1.5">
              {t("common.loading")}
            </div>
          ) : assignable.length === 0 ? (
            <div className="text-ui-sm text-ink-tertiary px-2 py-1.5">
              {allTags.length === 0
                ? t("studio.tagPickerNoneYet")
                : t("studio.tagPickerAllAssigned")}
            </div>
          ) : (
            assignable.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={async () => {
                  setOpen(false);
                  await onAssign(tag.id);
                }}
                className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-xs text-ui-sm text-ink-primary hover:bg-surface-sunken transition-colors duration-motion"
              >
                <span
                  className="block w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: tag.color }}
                  aria-hidden
                />
                <span className="truncate">{tag.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
function Chip({ tag, onRemove }: { tag: Tag; onRemove: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1 h-6 pl-1.5 pr-1 rounded-xs text-ui-xs"
      style={{
        backgroundColor: tag.color + "22", // 13% alpha
        color: tag.color,
        border: `1px solid ${tag.color}44`,
      }}
    >
      <span className="truncate max-w-[120px]">{tag.name}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label="remove tag"
        className="w-4 h-4 inline-flex items-center justify-center rounded-xs hover:bg-black/10 dark:hover:bg-white/10"
      >
        ×
      </button>
    </span>
  );
}

/**
 * Kleine read-only Chip-Anzeige, die wir in Listen verwenden (z.B.
 * Galerie-Übersicht). Kein Remove-Button, weniger Padding.
 */
export function TagChip({ tag }: { tag: Tag }) {
  return (
    <span
      className="inline-flex items-center h-5 px-1.5 rounded-xs text-[10px] tracking-wide"
      style={{
        backgroundColor: tag.color + "22",
        color: tag.color,
        border: `1px solid ${tag.color}44`,
      }}
    >
      {tag.name}
    </span>
  );
}
