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
 *
 * ZIP-Download: wenn Filter aktiv ist, kann der Fotograf ein ZIP der
 * gefilterten Files anfordern. Backend resolved Tags → Files, baut
 * ZIP, gibt URL zum Teilen mit der Kundin.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";

type TagRef = { id: string; name: string; color: string };
type FileLike = { id: string; tags?: TagRef[] };

interface Props {
  galleryId: string;
  files: FileLike[];
  // Filter-State liegt im Parent damit Parent die Files filtern kann
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  // Anzahl der gefilterten Files — Parent berechnet eh, kann's uns
  // geben damit der Download-Button die Zahl zeigt
  filteredCount: number;
}

const VISIBLE_LIMIT = 15;

export function GalleryFileTagFilter({
  galleryId,
  files,
  selected,
  onChange,
  filteredCount,
}: Props) {
  // Aktivierungs-Status pro Galerie persistiert
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [showAll, setShowAll] = useState(false);
  // ZIP-Download-State: { zipId, status, url } — null wenn kein laufender Job
  const [zipJob, setZipJob] = useState<{
    zipId: string;
    status: string;
    fileCount: number | null;
    url: string | null;
    error: string | null;
  } | null>(null);
  // Share-URL Copy-Feedback (5s)
  const [shareInfo, setShareInfo] = useState<{
    copied: boolean;
    expiresAt: string;
  } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Cleanup-Effect fuer Polling
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

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

  async function onRequestZip() {
    if (selected.size === 0) return;
    try {
      const res = await api.requestStudioZip(galleryId, {
        tagIds: Array.from(selected),
        variant: "original",
      });
      setZipJob({
        zipId: res.id,
        status: res.status,
        fileCount: res.fileCount,
        url: null,
        error: null,
      });
      // Polling starten — alle 2s, bis 'ready' oder 'failed'
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const st = await api.getStudioZipStatus(galleryId, res.id);
          setZipJob((prev) =>
            prev
              ? {
                  ...prev,
                  status: st.status,
                  fileCount: st.fileCount,
                  error: st.errorMessage,
                  url:
                    st.status === "ready"
                      ? api.studioZipDownloadUrl(galleryId, res.id)
                      : null,
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
          console.error("zip status poll failed:", err);
        }
      }, 2000);
    } catch (err) {
      setZipJob({
        zipId: "",
        status: "failed",
        fileCount: null,
        url: null,
        error: err instanceof Error ? err.message : "Fehler",
      });
    }
  }

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
        <>
          <p className="mt-2 text-ui-xs text-ink-tertiary">
            {selected.size} {selected.size === 1 ? "Tag aktiv" : "Tags aktiv"} —
            zeigt {filteredCount}{" "}
            {filteredCount === 1 ? "Foto" : "Fotos"} die ALLE diese Tags haben
            (UND-Filter).
          </p>

          {/* ZIP-Download-Bereich: nur wenn Filter wirklich Files matcht */}
          {filteredCount > 0 && (
            <div className="mt-3 pt-3 border-t border-line-subtle">
              {!zipJob && (
                <button
                  type="button"
                  onClick={onRequestZip}
                  className="px-3 py-1.5 text-xs rounded bg-accent text-white hover:bg-accent/90"
                  title="Erzeugt ein ZIP der gefilterten Fotos zum Teilen mit der Kundin"
                >
                  ⬇ {filteredCount} Foto{filteredCount === 1 ? "" : "s"} als ZIP herunterladen
                </button>
              )}
              {zipJob && zipJob.status !== "ready" && zipJob.status !== "failed" && (
                <div className="flex items-center gap-2 text-xs text-ink-secondary">
                  <span className="inline-block w-3 h-3 rounded-full bg-accent animate-pulse" />
                  ZIP wird gebaut
                  {zipJob.fileCount !== null && (
                    <span className="text-ink-tertiary">
                      ({zipJob.fileCount} Foto{zipJob.fileCount === 1 ? "" : "s"})
                    </span>
                  )}
                  <span className="text-ink-tertiary">— wenige Sekunden bis Minuten</span>
                </div>
              )}
              {zipJob && zipJob.status === "ready" && zipJob.url && (
                <div className="flex items-center gap-3 flex-wrap">
                  <a
                    href={zipJob.url}
                    className="px-3 py-1.5 text-xs rounded bg-semantic-success/15 text-semantic-success border border-semantic-success/40 hover:bg-semantic-success/25 font-medium"
                  >
                    ✓ ZIP herunterladen ({zipJob.fileCount} Foto{zipJob.fileCount === 1 ? "" : "s"})
                  </a>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const r = await api.getStudioZipShareUrl(
                          galleryId,
                          zipJob.zipId
                        );
                        await navigator.clipboard?.writeText(r.url);
                        // Sicht-Feedback: kurz die Url im UI zeigen
                        setShareInfo({
                          copied: true,
                          expiresAt: r.expiresAt,
                        });
                        setTimeout(
                          () => setShareInfo(null),
                          5000
                        );
                      } catch (err) {
                        console.error("share-url failed:", err);
                      }
                    }}
                    className="text-xs text-ink-secondary hover:text-accent border border-line-subtle rounded px-2 py-1"
                    title="Teilbaren Download-Link (24h gültig) in die Zwischenablage kopieren"
                  >
                    🔗 Link für Kundin kopieren
                  </button>
                  {shareInfo?.copied && (
                    <span className="text-xs text-semantic-success">
                      Link kopiert (gültig 24h)
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setZipJob(null)}
                    className="text-xs text-ink-tertiary hover:text-ink-secondary"
                  >
                    schließen
                  </button>
                </div>
              )}
              {zipJob && zipJob.status === "failed" && (
                <div className="text-xs text-semantic-danger flex items-center gap-2">
                  ZIP-Erzeugung fehlgeschlagen
                  {zipJob.error && (
                    <span className="text-ink-tertiary">— {zipJob.error}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setZipJob(null)}
                    className="text-ink-secondary hover:text-ink-primary"
                  >
                    schließen
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
