"use client";

/**
 * GalleryFileTagFilter
 *
 * Tag-Filter-Bar fuer den Studio-Galerie-View. Aggregiert aus den
 * Files der Galerie welche Tags vorkommen + wie oft. Multi-Select-
 * Filter mit UND-Semantik (alle ausgewaehlten Tags muessen am File
 * sein) — analog zum bestehenden Galerie-Listing-Filter.
 *
 * Pro Galerie ein/ausschaltbar via localStorage-Key
 * 'lumio.tag-filter.${galleryId}.enabled'. Default: aus (kein
 * visueller Lärm wenn der User mit den Tags nicht arbeitet).
 *
 * Bei vielen Tags (> visibleLimit) wird die Liste eingeklappt und
 * 'mehr anzeigen' bietet die volle Sicht.
 */
import { useEffect, useMemo, useState } from "react";

type TagRef = { id: string; name: string; color: string };
type FileLike = { id: string; tags?: TagRef[] };

interface Props {
  galleryId: string;
  files: FileLike[];
  // Filter-State liegt im Parent damit Parent die Files filtern kann
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}

const VISIBLE_LIMIT = 15;

export function GalleryFileTagFilter({
  galleryId,
  files,
  selected,
  onChange,
}: Props) {
  // Aktivierungs-Status pro Galerie persistiert
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(
        `lumio.tag-filter.${galleryId}.enabled`
      );
      setEnabled(v === "1");
    } catch {
      setEnabled(false);
    }
  }, [galleryId]);

  function persistEnabled(v: boolean) {
    setEnabled(v);
    try {
      window.localStorage.setItem(
        `lumio.tag-filter.${galleryId}.enabled`,
        v ? "1" : "0"
      );
    } catch {
      // localStorage blockiert (private mode) — Toggle wirkt nur fuer
      // diese Session
    }
    // Bei Aus: Filter auch zuruecksetzen, damit beim naechsten Einschalten
    // nichts seltsam vorausgewaehlt ist
    if (!v && selected.size > 0) onChange(new Set());
  }

  // Tag-Aggregation client-side: Tag-ID → { tag-info, count }
  const aggregated = useMemo(() => {
    const map = new Map<string, { tag: TagRef; count: number }>();
    for (const f of files) {
      for (const t of f.tags ?? []) {
        const e = map.get(t.id);
        if (e) e.count++;
        else map.set(t.id, { tag: t, count: 1 });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.tag.name.localeCompare(b.tag.name);
    });
  }, [files]);

  // Compact-Anzeige wenn Filter aus
  if (enabled === null) return null;

  if (!enabled) {
    return (
      <div className="px-6 sm:px-8 py-2 border-b border-line-subtle flex items-center justify-between flex-wrap gap-2 text-ui-xs text-ink-tertiary">
        <span>
          {aggregated.length > 0
            ? `${aggregated.length} Tag${aggregated.length === 1 ? "" : "s"} auf Files in dieser Galerie`
            : "Noch keine Tags auf Files"}
        </span>
        {aggregated.length > 0 && (
          <button
            type="button"
            onClick={() => persistEnabled(true)}
            className="text-ink-secondary hover:text-accent"
          >
            Tag-Filter anzeigen →
          </button>
        )}
      </div>
    );
  }

  // Volle Filter-Bar
  const visible = showAll ? aggregated : aggregated.slice(0, VISIBLE_LIMIT);
  const hasMore = aggregated.length > VISIBLE_LIMIT;

  function toggleTag(tagId: string) {
    const next = new Set(selected);
    if (next.has(tagId)) next.delete(tagId);
    else next.add(tagId);
    onChange(next);
  }

  return (
    <div className="px-6 sm:px-8 py-3 border-b border-line-subtle">
      <div className="flex items-start gap-3 flex-wrap">
        <span className="text-ui-xs uppercase tracking-[0.12em] text-ink-tertiary mt-1 shrink-0">
          Tag-Filter
        </span>

        <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
          {aggregated.length === 0 ? (
            <span className="text-ui-xs text-ink-tertiary">
              Noch keine Tags auf Files in dieser Galerie.
            </span>
          ) : (
            <>
              {visible.map(({ tag, count }) => {
                const isOn = selected.has(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-colors ${
                      isOn
                        ? "border-accent bg-accent/12 text-ink-primary"
                        : "border-line-subtle hover:border-line-strong text-ink-secondary"
                    }`}
                    title={`${tag.name} (${count} Foto${count === 1 ? "" : "s"})`}
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span>{tag.name}</span>
                    <span className="text-ink-tertiary tabular-nums">
                      {count}
                    </span>
                  </button>
                );
              })}
              {hasMore && !showAll && (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="text-xs px-2 py-1 text-ink-tertiary hover:text-ink-secondary"
                >
                  +{aggregated.length - VISIBLE_LIMIT} mehr
                </button>
              )}
              {showAll && hasMore && (
                <button
                  type="button"
                  onClick={() => setShowAll(false)}
                  className="text-xs px-2 py-1 text-ink-tertiary hover:text-ink-secondary"
                >
                  weniger
                </button>
              )}
            </>
          )}
        </div>

        <div className="flex gap-2 items-center shrink-0">
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => onChange(new Set())}
              className="text-xs text-ink-tertiary hover:text-ink-secondary"
            >
              Auswahl löschen
            </button>
          )}
          <button
            type="button"
            onClick={() => persistEnabled(false)}
            className="text-xs text-ink-tertiary hover:text-ink-secondary"
            title="Tag-Filter ausblenden"
          >
            ✕
          </button>
        </div>
      </div>

      {selected.size > 0 && (
        <p className="mt-2 text-ui-xs text-ink-tertiary">
          {selected.size} {selected.size === 1 ? "Tag aktiv" : "Tags aktiv"} —
          nur Files anzeigen die ALLE diese Tags haben (UND-Filter).
        </p>
      )}
    </div>
  );
}
