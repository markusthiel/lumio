"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  api,
  type ApiUser,
  type Gallery,
  type GalleryTemplate,
  type TagSummary,
  type SmartCollection,
  type GalleryFilter,
} from "@/lib/api";
import { useT } from "@/lib/i18n";
import { PageHeader } from "@/components/studio/PageHeader";
import { Button, Input, Textarea, Select } from "@/components/ui";
import { TagChip } from "@/components/studio/TagPicker";

export default function StudioPage() {
  const router = useRouter();
  const t = useT();
  const [user, setUser] = useState<ApiUser | null>(null);
  const [galleries, setGalleries] = useState<Gallery[]>([]);
  const [allTags, setAllTags] = useState<TagSummary[]>([]);
  const [tagFilter, setTagFilter] = useState<Set<string>>(new Set());
  // Erweiterte Filter (mode/status). Datums-Range kommt später, wenn
  // wir einen Datepicker integriert haben — der Backend-Endpoint
  // akzeptiert die seit/until-Params schon.
  const [modeFilter, setModeFilter] = useState<"" | "collaboration" | "presentation">("");
  const [statusFilter, setStatusFilter] = useState<"" | "draft" | "live" | "archived">("");
  // Smart Collections — gespeicherte Filter-Sets. activeCollection
  // referenziert die gerade aufgerufene Collection; setActiveCollection(null)
  // bedeutet "freier Filter aus den Bar-Controls".
  const [collections, setCollections] = useState<SmartCollection[]>([]);
  const [activeCollection, setActiveCollection] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Live-Suche (clientseitig, nach Galerie-Name) + Sortierung. Beides
  // wirkt auf die bereits geladene Liste, ohne Server-Roundtrip.
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<
    | "newest"
    | "oldest"
    | "name_asc"
    | "name_desc"
    | "activity"
    | "files"
    | "visits"
  >("newest");
  // Ansicht-Präferenzen — lokal pro Gerät persistiert (reine Anzeige).
  const [view, setView] = useState<"grid" | "list">("grid");
  const [showCover, setShowCover] = useState(true);
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const v = localStorage.getItem("lumio.galleries.view");
      if (v === "grid" || v === "list") setView(v);
      const c = localStorage.getItem("lumio.galleries.cover");
      if (c !== null) setShowCover(c === "1");
      const p = localStorage.getItem("lumio.galleries.pinned");
      if (p) setPinned(new Set(JSON.parse(p) as string[]));
    } catch {
      /* localStorage nicht verfügbar — Defaults greifen */
    }
  }, []);
  function persistView(v: "grid" | "list") {
    setView(v);
    try {
      localStorage.setItem("lumio.galleries.view", v);
    } catch {}
  }
  function persistCover(next: boolean) {
    setShowCover(next);
    try {
      localStorage.setItem("lumio.galleries.cover", next ? "1" : "0");
    } catch {}
  }
  function togglePin(id: string) {
    setPinned((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      try {
        localStorage.setItem("lumio.galleries.pinned", JSON.stringify([...n]));
      } catch {}
      return n;
    });
  }
  const [showCreate, setShowCreate] = useState(false);
  const [showSaveCollection, setShowSaveCollection] = useState(false);

  // Aktuelle Filter als GalleryFilter-Objekt zusammenbauen. Wird vom
  // refresh() und vom "Filter als Collection speichern"-Dialog
  // gleichermaßen genutzt.
  const currentFilter: GalleryFilter = {
    tagIds: tagFilter.size > 0 ? Array.from(tagFilter) : undefined,
    mode: modeFilter || undefined,
    status: statusFilter || undefined,
  };
  const hasActiveFilter =
    tagFilter.size > 0 || modeFilter !== "" || statusFilter !== "";

  // Live-Suche (nach Name) + Sortierung; angepinnte Galerien immer zuerst.
  const displayedGalleries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? galleries.filter((g) => (g.title ?? "").toLowerCase().includes(q))
      : galleries;
    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "name_asc":
          return (a.title ?? "").localeCompare(b.title ?? "", "de");
        case "name_desc":
          return (b.title ?? "").localeCompare(a.title ?? "", "de");
        case "oldest":
          return a.createdAt.localeCompare(b.createdAt);
        case "activity":
          return b.updatedAt.localeCompare(a.updatedAt);
        case "files":
          return (b.fileCount ?? 0) - (a.fileCount ?? 0);
        case "visits":
          return (b.stats?.visits ?? 0) - (a.stats?.visits ?? 0);
        case "newest":
        default:
          return b.createdAt.localeCompare(a.createdAt);
      }
    });
    // Stabiler Zweit-Sort: angepinnte nach oben (Array.sort ist stabil).
    return sorted.sort(
      (a, b) => (pinned.has(b.id) ? 1 : 0) - (pinned.has(a.id) ? 1 : 0)
    );
  }, [galleries, searchQuery, sortBy, pinned]);

  const refresh = useCallback(async () => {
    // Wenn eine Collection aktiv ist, laden wir über den Collection-
    // Endpoint (der die Filter aus der DB nimmt). Sonst über den
    // freien /galleries-Endpoint mit den UI-Filter-Controls.
    if (activeCollection) {
      const res = await api.runCollection(activeCollection);
      setGalleries(res.galleries);
    } else {
      const list = await api.listGalleries(currentFilter);
      setGalleries(list.galleries);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeCollection,
    tagFilter,
    modeFilter,
    statusFilter,
  ]);

  useEffect(() => {
    (async () => {
      try {
        const me = await api.me();
        setUser(me.user);
        const [list, tagsRes, colRes] = await Promise.all([
          api.listGalleries(),
          api.listTags(),
          api.listCollections(),
        ]);
        setGalleries(list.galleries);
        setAllTags(tagsRes.tags);
        setCollections(colRes.collections);
      } catch {
        router.replace("/login");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  // Bei jeder Filter-Änderung neu laden. activeCollection in der Dependency-
  // Liste damit das Wechseln zwischen Collection und freiem Filter
  // funktioniert.
  useEffect(() => {
    if (loading) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagFilter, modeFilter, statusFilter, activeCollection]);

  function toggleTag(id: string) {
    // Wenn der User in eine Collection-Ansicht hineinklickt und dann
    // einen Filter ändert, ist das nicht mehr "die Collection" sondern
    // ein freier Filter — auf null setzen damit die UI klar wird.
    setActiveCollection(null);
    setTagFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function changeMode(v: typeof modeFilter) {
    setActiveCollection(null);
    setModeFilter(v);
  }
  function changeStatus(v: typeof statusFilter) {
    setActiveCollection(null);
    setStatusFilter(v);
  }

  function clearFilters() {
    setActiveCollection(null);
    setTagFilter(new Set());
    setModeFilter("");
    setStatusFilter("");
  }

  // Klick auf eine Collection in der Sidebar: lädt sie. Die UI-Filter
  // werden NICHT mit den Collection-Werten gefüllt — die Collection
  // ist eine Black-Box vom UI-Standpunkt; was drin steckt sieht der
  // User in der Collection-Edit-Seite.
  function activateCollection(id: string) {
    setActiveCollection(id);
    setTagFilter(new Set());
    setModeFilter("");
    setStatusFilter("");
  }

  // Neue Collection speichern. Bekommt den vollständigen Filter vom
  // Dialog — der kann entweder den aktuellen UI-Filter sein oder
  // einer den der User direkt im Dialog gesetzt hat.
  async function saveAsCollection(
    name: string,
    icon: string | undefined,
    filterToSave: GalleryFilter
  ) {
    const c = await api.createCollection({
      name,
      icon,
      filter: filterToSave,
    });
    setCollections((cs) => [...cs, c.collection]);
    setShowSaveCollection(false);
  }

  // Aktive Collection löschen (nur möglich wenn eine aktiv ist).
  async function deleteActiveCollection() {
    if (!activeCollection) return;
    if (!confirm(t("studio.deleteCollectionConfirm"))) return;
    await api.deleteCollection(activeCollection);
    setCollections((cs) => cs.filter((c) => c.id !== activeCollection));
    setActiveCollection(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-ui text-ink-tertiary">
        Lädt…
      </div>
    );
  }
  if (!user) return null;

  return (
    <>
      <PageHeader
        title={t("studio.galleriesTitle")}
        description={user.name ? `Angemeldet als ${user.name}` : user.email}
        actions={
          <Button variant="primary" size="md" onClick={() => setShowCreate(true)}>
            {t("studio.newGallery")}
          </Button>
        }
      />

      <div className="px-6 sm:px-8 lg:px-12 py-6 max-w-5xl">
        {/* Suche (live, nach Name) + Sortierung */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-tertiary pointer-events-none">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </span>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("studio.galleriesSearchPlaceholder")}
              aria-label={t("studio.galleriesSearchAria")}
              className="w-full h-8 pl-8 pr-2.5 rounded-md text-ui-sm bg-surface-sunken border border-line-subtle focus:border-accent focus:outline-none transition-colors duration-motion"
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            {/* Vorschaubilder an/aus */}
            <button
              type="button"
              onClick={() => persistCover(!showCover)}
              aria-pressed={showCover}
              title={
                showCover
                  ? "Vorschaubilder ausblenden"
                  : "Vorschaubilder anzeigen"
              }
              className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-line-subtle bg-surface-sunken text-ink-secondary hover:text-ink-primary transition-colors duration-motion"
            >
              {showCover ? (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              ) : (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                  <path d="M10.73 5.08A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68" />
                  <path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.39-1.61" />
                  <line x1="2" y1="2" x2="22" y2="22" />
                </svg>
              )}
            </button>
            {/* Grid / Liste */}
            <div className="inline-flex rounded-md border border-line-subtle overflow-hidden">
              {(["grid", "list"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => persistView(v)}
                  aria-pressed={view === v}
                  title={v === "grid" ? "Kachel-Ansicht" : "Listen-Ansicht"}
                  className={`inline-flex items-center justify-center h-8 w-8 transition-colors duration-motion ${
                    view === v
                      ? "bg-accent/10 text-accent"
                      : "bg-surface-sunken text-ink-tertiary hover:text-ink-secondary"
                  }`}
                >
                  {v === "grid" ? (
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="3" width="7" height="7" />
                      <rect x="14" y="3" width="7" height="7" />
                      <rect x="14" y="14" width="7" height="7" />
                      <rect x="3" y="14" width="7" height="7" />
                    </svg>
                  ) : (
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="8" y1="6" x2="21" y2="6" />
                      <line x1="8" y1="12" x2="21" y2="12" />
                      <line x1="8" y1="18" x2="21" y2="18" />
                      <line x1="3" y1="6" x2="3.01" y2="6" />
                      <line x1="3" y1="12" x2="3.01" y2="12" />
                      <line x1="3" y1="18" x2="3.01" y2="18" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              aria-label={t("studio.sortAria")}
              className="h-8 px-2 rounded-md text-ui-xs bg-surface-sunken border border-line-subtle"
            >
              <option value="newest">{t("studio.sortNewest")}</option>
              <option value="oldest">{t("studio.sortOldest")}</option>
              <option value="activity">{t("studio.sortActivity")}</option>
              <option value="name_asc">{t("studio.sortNameAsc")}</option>
              <option value="name_desc">{t("studio.sortNameDesc")}</option>
              <option value="files">{t("studio.sortFiles")}</option>
              <option value="visits">{t("studio.sortVisits")}</option>
            </select>
          </div>
        </div>

        {/* Smart-Collections-Leiste — nur wenn welche existieren oder
            der User gerade eine aktive Collection nutzt. */}
        {/* Smart-Collections-Leiste — auch sichtbar wenn noch keine
            existiert, damit der Erstellen-Button immer da ist. */}
        <div className="mb-3 flex flex-wrap gap-1.5 items-center">
          <span className="text-ui-xs uppercase tracking-[0.12em] text-ink-tertiary mr-2">
            Smart Collections
          </span>
          {collections.map((c) => {
            const active = activeCollection === c.id;
            return (
              <div
                key={c.id}
                className={`group inline-flex items-stretch rounded-full overflow-hidden text-ui-xs transition-colors duration-motion ${
                  active
                    ? "bg-accent text-ink-on-accent"
                    : "bg-surface-sunken text-ink-secondary hover:bg-surface-overlay"
                }`}
              >
                <button
                  type="button"
                  onClick={() => activateCollection(c.id)}
                  className="inline-flex items-center gap-1 h-7 pl-2.5 pr-2"
                >
                  {c.icon && <span>{c.icon}</span>}
                  <span>{c.name}</span>
                </button>
                <Link
                  href={`/studio/collections/${c.id}`}
                  className={`inline-flex items-center justify-center h-7 w-7 border-l ${
                    active
                      ? "border-ink-on-accent/20 hover:bg-black/10"
                      : "border-line-subtle hover:bg-surface-base"
                  }`}
                  title={t("studio.edit")}
                  aria-label={`${c.name} bearbeiten`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M11.5 2 L14 4.5 L5 13.5 L1.5 14.5 L2.5 11 Z" />
                  </svg>
                </Link>
              </div>
            );
          })}
          {/* Plus-Button — immer da. Öffnet den Save-Dialog mit dem
              aktuellen Filter; wenn kein Filter aktiv ist, kann der
              User die Filter direkt im Dialog setzen. */}
          <button
            type="button"
            onClick={() => setShowSaveCollection(true)}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-ui-xs border border-dashed border-line-strong text-ink-tertiary hover:text-ink-primary hover:border-accent transition-colors duration-motion"
            title={t("studio.newCollectionTitle")}
          >
            <span className="text-base leading-none">+</span>
            <span>{t("studio.newCollection")}</span>
          </button>
          {activeCollection && (
            <button
              type="button"
              onClick={deleteActiveCollection}
              className="text-ui-xs text-semantic-danger/80 hover:text-semantic-danger ml-2"
            >
              Aktive löschen
            </button>
          )}
        </div>

        {/* Mode + Status Filter — kompakte Dropdown-Bar */}
        <div className="mb-4 flex flex-wrap gap-2 items-center">
          <select
            value={modeFilter}
            onChange={(e) => changeMode(e.target.value as typeof modeFilter)}
            className="h-7 px-2 rounded-xs text-ui-xs bg-surface-sunken border border-line-subtle"
          >
            <option value="">{t("studio.allModes")}</option>
            <option value="collaboration">{t("studio.modeSelection")}</option>
            <option value="presentation">{t("studio.modePresentation")}</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) =>
              changeStatus(e.target.value as typeof statusFilter)
            }
            className="h-7 px-2 rounded-xs text-ui-xs bg-surface-sunken border border-line-subtle"
          >
            <option value="">{t("studio.allStatuses")}</option>
            <option value="draft">{t("studio.statusDraft")}</option>
            <option value="live">{t("studio.statusLive")}</option>
            <option value="archived">{t("studio.statusArchived")}</option>
          </select>
          {hasActiveFilter && !activeCollection && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-ui-xs text-ink-tertiary hover:text-ink-secondary ml-1"
            >
              Filter zurücksetzen
            </button>
          )}
        </div>

        {allTags.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1.5 items-center">
            <span className="text-ui-xs uppercase tracking-[0.12em] text-ink-tertiary mr-2">
              {t("studio.tagsFilterBy")}
            </span>
            {allTags.map((tag) => {
              const active = tagFilter.has(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTag(tag.id)}
                  className="inline-flex items-center gap-1 h-6 px-2 rounded-xs text-ui-xs transition-all duration-motion"
                  style={{
                    backgroundColor: active
                      ? tag.color
                      : tag.color + "22",
                    color: active ? "#fff" : tag.color,
                    border: `1px solid ${tag.color}${active ? "" : "44"}`,
                  }}
                >
                  {tag.name}
                </button>
              );
            })}
            {tagFilter.size > 0 && (
              <button
                type="button"
                onClick={() => {
                  setActiveCollection(null);
                  setTagFilter(new Set());
                }}
                className="text-ui-xs text-ink-tertiary hover:text-ink-secondary ml-2"
              >
                {t("studio.tagsFilterClear")}
              </button>
            )}
          </div>
        )}
        {displayedGalleries.length === 0 ? (
          <div className="rounded-md border border-dashed border-line-subtle bg-surface-sunken p-12 text-center">
            <p className="text-ink-tertiary text-ui">
              {searchQuery.trim()
                ? t("studio.noGalleryFound", { query: searchQuery.trim() })
                : hasActiveFilter
                  ? t("studio.noGalleriesForFilter")
                  : t("studio.noGalleries")}
            </p>
            {!searchQuery.trim() && !hasActiveFilter && (
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="mt-3 text-ui-sm font-medium text-accent hover:text-accent-hover transition-colors duration-motion"
              >
                {t("studio.firstGallery")}
              </button>
            )}
          </div>
        ) : (
          <ul
            className={
              view === "grid"
                ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3"
                : "flex flex-col gap-2"
            }
          >
            {displayedGalleries.map((g, i) => (
              <li
                key={g.id}
                className="animate-reveal"
                style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
              >
                <GalleryCard
                  gallery={g}
                  view={view}
                  showCover={showCover}
                  pinned={pinned.has(g.id)}
                  onTogglePin={() => togglePin(g.id)}
                  onChanged={() => void refresh()}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {showCreate && (
        <CreateGalleryDialog
          onClose={() => setShowCreate(false)}
          onCreated={(g) => {
            setShowCreate(false);
            router.push(`/studio/${g.id}`);
            void refresh();
          }}
        />
      )}

      {showSaveCollection && (
        <SaveCollectionDialog
          initialFilter={currentFilter}
          allTags={allTags}
          onClose={() => setShowSaveCollection(false)}
          onSave={saveAsCollection}
        />
      )}
    </>
  );
}

/** Dialog zum Erstellen einer neuen Smart Collection. Lässt den User
 *  Name, Icon und Filter (Modus/Status/Tags) in einem Schritt setzen.
 *  Wenn der User vor dem Öffnen schon Filter in der UI gesetzt hatte,
 *  übernehmen wir sie als Vorbelegung — er kann sie hier noch ändern. */
function SaveCollectionDialog({
  initialFilter,
  allTags,
  onClose,
  onSave,
}: {
  initialFilter: GalleryFilter;
  allTags: TagSummary[];
  onClose: () => void;
  onSave: (
    name: string,
    icon: string | undefined,
    filter: GalleryFilter
  ) => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [filter, setFilter] = useState<GalleryFilter>(initialFilter);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggleTag(tagId: string) {
    setFilter((f) => {
      const cur = new Set(f.tagIds ?? []);
      if (cur.has(tagId)) cur.delete(tagId);
      else cur.add(tagId);
      return { ...f, tagIds: cur.size > 0 ? Array.from(cur) : undefined };
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      await onSave(name.trim(), icon.trim() || undefined, filter);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : t("common.error"));
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-lg bg-surface-overlay border border-line-subtle rounded-md p-6 space-y-4 shadow-elev-3 max-h-[90vh] overflow-y-auto"
      >
        <div>
          <h2 className="text-lg font-medium">{t("studio.newCollectionHeading")}</h2>
          <p className="text-ui-sm text-ink-tertiary mt-1">
            Speichere einen Filter unter einem Namen. Er erscheint dann
            oben in der Galerien-Liste als Schnellzugriff.
          </p>
        </div>

        <div>
          <label className="block text-ui-xs uppercase tracking-wide text-ink-tertiary mb-1">{t("studio.nameLabel")}</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("studio.collectionNamePlaceholder")}
            autoFocus
          />
        </div>

        <div>
          <label className="block text-ui-xs uppercase tracking-wide text-ink-tertiary mb-1">{t("studio.iconEmoji")}</label>
          <Input
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder="💍"
            maxLength={4}
          />
        </div>

        <div className="border-t border-line-subtle pt-4">
          <div className="text-ui-xs uppercase tracking-wide text-ink-tertiary mb-2">
            Filter
          </div>
          <p className="text-ui-xs text-ink-tertiary mb-3">
            Galerien müssen alle gesetzten Bedingungen erfüllen.
          </p>

          <div className="space-y-3">
            <div>
              <label className="block text-ui-xs text-ink-secondary mb-1">{t("studio.modeLabel")}</label>
              <select
                value={filter.mode ?? ""}
                onChange={(e) =>
                  setFilter((f) => ({
                    ...f,
                    mode:
                      (e.target.value as GalleryFilter["mode"]) || undefined,
                  }))
                }
                className="h-9 px-2 rounded-xs text-ui-sm bg-surface-sunken border border-line-subtle w-full"
              >
                <option value="">{t("studio.any")}</option>
                <option value="collaboration">{t("studio.modeSelection")}</option>
                <option value="presentation">{t("studio.modePresentation")}</option>
              </select>
            </div>

            <div>
              <label className="block text-ui-xs text-ink-secondary mb-1">{t("studio.statusLabel")}</label>
              <select
                value={filter.status ?? ""}
                onChange={(e) =>
                  setFilter((f) => ({
                    ...f,
                    status:
                      (e.target.value as GalleryFilter["status"]) || undefined,
                  }))
                }
                className="h-9 px-2 rounded-xs text-ui-sm bg-surface-sunken border border-line-subtle w-full"
              >
                <option value="">{t("studio.any")}</option>
                <option value="draft">{t("studio.statusDraft")}</option>
                <option value="live">{t("studio.statusLive")}</option>
                <option value="archived">{t("studio.statusArchived")}</option>
              </select>
            </div>

            {allTags.length > 0 && (
              <div>
                <label className="block text-ui-xs text-ink-secondary mb-1">
                  Tags
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {allTags.map((tag) => {
                    const active = (filter.tagIds ?? []).includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTag(tag.id)}
                        className="inline-flex items-center h-6 px-2 rounded-xs text-ui-xs transition-all duration-motion"
                        style={{
                          backgroundColor: active
                            ? tag.color
                            : tag.color + "22",
                          color: active ? "#fff" : tag.color,
                          border: `1px solid ${tag.color}${
                            active ? "" : "44"
                          }`,
                        }}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {err && <div className="text-semantic-danger text-ui-sm">{err}</div>}
        <div className="flex justify-end gap-2 border-t border-line-subtle pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            type="submit"
            variant="primary"
            disabled={saving || !name.trim()}
          >
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </form>
    </div>
  );
}

function CoverPlaceholder() {
  return (
    <div className="w-full h-full flex items-center justify-center text-ink-tertiary/40">
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="m21 15-4.5-4.5L6 21" />
      </svg>
    </div>
  );
}

function GalleryCard({
  gallery: g,
  view,
  showCover,
  pinned,
  onTogglePin,
  onChanged,
}: {
  gallery: Gallery;
  view: "grid" | "list";
  showCover: boolean;
  pinned: boolean;
  onTogglePin: () => void;
  onChanged: () => void;
}) {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const galleryUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/g/${g.slug}`
      : `/g/${g.slug}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(galleryUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard kann blockiert sein */
    }
    setMenuOpen(false);
  }
  async function share() {
    setMenuOpen(false);
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: g.title, url: galleryUrl });
      } catch {
        /* abgebrochen */
      }
    } else {
      void copyLink();
    }
  }
  async function setStatus(status: "live" | "archived") {
    setBusy(true);
    setMenuOpen(false);
    try {
      await api.updateGallery(g.id, { status });
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  const stats = g.stats;
  const isCollab = g.mode === "collaboration";

  const statsRow = (
    <div className="flex items-center gap-2.5 text-ui-xs text-ink-tertiary">
      <span>{t("studio.nFiles", { n: g.fileCount ?? 0 })}</span>
      {stats && stats.visits > 0 && (
        <span className="inline-flex items-center gap-1" title="Besuche">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          {stats.visits}
        </span>
      )}
      {stats && stats.likes > 0 && (
        <span className="inline-flex items-center gap-1" title="Favoriten">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 21s-7-4.6-9.5-8.3C.9 10.2 1.5 7 4.3 6c1.9-.7 3.7.2 4.7 1.6C10 6.2 11.8 5.3 13.7 6c2.8 1 3.4 4.2 1.8 6.7C19 16.4 12 21 12 21z" />
          </svg>
          {stats.likes}
        </span>
      )}
      {isCollab && stats && stats.selected > 0 && (
        <span className="inline-flex items-center gap-1" title={t("studio.selected")}>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {stats.selected}
        </span>
      )}
    </div>
  );

  const actions = (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          onTogglePin();
        }}
        title={pinned ? t("studio.unpin") : t("studio.pin")}
        aria-label={pinned ? t("studio.unpin") : t("studio.pin")}
        className={`inline-flex items-center justify-center h-7 w-7 rounded-md transition-all duration-motion ${
          pinned
            ? "text-accent opacity-100"
            : "text-ink-tertiary opacity-0 group-hover:opacity-100 hover:text-ink-primary focus:opacity-100"
        }`}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill={pinned ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 17v5" />
          <path d="M9 10.76V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v5.76a2 2 0 0 0 .59 1.42l1.12 1.12A1 1 0 0 1 18 15H6a1 1 0 0 1-.71-1.7l1.12-1.12A2 2 0 0 0 7 10.76z" />
        </svg>
      </button>
      <div className="relative">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            setMenuOpen((o) => !o);
          }}
          disabled={busy}
          title={t("studio.actions")}
          aria-label={t("studio.actions")}
          className={`inline-flex items-center justify-center h-7 w-7 rounded-md text-ink-tertiary hover:text-ink-primary hover:bg-surface-sunken transition-all duration-motion ${
            menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100"
          }`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="12" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="19" cy="12" r="1.6" />
          </svg>
        </button>
        {menuOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={(e) => {
                e.preventDefault();
                setMenuOpen(false);
              }}
            />
            <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-md border border-line-subtle bg-surface-overlay shadow-lg py-1 text-ui-sm">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  void copyLink();
                }}
                className="w-full text-left px-3 py-1.5 text-ink-secondary hover:text-ink-primary hover:bg-surface-sunken"
              >
                {copied ? t("studio.copied") : t("studio.copyLink")}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  void share();
                }}
                className="w-full text-left px-3 py-1.5 text-ink-secondary hover:text-ink-primary hover:bg-surface-sunken"
              >
                Teilen
              </button>
              {g.status === "archived" ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    void setStatus("live");
                  }}
                  className="w-full text-left px-3 py-1.5 text-ink-secondary hover:text-ink-primary hover:bg-surface-sunken"
                >
                  Reaktivieren
                </button>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    void setStatus("archived");
                  }}
                  className="w-full text-left px-3 py-1.5 text-semantic-danger/90 hover:text-semantic-danger hover:bg-surface-sunken"
                >
                  Archivieren
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );

  if (view === "list") {
    return (
      <div className="group relative flex items-center gap-3 rounded-md border border-line-subtle bg-surface-raised hover:border-line-strong hover:bg-surface-overlay transition-all duration-motion ease-out p-2.5">
        <Link
          href={`/studio/${g.id}`}
          className="flex items-center gap-3 min-w-0 flex-1"
        >
          {showCover && (
            <div className="w-12 h-12 rounded bg-surface-sunken shrink-0 overflow-hidden">
              {g.coverThumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={g.coverThumbUrl}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <CoverPlaceholder />
              )}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-ui-sm font-medium text-ink-primary truncate">
                {g.title}
              </h2>
              <StatusBadge status={g.status} />
            </div>
            <div className="mt-0.5">{statsRow}</div>
          </div>
        </Link>
        <div className="shrink-0">{actions}</div>
      </div>
    );
  }

  return (
    <div className="group relative rounded-md border border-line-subtle bg-surface-raised hover:border-line-strong hover:bg-surface-overlay transition-all duration-motion ease-out overflow-hidden">
      <Link href={`/studio/${g.id}`} className="block">
        {showCover && (
          <div className="aspect-[16/10] bg-surface-sunken overflow-hidden">
            {g.coverThumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={g.coverThumbUrl}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              <CoverPlaceholder />
            )}
          </div>
        )}
        <div className="p-4">
          <div className="flex items-center justify-between gap-2 pr-6">
            <h2 className="text-ui-md font-medium text-ink-primary truncate">
              {g.title}
            </h2>
            <StatusBadge status={g.status} />
          </div>
          {g.description && (
            <p className="text-ui-sm text-ink-tertiary mt-1.5 line-clamp-2">
              {g.description}
            </p>
          )}
          {g.tags && g.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {g.tags.map((tag) => (
                <TagChip key={tag.id} tag={tag} />
              ))}
            </div>
          )}
          <div className="mt-4">{statsRow}</div>
        </div>
      </Link>
      <div className="absolute top-2 right-2">{actions}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: Gallery["status"] }) {
  const t = useT();
  const styles: Record<Gallery["status"], string> = {
    draft: "bg-surface-sunken text-ink-tertiary border-line-subtle",
    live: "bg-semantic-success/12 text-semantic-success border-semantic-success/30",
    archived: "bg-semantic-warning/12 text-semantic-warning border-semantic-warning/30",
  };
  const labels: Record<Gallery["status"], string> = {
    draft: t("studio.statusDraft"),
    live: t("studio.badgeLive"),
    archived: t("studio.badgeArchived"),
  };
  return (
    <span
      className={`text-ui-xs font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-xs border ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}

function CreateGalleryDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (g: Gallery) => void;
}) {
  const t = useT();
  const [templates, setTemplates] = useState<GalleryTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<"collaboration" | "presentation">(
    "collaboration"
  );
  const [downloadEnabled, setDownloadEnabled] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [descriptionDirty, setDescriptionDirty] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.listTemplates();
        setTemplates(res.templates);
      } catch {
        /* Templates sind optional */
      }
    })();
  }, []);

  function applyTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setMode(t.mode as typeof mode);
    setDownloadEnabled(t.downloadEnabled);
    if (!descriptionDirty && t.defaultDescription) {
      setDescription(t.defaultDescription);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const { gallery } = await api.createGallery({
        title,
        description: description || undefined,
        mode,
        downloadEnabled,
        templateId: templateId || undefined,
      });
      onCreated(gallery);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
        className="w-full max-w-md bg-surface-overlay border border-line-subtle rounded-md p-6 space-y-4 shadow-elev-3"
      >
        <h2 className="text-display-sm font-medium text-ink-primary">{t("studio.newGallery")}</h2>

        {templates.length > 0 && (
          <Field
            label={t("studio.template")}
            optionalLabel
            htmlFor="template"
            hint={t("studio.templateHint")}
          >
            <Select
              id="template"
              value={templateId}
              onChange={(e) => applyTemplate(e.target.value)}
            >
              <option value="">{t("studio.noTemplate")}</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label={t("studio.titleLabel")} htmlFor="title">
          <Input
            id="title"
            required
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("studio.titlePlaceholder")}
          />
        </Field>

        <Field label="Beschreibung" htmlFor="desc" optionalLabel>
          <Textarea
            id="desc"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setDescriptionDirty(true);
            }}
            rows={2}
          />
        </Field>

        <Field label={t("studio.modeLabel")} htmlFor="mode">
          <Select
            id="mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option value="collaboration">{t("studio.modeCollabFull")}</option>
            <option value="presentation">{t("studio.modePresentationFull")}</option>
          </Select>
        </Field>

        <label className="flex items-center gap-2 text-ui text-ink-primary cursor-pointer">
          <input
            type="checkbox"
            checked={downloadEnabled}
            onChange={(e) => setDownloadEnabled(e.target.checked)}
            className="accent-accent"
          />{t("studio.allowDownload")}</label>

        {error && (
          <div className="text-ui-sm text-semantic-danger bg-semantic-danger/10 border border-semantic-danger/30 rounded-sm px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? t("studio.creating") : t("common.create")}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  optionalLabel,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  optionalLabel?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-ui-sm font-medium text-ink-primary block">
        {label}
        {optionalLabel && (
          <span className="text-ink-tertiary font-normal ml-1">(optional)</span>
        )}
      </label>
      {children}
      {hint && <p className="text-ui-xs text-ink-tertiary">{hint}</p>}
    </div>
  );
}
