"use client";

/**
 * Kapitel-Filter über dem Bilder-Raster im Studio (#73). Bisher tauchten
 * Kapitel nur im Kapitel-Editor auf; im Raster sah man nicht, welches Bild
 * wohin gehört. Erscheint nur, wenn die Galerie Kapitel hat.
 */
import { useEffect, useState } from "react";
import { api, type StudioSection } from "@/lib/api";
import { useT } from "@/lib/i18n";

/** "" = alle, "none" = ohne Kapitel, sonst Section-ID. */
export type ChapterFilterValue = string;

export function GalleryChapterFilter({
  galleryId,
  files,
  value,
  onChange,
}: {
  galleryId: string;
  files: { sectionId?: string | null }[];
  value: ChapterFilterValue;
  onChange: (v: ChapterFilterValue) => void;
}) {
  const t = useT();
  const [sections, setSections] = useState<StudioSection[]>([]);
  // Neu laden, wenn sich Dateien oder Zuordnungen ändern.
  const signature = files.map((f) => f.sectionId ?? "-").join(",");
  useEffect(() => {
    let alive = true;
    api
      .listSections(galleryId)
      .then((r) => {
        if (alive) setSections([...r.sections].sort((a, b) => a.sortIndex - b.sortIndex));
      })
      .catch(() => {
        /* ohne Kapitel kein Filter */
      });
    return () => {
      alive = false;
    };
  }, [galleryId, signature]);

  // Gelöschtes Kapitel ausgewählt? Zurück auf alle.
  useEffect(() => {
    if (value && value !== "none" && sections.length > 0 && !sections.some((s) => s.id === value)) {
      onChange("");
    }
  }, [sections, value, onChange]);

  if (sections.length === 0) return null;

  const counts = new Map<string, number>();
  let none = 0;
  for (const f of files) {
    if (f.sectionId) counts.set(f.sectionId, (counts.get(f.sectionId) ?? 0) + 1);
    else none++;
  }

  const chip = (id: string, label: string, n: number) => {
    const on = value === id;
    return (
      <button
        key={id || "all"}
        type="button"
        aria-pressed={on}
        onClick={() => onChange(on && id !== "" ? "" : id)}
        className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-ui-xs transition-colors duration-motion ${
          on
            ? "bg-accent text-ink-inverted font-medium"
            : "border border-line-subtle bg-surface-sunken text-ink-secondary hover:text-ink-primary hover:border-line-strong"
        }`}
      >
        <span className="max-w-[14rem] truncate">{label}</span>
        <span className={on ? "opacity-80" : "text-ink-tertiary"}>{n}</span>
      </button>
    );
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5" role="group" aria-label={t("folders.chapterFilterLabel")}>
      <span className="text-ui-xs uppercase tracking-[0.12em] text-ink-tertiary mr-1.5">
        {t("folders.chapters")}
      </span>
      {chip("", t("folders.chapterAll"), files.length)}
      {sections.map((s) => chip(s.id, s.title, counts.get(s.id) ?? 0))}
      {none > 0 && chip("none", t("folders.chapterNone"), none)}
    </div>
  );
}
