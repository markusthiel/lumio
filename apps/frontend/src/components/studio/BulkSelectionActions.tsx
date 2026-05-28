"use client";

/**
 * BulkSelectionActions — Bulk Tag + Section Aktionen fuer die Studio-
 * Selection-Toolbar.
 *
 * Zwei Dropdowns:
 *   - 'Tag …' → Auswahl eines Tags + 'hinzufuegen' oder 'entfernen'
 *   - 'In Section …' → Auswahl einer Section (oder 'kein Section')
 *
 * Beide schliessen sich nach erfolgreichem Klick. Tag-Liste kommt
 * lazy beim ersten Oeffnen (vermeidet Tag-listTags-Call beim
 * Galerie-Load wenn der User das Feature gar nicht nutzt).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type TagSummary, type StudioSection } from "@/lib/api";
import { Button } from "@/components/ui/Button";

interface Props {
  galleryId: string;
  selectedFileIds: string[];
  disabled?: boolean;
  /** Callback nach erfolgreicher Bulk-Aktion. Parent sollte:
   *   - load() neu laden
   *   - exitSelectionMode() ggf. */
  onApplied: () => void;
}

export function BulkSelectionActions({
  galleryId,
  selectedFileIds,
  disabled,
  onApplied,
}: Props) {
  const [open, setOpen] = useState<"tag" | "section" | null>(null);
  const [tags, setTags] = useState<TagSummary[] | null>(null);
  const [sections, setSections] = useState<StudioSection[] | null>(null);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Outside-Click → Popover schliessen
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setOpen(null);
      }
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const loadTags = useCallback(async () => {
    if (tags !== null) return;
    try {
      const r = await api.listTags();
      setTags(r.tags);
    } catch {
      setTags([]);
    }
  }, [tags]);

  const loadSections = useCallback(async () => {
    if (sections !== null) return;
    try {
      const r = await api.listSections(galleryId);
      setSections(r.sections);
    } catch {
      setSections([]);
    }
  }, [sections, galleryId]);

  async function applyTag(tag: TagSummary, mode: "assign" | "remove") {
    if (selectedFileIds.length === 0) return;
    setBusy(true);
    try {
      const CHUNK = 500;
      for (let i = 0; i < selectedFileIds.length; i += CHUNK) {
        await api.bulkFileAction({
          galleryId,
          fileIds: selectedFileIds.slice(i, i + CHUNK),
          action: mode === "assign" ? "assign_tag" : "remove_tag",
          tagId: tag.id,
        });
      }
      setOpen(null);
      onApplied();
    } finally {
      setBusy(false);
    }
  }

  async function moveToSection(sectionId: string | null) {
    if (selectedFileIds.length === 0) return;
    setBusy(true);
    try {
      const CHUNK = 500;
      for (let i = 0; i < selectedFileIds.length; i += CHUNK) {
        await api.bulkFileAction({
          galleryId,
          fileIds: selectedFileIds.slice(i, i + CHUNK),
          action: "move_to_section",
          sectionId,
        });
      }
      setOpen(null);
      onApplied();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative inline-flex gap-1">
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled || selectedFileIds.length === 0 || busy}
        onClick={() => {
          setOpen(open === "tag" ? null : "tag");
          void loadTags();
        }}
      >
        Tag …
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled || selectedFileIds.length === 0 || busy}
        onClick={() => {
          setOpen(open === "section" ? null : "section");
          void loadSections();
        }}
      >
        Section …
      </Button>

      {open === "tag" && (
        <div className="absolute top-full left-0 mt-1 z-50 w-72 max-h-96 overflow-auto rounded-md border border-line-subtle bg-surface-raised shadow-lg">
          <div className="px-3 py-2 border-b border-line-subtle text-ui-xs text-ink-tertiary">
            Tag für {selectedFileIds.length}{" "}
            {selectedFileIds.length === 1 ? "Foto" : "Fotos"}
          </div>
          {tags === null && (
            <div className="px-3 py-3 text-ui-xs text-ink-tertiary">
              Lade Tags…
            </div>
          )}
          {tags && tags.length === 0 && (
            <div className="px-3 py-3 text-ui-xs text-ink-tertiary">
              Keine Tags angelegt. Lege erst unter Studio → Tags Tags an.
            </div>
          )}
          {tags &&
            tags.map((tag) => (
              <div
                key={tag.id}
                className="px-3 py-2 flex items-center gap-2 hover:bg-surface-sunken"
              >
                <span
                  className="inline-block w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: tag.color }}
                />
                <span className="text-ui-sm text-ink-secondary flex-1 truncate">
                  {tag.name}
                </span>
                <button
                  type="button"
                  onClick={() => void applyTag(tag, "assign")}
                  disabled={busy}
                  className="text-xs px-2 py-0.5 rounded bg-accent/12 hover:bg-accent/20 text-accent border border-accent/30 disabled:opacity-50"
                  title="An die Auswahl hängen"
                >
                  + setzen
                </button>
                <button
                  type="button"
                  onClick={() => void applyTag(tag, "remove")}
                  disabled={busy}
                  className="text-xs px-2 py-0.5 rounded bg-surface-sunken hover:bg-surface-raised text-ink-secondary border border-line-subtle disabled:opacity-50"
                  title="Von der Auswahl entfernen"
                >
                  − entf.
                </button>
              </div>
            ))}
        </div>
      )}

      {open === "section" && (
        <div className="absolute top-full left-0 mt-1 z-50 w-72 max-h-96 overflow-auto rounded-md border border-line-subtle bg-surface-raised shadow-lg">
          <div className="px-3 py-2 border-b border-line-subtle text-ui-xs text-ink-tertiary">
            {selectedFileIds.length}{" "}
            {selectedFileIds.length === 1 ? "Foto verschieben nach…" : "Fotos verschieben nach…"}
          </div>
          {sections === null && (
            <div className="px-3 py-3 text-ui-xs text-ink-tertiary">
              Lade Sections…
            </div>
          )}
          {sections && sections.length === 0 && (
            <div className="px-3 py-3 text-ui-xs text-ink-tertiary">
              Keine Sections angelegt. Lege erst in den Galerie-Settings
              Sections an.
            </div>
          )}
          {sections &&
            sections.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => void moveToSection(s.id)}
                disabled={busy}
                className="w-full text-left px-3 py-2 text-ui-sm text-ink-secondary hover:bg-surface-sunken disabled:opacity-50"
              >
                {s.title}
              </button>
            ))}
          {sections && sections.length > 0 && (
            <button
              type="button"
              onClick={() => void moveToSection(null)}
              disabled={busy}
              className="w-full text-left px-3 py-2 text-ui-sm text-ink-tertiary hover:bg-surface-sunken border-t border-line-subtle disabled:opacity-50"
            >
              ohne Section (Default-Bucket)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
