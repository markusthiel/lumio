"use client";

/**
 * SectionsEditor — Studio-Komponente für Kapitel-Verwaltung einer
 * Galerie.
 *
 * Sections sind optional: solange das Studio keine erstellt, läuft
 * die Customer-Galerie wie vorher (klassisches Hauptraster). Erstellt
 * das Studio mindestens eine Section, kann es Files dort zuordnen —
 * der Customer-View bekommt dann Sticky-Navi + Trennbänder zwischen
 * den Kapiteln.
 *
 * Drei Aktions-Ebenen:
 *
 * 1. Sections selbst: Add / Edit (Titel + Description + Cover) /
 *    Remove. Reihenfolge per Up/Down-Pfeile (keine Drag-and-Drop —
 *    Section-Listen sind kurz, Pfeil-Buttons sind robuster).
 *
 * 2. Per-File-Zuordnung: pro File eine Section-Dropdown direkt in
 *    der Section-Liste verfügbar. Die File-Liste selbst (Hauptraster
 *    im Studio) wird NICHT angerührt — wir hängen den File-Picker
 *    in einen Bulk-Modus pro Section ("Files diesem Kapitel
 *    zuweisen").
 *
 * 3. Bulk-Unassign: pro Section ein Button "Alle Files dieser Section
 *    zurück in Default", für schnelles Aufräumen.
 */

import { useEffect, useState } from "react";
import { api, type StudioSection } from "@/lib/api";
import { useT } from "@/lib/i18n";

interface Props {
  galleryId: string;
  /** Files der Galerie. Wird verwendet um die Bulk-Picker zu
   *  populieren UND die fileCount pro Section anzuzeigen. */
  files: Array<{
    id: string;
    filename: string;
    thumbUrl: string | null;
    sectionId: string | null;
  }>;
  /** Wird nach jeder mutierenden Aktion aufgerufen — der Caller
   *  reloaded daraufhin die Galerie (inkl. files mit aktuellen
   *  sectionIds). */
  onChanged: () => Promise<void> | void;
}

