"use client";

/**
 * CustomerTagFilter — Tag-Filter-Bar fuer die Customer-Galerie
 *
 * Pendant zu GalleryFileTagFilter (Studio-Seite), aber:
 *  - kein Aktivierungs-Toggle (rendert nur wenn customerTagFilterEnabled
 *    an der Galerie aktiv ist — Parent entscheidet)
 *  - Tag-gefilterte ZIP-Download direkt aus der Bar (Customer-Endpoint
 *    POST /g/:slug/download/by-tags)
 *  - Styling folgt der Customer-Branding-Variable (var(--brand-...))
 *    statt der Studio-UI-Klassen
 *
 * Filter-State liegt im Parent damit das Grid die Files filtert.
 * UND-Semantik: File muss ALLE ausgewaehlten Tags haben (analog Studio).
 *
 * Bei vielen Tags (> VISIBLE_LIMIT) Expansion via 'mehr anzeigen'.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type ZipStatus } from "@/lib/api";
import { useT } from "@/lib/i18n";

type TagRef = { id: string; name: string; color: string };
type FileLike = { id: string; tags?: TagRef[] };

interface Props {
  slug: string;
  files: FileLike[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  filteredCount: number;
  /** Steuert ob der ZIP-Download-Button sichtbar ist. False wenn
   *  Galerie downloadEnabled=false. */
  downloadEnabled: boolean;
}

const VISIBLE_LIMIT = 12;

