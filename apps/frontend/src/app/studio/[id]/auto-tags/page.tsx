"use client";

/**
 * Studio — Auto-Tag Review-Seite (Feature 'ai_tagging')
 *
 * /studio/[id]/auto-tags
 *
 * Zeigt alle 'suggested' Auto-Tag-Vorschlaege der Galerie gruppiert
 * nach Tag-Name. Pro Tag-Gruppe:
 *   - Header: Label, count, durchschnittliche Confidence
 *   - File-Grid mit Thumb + Confidence-Badge
 *   - Per-File Checkbox (default: alle ausgewaehlt)
 *   - "Auswahl uebernehmen" / "Auswahl verwerfen" Buttons
 *
 * Optional: Per-File auch in der File-Detail-Sidebar (existiert schon
 * in ProofingFileDetail.tsx); diese Seite ist die Bulk-Variante.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/studio/PageHeader";

export const dynamic = "force-dynamic";

type Suggestion = {
  autoTagId: string;
  fileId: string;
  filename: string;
  confidence: number;
  source: string;
  thumbUrl: string | null;
};
type Group = {
  tagName: string;
  label: string;
  group: string | null;
  color: string;
  count: number;
  avgConfidence: number;
  hasMore: boolean;
  suggestions: Suggestion[];
};

export default function AutoTagsReviewPage() {
  const params = useParams<{ id: string }>();
  const galleryId = params.id;
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [galleryTitle, setGalleryTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Pro Gruppe: Set der ausgewaehlten autoTagIds. Default: alle.
  const [selected, setSelected] = useState<Map<string, Set<string>>>(
    new Map()
  );
  // Pro Gruppe: collapsed/expanded
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [pending, gallery] = await Promise.all([
        api.getGalleryAutoTagsPending(galleryId),
        api.getGallery(galleryId).catch(() => null),
      ]);
      setGroups(pending.groups);
      if (gallery) setGalleryTitle(gallery.gallery.title);
      // Default-Selection: alles ausgewaehlt
      const sel = new Map<string, Set<string>>();
      for (const g of pending.groups) {
        sel.set(
          g.tagName,
          new Set(g.suggestions.map((s) => s.autoTagId))
        );
      }
      setSelected(sel);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    }
  }, [galleryId]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleFile(tagName: string, autoTagId: string) {
    setSelected((prev) => {
      const next = new Map(prev);
      const cur = new Set(next.get(tagName) ?? []);
      if (cur.has(autoTagId)) cur.delete(autoTagId);
      else cur.add(autoTagId);
      next.set(tagName, cur);
      return next;
    });
  }
  function selectAll(tagName: string, group: Group) {
    setSelected((prev) => {
      const next = new Map(prev);
      next.set(tagName, new Set(group.suggestions.map((s) => s.autoTagId)));
      return next;
    });
  }
  function selectNone(tagName: string) {
    setSelected((prev) => {
      const next = new Map(prev);
      next.set(tagName, new Set());
      return next;
    });
  }
  function toggleCollapse(tagName: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(tagName)) next.delete(tagName);
      else next.add(tagName);
      return next;
    });
  }

  async function onAcceptGroup(group: Group) {
    const ids = Array.from(selected.get(group.tagName) ?? []);
    if (ids.length === 0) return;
    setBusy(`accept-${group.tagName}`);
    try {
      await api.acceptTagGroup(galleryId, group.tagName, ids);
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function onRejectGroup(group: Group) {
    const ids = Array.from(selected.get(group.tagName) ?? []);
    if (ids.length === 0) return;
    setBusy(`reject-${group.tagName}`);
    try {
      await api.rejectTagGroup(galleryId, group.tagName, ids);
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "Studio", href: "/studio" },
          { label: galleryTitle, href: `/studio/${galleryId}` },
          { label: "KI-Vorschläge" },
        ]}
        title="KI-Vorschläge"
        description={
          groups
            ? `${groups.reduce((s, g) => s + g.count, 0)} offene Vorschläge in ${groups.length} Tag-Gruppen`
            : ""
        }
      />

      <div className="px-6 sm:px-8 py-6 space-y-6 max-w-7xl">
        {error && (
          <div className="rounded-md border border-semantic-danger/30 bg-semantic-danger/8 px-3 py-2 text-sm text-semantic-danger">
            {error}
          </div>
        )}

        {!groups && !error && (
          <div className="text-sm text-ink-tertiary">Lädt…</div>
        )}

        {groups && groups.length === 0 && (
          <div className="rounded-md border border-line-subtle bg-surface-raised p-8 text-center">
            <div className="text-ink-secondary mb-2">
              Keine offenen Vorschläge.
            </div>
            <div className="text-xs text-ink-tertiary">
              Entweder hast du schon alle reviewt, oder die KI ist noch am
              Tagging. Du kannst mit „Galerie neu taggen" auf der
              Galerie-Seite einen erneuten Lauf starten.
            </div>
            <Link
              href={`/studio/${galleryId}`}
              className="inline-block mt-4 text-sm text-accent hover:underline"
            >
              ← Zurück zur Galerie
            </Link>
          </div>
        )}

        {groups &&
          groups.map((g) => {
            const sel = selected.get(g.tagName) ?? new Set();
            const isCollapsed = collapsed.has(g.tagName);
            return (
              <section
                key={g.tagName}
                className="rounded-md border border-line-subtle bg-surface-raised overflow-hidden"
              >
                <header
                  className="px-4 py-3 border-b border-line-subtle flex items-center justify-between flex-wrap gap-3 cursor-pointer hover:bg-surface-sunken"
                  onClick={() => toggleCollapse(g.tagName)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className="inline-block w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: g.color }}
                    />
                    <h2 className="text-sm font-semibold truncate">
                      {g.label}
                    </h2>
                    <span className="text-xs text-ink-tertiary tabular-nums shrink-0">
                      {g.count} {g.count === 1 ? "Foto" : "Fotos"} ·
                      ⌀ {Math.round(g.avgConfidence * 100)}%
                    </span>
                    {g.hasMore && (
                      <span className="text-xs text-semantic-warning shrink-0">
                        (gekürzt)
                      </span>
                    )}
                  </div>
                  <span className="text-ink-tertiary text-lg select-none">
                    {isCollapsed ? "▸" : "▾"}
                  </span>
                </header>

                {!isCollapsed && (
                  <>
                    <div className="px-4 py-2 border-b border-line-subtle bg-surface-sunken flex items-center gap-3 text-xs flex-wrap">
                      <span className="text-ink-tertiary">
                        {sel.size} / {g.suggestions.length} ausgewählt
                      </span>
                      <button
                        type="button"
                        onClick={() => selectAll(g.tagName, g)}
                        className="text-ink-secondary hover:text-accent"
                      >
                        Alle
                      </button>
                      <button
                        type="button"
                        onClick={() => selectNone(g.tagName)}
                        className="text-ink-secondary hover:text-accent"
                      >
                        Keine
                      </button>
                      <div className="flex-1" />
                      <button
                        type="button"
                        onClick={() => void onAcceptGroup(g)}
                        disabled={!!busy || sel.size === 0}
                        className="px-3 py-1 text-xs rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-50"
                      >
                        {busy === `accept-${g.tagName}`
                          ? "…"
                          : `${sel.size} übernehmen`}
                      </button>
                      <button
                        type="button"
                        onClick={() => void onRejectGroup(g)}
                        disabled={!!busy || sel.size === 0}
                        className="px-3 py-1 text-xs rounded bg-surface-raised border border-line-subtle text-ink-secondary hover:bg-surface-sunken disabled:opacity-50"
                      >
                        {busy === `reject-${g.tagName}`
                          ? "…"
                          : `${sel.size} verwerfen`}
                      </button>
                    </div>

                    <div className="p-3 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                      {g.suggestions.map((s) => {
                        const isSelected = sel.has(s.autoTagId);
                        return (
                          <button
                            key={s.autoTagId}
                            type="button"
                            onClick={() => toggleFile(g.tagName, s.autoTagId)}
                            className={`relative aspect-square rounded overflow-hidden border-2 transition-colors ${
                              isSelected
                                ? "border-accent"
                                : "border-line-subtle hover:border-line-strong opacity-60"
                            }`}
                            title={s.filename}
                          >
                            {s.thumbUrl ? (
                              <img
                                src={s.thumbUrl}
                                alt={s.filename}
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <div className="w-full h-full bg-surface-sunken flex items-center justify-center text-xs text-ink-tertiary">
                                ?
                              </div>
                            )}
                            <span
                              className="absolute top-1 right-1 text-[10px] font-mono px-1 rounded tabular-nums"
                              style={{
                                backgroundColor: "rgba(0,0,0,0.6)",
                                color: "white",
                              }}
                            >
                              {Math.round(s.confidence * 100)}%
                            </span>
                            {isSelected && (
                              <span className="absolute top-1 left-1 w-4 h-4 rounded bg-accent text-white text-[10px] flex items-center justify-center">
                                ✓
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </section>
            );
          })}
      </div>
    </>
  );
}