export function SectionsEditor({ galleryId, files, onChanged }: Props) {
  const t = useT();
  const [sections, setSections] = useState<StudioSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Initial-Load und Reload nach jeder Section-Mutation.
  async function reload() {
    setLoading(true);
    try {
      const res = await api.listSections(galleryId);
      setSections(res.sections);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
    // galleryId-only — wir reloaden Sections nur bei Galerie-Wechsel,
    // file-Updates kommen vom Parent via onChanged → reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryId]);

  async function handleCreate() {
    if (busy) return;
    setBusy(true);
    try {
      const title = window.prompt(t("studio.sectionNewPrompt"))?.trim();
      if (!title) return;
      await api.createSection(galleryId, { title });
      await reload();
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(s: StudioSection) {
    if (busy) return;
    const ok = window.confirm(
      t("studio.sectionDeleteConfirm", { title: s.title })
    );
    if (!ok) return;
    setBusy(true);
    try {
      await api.deleteSection(galleryId, s.id);
      await reload();
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleMove(s: StudioSection, dir: -1 | 1) {
    if (busy) return;
    // Index der Section finden, Tauschen, neue order schicken.
    const idx = sections.findIndex((x) => x.id === s.id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= sections.length) return;
    const newOrder = [...sections];
    const tmp = newOrder[idx];
    newOrder[idx] = newOrder[target];
    newOrder[target] = tmp;
    setBusy(true);
    try {
      await api.reorderSections(
        galleryId,
        newOrder.map((x) => x.id)
      );
      await reload();
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <section className="rounded-md border border-line-subtle bg-surface-raised p-5">
        <div className="text-ui-sm text-ink-tertiary">…</div>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-line-subtle bg-surface-raised p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-ui-md font-medium text-ink-primary">
            {t("studio.sectionsHeading")}
          </h2>
          <p className="text-ui-xs text-ink-tertiary mt-0.5">
            {t("studio.sectionsHint")}
          </p>
        </div>
        <button
          type="button"
          onClick={handleCreate}
          disabled={busy}
          className="text-ui-sm h-8 px-3 rounded border border-line-strong text-ink-secondary hover:text-ink-primary hover:bg-surface-overlay disabled:opacity-50 transition-colors duration-motion"
        >
          {t("studio.sectionAdd")}
        </button>
      </div>

      {sections.length === 0 ? (
        <div className="text-ui-sm text-ink-tertiary py-4 text-center">
          {t("studio.sectionsEmpty")}
        </div>
      ) : (
        <ul className="space-y-2">
          {sections.map((s, i) => (
            <SectionRow
              key={s.id}
              section={s}
              files={files}
              isFirst={i === 0}
              isLast={i === sections.length - 1}
              busy={busy}
              editing={editingId === s.id}
              onStartEdit={() => setEditingId(s.id)}
              onCancelEdit={() => setEditingId(null)}
              onUpdated={async () => {
                setEditingId(null);
                await reload();
                await onChanged();
              }}
              onDelete={() => handleDelete(s)}
              onMoveUp={() => handleMove(s, -1)}
              onMoveDown={() => handleMove(s, 1)}
              galleryId={galleryId}
              onChanged={onChanged}
              reloadSections={reload}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Einzelne Zeile pro Section. Default-View: zusammengeklappt mit
 *  Titel + fileCount + Aktion-Buttons. Bei Klick auf "Bearbeiten":
 *  inline-Editor für Titel + Description + Cover-Picker. */
function SectionRow({
  section,
  files,
  isFirst,
  isLast,
  busy,
  editing,
  onStartEdit,
  onCancelEdit,
  onUpdated,
  onDelete,
  onMoveUp,
  onMoveDown,
  galleryId,
  onChanged,
  reloadSections,
}: {
  section: StudioSection;
  files: Array<{ id: string; filename: string; thumbUrl: string | null; sectionId: string | null }>;
  isFirst: boolean;
  isLast: boolean;
  busy: boolean;
  editing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onUpdated: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  galleryId: string;
  onChanged: () => Promise<void> | void;
  reloadSections: () => Promise<void>;
}) {
  const t = useT();
  const [showAssign, setShowAssign] = useState(false);

  if (editing) {
    return (
      <li className="rounded border border-accent/40 bg-surface-sunken p-3">
        <SectionEditForm
          galleryId={galleryId}
          section={section}
          files={files}
          onCancel={onCancelEdit}
          onSaved={onUpdated}
        />
      </li>
    );
  }

  const sectionFiles = files.filter((f) => f.sectionId === section.id);

  return (
    <li className="rounded border border-line-subtle bg-surface-sunken px-3 py-2.5">
      <div className="flex items-center gap-2">
        {/* Reorder-Pfeile */}
        <div className="flex flex-col -gap-0.5">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isFirst || busy}
            className="text-ink-tertiary hover:text-ink-primary disabled:opacity-20 h-4 w-5 inline-flex items-center justify-center"
            aria-label={t("studio.sectionMoveUp")}
          >
            ▲
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast || busy}
            className="text-ink-tertiary hover:text-ink-primary disabled:opacity-20 h-4 w-5 inline-flex items-center justify-center"
            aria-label={t("studio.sectionMoveDown")}
          >
            ▼
          </button>
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-ui-sm font-medium text-ink-primary truncate">
            {section.title}
          </div>
          {section.description && (
            <div className="text-ui-xs text-ink-tertiary truncate">
              {section.description}
            </div>
          )}
          <div className="text-ui-xs text-ink-tertiary mt-0.5">
            {t("studio.sectionFileCount", { n: section.fileCount })}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowAssign((v) => !v)}
            disabled={busy}
            className="text-ui-xs h-7 px-2 rounded border border-line-strong text-ink-secondary hover:text-ink-primary hover:bg-surface-overlay disabled:opacity-50 transition-colors duration-motion"
          >
            {showAssign
              ? t("studio.sectionAssignClose")
              : t("studio.sectionAssign")}
          </button>
          <button
            type="button"
            onClick={onStartEdit}
            disabled={busy}
            className="text-ui-xs h-7 px-2 rounded border border-line-strong text-ink-secondary hover:text-ink-primary hover:bg-surface-overlay disabled:opacity-50 transition-colors duration-motion"
          >
            {t("studio.sectionEdit")}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="text-ui-xs h-7 px-2 rounded text-semantic-danger hover:bg-semantic-danger/10 disabled:opacity-50 transition-colors duration-motion"
          >
            {t("studio.sectionDelete")}
          </button>
        </div>
      </div>

      {showAssign && (
        <AssignFilesPanel
          galleryId={galleryId}
          sectionId={section.id}
          sectionFiles={sectionFiles}
          allFiles={files}
          onChanged={async () => {
            await reloadSections();
            await onChanged();
          }}
        />
      )}
    </li>
  );
}

/** Inline-Editor für Titel + Description + Cover-Bild. */
function SectionEditForm({
  galleryId,
  section,
  files,
  onCancel,
  onSaved,
}: {
  galleryId: string;
  section: StudioSection;
  files: Array<{ id: string; filename: string; thumbUrl: string | null }>;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [title, setTitle] = useState(section.title);
  const [description, setDescription] = useState(section.description ?? "");
  const [coverFileId, setCoverFileId] = useState<string | null>(
    section.coverFileId
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.updateSection(galleryId, section.id, {
        title: title.trim() || section.title,
        description: description.trim() || null,
        coverFileId,
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-ui-xs text-ink-tertiary mb-1">
          {t("studio.sectionTitle")}
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          className="w-full h-9 px-2.5 rounded bg-surface-overlay border border-line-subtle text-ui text-ink-primary focus:border-accent focus:outline-none"
        />
      </div>
      <div>
        <label className="block text-ui-xs text-ink-tertiary mb-1">
          {t("studio.sectionDescription")}
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={400}
          placeholder={t("studio.sectionDescriptionPlaceholder")}
          className="w-full h-9 px-2.5 rounded bg-surface-overlay border border-line-subtle text-ui text-ink-primary focus:border-accent focus:outline-none"
        />
      </div>
      <div>
        <label className="block text-ui-xs text-ink-tertiary mb-1">
          {t("studio.sectionCover")}
        </label>
        <div className="flex items-center gap-3">
          {coverFileId &&
            (() => {
              const f = files.find((x) => x.id === coverFileId);
              if (!f?.thumbUrl) return null;
              return (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={f.thumbUrl}
                  alt=""
                  className="w-12 h-12 object-cover rounded border border-line-subtle"
                />
              );
            })()}
          <select
            value={coverFileId ?? ""}
            onChange={(e) => setCoverFileId(e.target.value || null)}
            className="h-9 px-2.5 rounded bg-surface-overlay border border-line-subtle text-ui text-ink-primary focus:border-accent focus:outline-none flex-1"
          >
            <option value="">{t("studio.sectionCoverNone")}</option>
            {files.map((f) => (
              <option key={f.id} value={f.id}>
                {f.filename}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-2 justify-end pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="text-ui-sm h-8 px-3 rounded text-ink-secondary hover:text-ink-primary hover:bg-surface-overlay disabled:opacity-50 transition-colors duration-motion"
        >
          {t("studio.cancel")}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="text-ui-sm h-8 px-3 rounded bg-accent text-accent-contrast hover:bg-accent-hover disabled:opacity-50 transition-colors duration-motion"
        >
          {saving ? "…" : t("studio.save")}
        </button>
      </div>
    </div>
  );
}

/** Bulk-File-Picker pro Section. Zwei Spalten — links die Files
 *  die schon in der Section sind, rechts alle anderen. Klick im
 *  linken Bereich entfernt, Klick im rechten weist zu. */
function AssignFilesPanel({
  galleryId,
  sectionId,
  sectionFiles,
  allFiles,
  onChanged,
}: {
  galleryId: string;
  sectionId: string;
  sectionFiles: Array<{ id: string; filename: string; thumbUrl: string | null }>;
  allFiles: Array<{ id: string; filename: string; thumbUrl: string | null; sectionId: string | null }>;
  onChanged: () => Promise<void> | void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  // Files die NICHT in dieser Section sind. Inkludiert Default-Bucket
  // UND Files in anderen Sections — der Picker zeigt für andere
  // Sections kleine Labels, damit der Studio-User weiß was er
  // verschiebt.
  const candidates = allFiles.filter((f) => f.sectionId !== sectionId);

  async function assign(fileId: string) {
    if (busy) return;
    setBusy(true);
    try {
      await api.assignFilesToSection(galleryId, sectionId, [fileId]);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }
  async function unassign(fileId: string) {
    if (busy) return;
    setBusy(true);
    try {
      await api.unassignFilesFromSection(galleryId, [fileId]);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-line-subtle grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <div className="text-ui-xs text-ink-tertiary mb-1.5">
          {t("studio.sectionInChapter", { n: sectionFiles.length })}
        </div>
        <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto bg-surface-overlay rounded p-1.5">
          {sectionFiles.length === 0 ? (
            <div className="text-ui-xs text-ink-tertiary py-2 px-1">
              {t("studio.sectionInChapterEmpty")}
            </div>
          ) : (
            sectionFiles.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => unassign(f.id)}
                disabled={busy}
                title={t("studio.sectionRemoveFromChapter") + " — " + f.filename}
                className="relative w-12 h-12 rounded overflow-hidden border border-line-subtle hover:border-semantic-danger group disabled:opacity-50"
              >
                {f.thumbUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={f.thumbUrl}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-surface-sunken" />
                )}
                <div className="absolute inset-0 bg-semantic-danger/0 group-hover:bg-semantic-danger/40 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity duration-motion text-lg">
                  ✕
                </div>
              </button>
            ))
          )}
        </div>
      </div>
      <div>
        <div className="text-ui-xs text-ink-tertiary mb-1.5">
          {t("studio.sectionAvailableFiles", { n: candidates.length })}
        </div>
        <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto bg-surface-overlay rounded p-1.5">
          {candidates.length === 0 ? (
            <div className="text-ui-xs text-ink-tertiary py-2 px-1">
              {t("studio.sectionAvailableEmpty")}
            </div>
          ) : (
            candidates.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => assign(f.id)}
                disabled={busy}
                title={t("studio.sectionAddToChapter") + " — " + f.filename}
                className="relative w-12 h-12 rounded overflow-hidden border border-line-subtle hover:border-accent group disabled:opacity-50"
              >
                {f.thumbUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={f.thumbUrl}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-surface-sunken" />
                )}
                <div className="absolute inset-0 bg-accent/0 group-hover:bg-accent/40 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity duration-motion text-lg">
                  +
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