export function CustomerTagFilter({
  slug,
  files,
  selected,
  onChange,
  filteredCount,
  downloadEnabled,
}: Props) {
  useT(); // Reserviert fuer spaetere i18n-Strings
  const [showAll, setShowAll] = useState(false);
  const [zipJob, setZipJob] = useState<{
    zipId: string;
    status: ZipStatus;
    fileCount: number | null;
    error: string | null;
  } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Tag-Aggregation client-side: nur Tags die wirklich an Files haengen,
  // sortiert nach Haeufigkeit absteigend.
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

  if (aggregated.length === 0) {
    // Galerie hat Customer-Tags aktiviert aber keine Files tatsaechlich
    // getaggt → nichts rendern statt leere Bar.
    return null;
  }

  function toggleTag(tagId: string) {
    const next = new Set(selected);
    if (next.has(tagId)) next.delete(tagId);
    else next.add(tagId);
    onChange(next);
  }

  async function onRequestZip() {
    if (selected.size === 0) return;
    try {
      const res = await api.requestZipByTags(slug, "original", Array.from(selected));
      setZipJob({
        zipId: res.id,
        status: res.status,
        fileCount: res.fileCount,
        error: null,
      });
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const st = await api.getZipStatus(slug, res.id);
          setZipJob((prev) =>
            prev
              ? {
                  ...prev,
                  status: st.status,
                  fileCount: st.fileCount,
                  error: st.errorMessage,
                }
              : prev
          );
          if (st.status === "ready" || st.status === "failed") {
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
          }
        } catch (err) {
          console.error("customer zip poll failed:", err);
        }
      }, 2000);
    } catch (err) {
      setZipJob({
        zipId: "",
        status: "failed",
        fileCount: null,
        error: err instanceof Error ? err.message : "Fehler",
      });
    }
  }

  const visible = showAll ? aggregated : aggregated.slice(0, VISIBLE_LIMIT);
  const hasMore = aggregated.length > VISIBLE_LIMIT;

  return (
    <div
      className="px-4 sm:px-6 md:px-12 py-4 border-b"
      style={{
        backgroundColor: "var(--brand-toolbar-bg)",
        borderColor: "var(--brand-border)",
        color: "var(--brand-fg)",
      }}
    >
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="text-xs uppercase tracking-wider mr-2"
            style={{ color: "var(--brand-fg-muted)" }}
          >
            Nach Tags filtern
          </span>
          {visible.map(({ tag, count }) => {
            const isOn = selected.has(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggleTag(tag.id)}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors"
                style={{
                  borderColor: isOn
                    ? "rgb(var(--brand-accent))"
                    : "var(--brand-border)",
                  backgroundColor: isOn
                    ? "rgb(var(--brand-accent) / 0.18)"
                    : "var(--brand-surface)",
                  color: "var(--brand-fg)",
                }}
                title={`${tag.name} (${count} ${count === 1 ? "Foto" : "Fotos"})`}
              >
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
                <span>{tag.name}</span>
                <span style={{ color: "var(--brand-fg-muted)" }}>{count}</span>
              </button>
            );
          })}
          {hasMore && !showAll && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="text-xs px-2 py-1 hover:underline"
              style={{ color: "var(--brand-fg-muted)" }}
            >
              +{aggregated.length - VISIBLE_LIMIT} mehr
            </button>
          )}
          {showAll && hasMore && (
            <button
              type="button"
              onClick={() => setShowAll(false)}
              className="text-xs px-2 py-1 hover:underline"
              style={{ color: "var(--brand-fg-muted)" }}
            >
              weniger
            </button>
          )}
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => onChange(new Set())}
              className="text-xs px-2 py-1 hover:underline ml-auto"
              style={{ color: "var(--brand-fg-muted)" }}
            >
              Filter zurücksetzen
            </button>
          )}
        </div>

        {selected.size > 0 && (
          <div className="mt-3 flex items-center justify-between flex-wrap gap-3">
            <p
              className="text-xs"
              style={{ color: "var(--brand-fg-muted)" }}
            >
              {selected.size === 1
                ? "1 Filter aktiv"
                : `${selected.size} Filter aktiv`}{" "}
              — {filteredCount}{" "}
              {filteredCount === 1 ? "Foto" : "Fotos"} sichtbar
            </p>

            {downloadEnabled && filteredCount > 0 && (
              <div className="flex items-center gap-3 flex-wrap">
                {!zipJob && (
                  <button
                    type="button"
                    onClick={onRequestZip}
                    className="text-xs px-3 py-1.5 rounded-full font-medium"
                    style={{
                      backgroundColor: "rgb(var(--brand-accent))",
                      color: "rgb(var(--brand-accent-contrast))",
                    }}
                  >
                    ⬇ {filteredCount} {filteredCount === 1 ? "Foto" : "Fotos"} herunterladen
                  </button>
                )}
                {zipJob &&
                  zipJob.status !== "ready" &&
                  zipJob.status !== "failed" && (
                    <span
                      className="text-xs flex items-center gap-2"
                      style={{ color: "var(--brand-fg-muted)" }}
                    >
                      <span
                        className="inline-block w-2 h-2 rounded-full animate-pulse"
                        style={{
                          backgroundColor: "rgb(var(--brand-accent))",
                        }}
                      />
                      ZIP wird erstellt…
                    </span>
                  )}
                {zipJob && zipJob.status === "ready" && (
                  <a
                    href={api.zipDownloadUrl(slug, zipJob.zipId)}
                    className="text-xs px-3 py-1.5 rounded-full font-medium"
                    style={{
                      backgroundColor: "rgb(var(--brand-accent))",
                      color: "rgb(var(--brand-accent-contrast))",
                    }}
                  >
                    ✓ ZIP herunterladen ({zipJob.fileCount}{" "}
                    {zipJob.fileCount === 1 ? "Foto" : "Fotos"})
                  </a>
                )}
                {zipJob && zipJob.status === "failed" && (
                  <span
                    className="text-xs"
                    style={{ color: "rgb(220 38 38)" }}
                  >
                    Fehler{zipJob.error ? `: ${zipJob.error}` : ""}
                  </span>
                )}
                {zipJob && (
                  <button
                    type="button"
                    onClick={() => setZipJob(null)}
                    className="text-xs hover:underline"
                    style={{ color: "var(--brand-fg-muted)" }}
                  >
                    ✕
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
