"use client";

import { useCallback, useEffect, useState } from "react";
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
    if (!confirm("Diese Smart Collection löschen?")) return;
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
        title="Galerien"
        description={user.name ? `Angemeldet als ${user.name}` : user.email}
        actions={
          <Button variant="primary" size="md" onClick={() => setShowCreate(true)}>
            {t("studio.newGallery")}
          </Button>
        }
      />

      <div className="px-6 sm:px-8 py-6">
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
                  title="Bearbeiten"
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
            title="Neue Smart Collection erstellen"
          >
            <span className="text-base leading-none">+</span>
            <span>Neue Collection</span>
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
            <option value="">Alle Modi</option>
            <option value="collaboration">Auswahl/Proofing</option>
            <option value="presentation">Präsentation</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) =>
              changeStatus(e.target.value as typeof statusFilter)
            }
            className="h-7 px-2 rounded-xs text-ui-xs bg-surface-sunken border border-line-subtle"
          >
            <option value="">Alle Status</option>
            <option value="draft">Entwurf</option>
            <option value="live">Aktiv</option>
            <option value="archived">Archiviert</option>
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
        {galleries.length === 0 ? (
          <div className="rounded-md border border-dashed border-line-subtle bg-surface-sunken p-12 text-center">
            <p className="text-ink-tertiary text-ui">
              {tagFilter.size > 0
                ? t("studio.noGalleriesForFilter")
                : t("studio.noGalleries")}
            </p>
            {tagFilter.size === 0 && (
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
          <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {galleries.map((g, i) => (
              <li
                key={g.id}
                className="animate-reveal"
                style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
              >
                <Link
                  href={`/studio/${g.id}`}
                  className="block rounded-md border border-line-subtle bg-surface-raised hover:border-line-strong hover:bg-surface-overlay transition-all duration-motion ease-out p-4"
                >
                  <div className="flex items-center justify-between gap-2">
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
                  <div className="text-ui-xs text-ink-tertiary mt-4 flex items-center gap-2">
                    <span>{g.fileCount ?? 0} Files</span>
                    <span className="text-ink-tertiary/40">·</span>
                    <span className="capitalize">{g.mode}</span>
                  </div>
                </Link>
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
      setErr(e2 instanceof Error ? e2.message : "Fehler");
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
          <h2 className="text-lg font-medium">Neue Smart Collection</h2>
          <p className="text-ui-sm text-ink-tertiary mt-1">
            Speichere einen Filter unter einem Namen. Er erscheint dann
            oben in der Galerien-Liste als Schnellzugriff.
          </p>
        </div>

        <div>
          <label className="block text-ui-xs uppercase tracking-wide text-ink-tertiary mb-1">
            Name
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z.B. Hochzeiten 2025 mit offener Auswahl"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-ui-xs uppercase tracking-wide text-ink-tertiary mb-1">
            Icon (Emoji, optional)
          </label>
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
              <label className="block text-ui-xs text-ink-secondary mb-1">
                Modus
              </label>
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
                <option value="">Beliebig</option>
                <option value="collaboration">Auswahl/Proofing</option>
                <option value="presentation">Präsentation</option>
              </select>
            </div>

            <div>
              <label className="block text-ui-xs text-ink-secondary mb-1">
                Status
              </label>
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
                <option value="">Beliebig</option>
                <option value="draft">Entwurf</option>
                <option value="live">Aktiv</option>
                <option value="archived">Archiviert</option>
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
          <Button type="button" variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={saving || !name.trim()}
          >
            {saving ? "Speichert…" : "Speichern"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function StatusBadge({ status }: { status: Gallery["status"] }) {
  const styles: Record<Gallery["status"], string> = {
    draft: "bg-surface-sunken text-ink-tertiary border-line-subtle",
    live: "bg-semantic-success/12 text-semantic-success border-semantic-success/30",
    archived: "bg-semantic-warning/12 text-semantic-warning border-semantic-warning/30",
  };
  const labels: Record<Gallery["status"], string> = {
    draft: "Entwurf",
    live: "Live",
    archived: "Archiv",
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
        <h2 className="text-display-sm font-medium text-ink-primary">
          Neue Galerie
        </h2>

        {templates.length > 0 && (
          <Field
            label="Template"
            optionalLabel
            htmlFor="template"
            hint="Vorlage übernimmt Modus, Download-Setting und Beschreibung"
          >
            <Select
              id="template"
              value={templateId}
              onChange={(e) => applyTemplate(e.target.value)}
            >
              <option value="">— ohne Template —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Titel" htmlFor="title">
          <Input
            id="title"
            required
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="z.B. Hochzeit Müller-Schmidt 2026"
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

        <Field label="Modus" htmlFor="mode">
          <Select
            id="mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option value="collaboration">
              Collaboration (Auswahl, Kommentare)
            </option>
            <option value="presentation">Presentation (nur Anzeige)</option>
          </Select>
        </Field>

        <label className="flex items-center gap-2 text-ui text-ink-primary cursor-pointer">
          <input
            type="checkbox"
            checked={downloadEnabled}
            onChange={(e) => setDownloadEnabled(e.target.checked)}
            className="accent-accent"
          />
          Download für Kunden erlauben
        </label>

        {error && (
          <div className="text-ui-sm text-semantic-danger bg-semantic-danger/10 border border-semantic-danger/30 rounded-sm px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Wird erstellt…" : "Erstellen"}
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
