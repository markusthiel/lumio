"use client";

/**
 * „In Ordner verschieben …" (#73) — Ordnerauswahl mit Suche und der
 * Möglichkeit, direkt einen Unterordner anzulegen.
 *
 * Zwei Verwendungen:
 *   - Galerien verschieben (galleryIds gesetzt)
 *   - einen Ordner verschieben (movingFolderId gesetzt): der Ordner selbst
 *     und seine Unterordner sind dann nicht wählbar.
 */
import { useMemo, useState } from "react";
import { api, type GalleryFolder } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui";
import { DialogActions, Modal } from "@/components/ui/Modal";
import { useErrorText } from "@/lib/error-i18n";
import {
  childrenOf,
  notifyFoldersChanged,
  notifyGalleriesChanged,
  pathOf,
  subtreeIds,
} from "@/lib/folders";

export function MoveToFolderDialog({
  folders,
  title,
  description,
  currentFolderId,
  galleryIds,
  movingFolderId,
  onClose,
  onMoved,
}: {
  folders: GalleryFolder[];
  title: string;
  description?: string;
  /** Wo das Verschobene heute liegt (null = oberste Ebene). */
  currentFolderId: string | null;
  galleryIds?: string[];
  movingFolderId?: string;
  onClose: () => void;
  onMoved: () => void;
}) {
  const t = useT();
  const errText = useErrorText();
  const [list, setList] = useState(folders);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const blocked = useMemo(
    () => (movingFolderId ? subtreeIds(list, movingFolderId) : new Set<string>()),
    [list, movingFolderId]
  );

  // Flache Liste in Baumreihenfolge, mit Einrückung. Bei einer Suche
  // zeigen wir Treffer mit ihrem Pfad statt des Baums.
  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (q) {
      return list
        .filter((f) => f.name.toLocaleLowerCase().includes(q))
        .map((f) => ({
          folder: f,
          depth: 0,
          label: pathOf(list, f.id)
            .map((p) => p.name)
            .join(" › "),
        }));
    }
    const out: { folder: GalleryFolder; depth: number; label: string }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const f of childrenOf(list, parent)) {
        out.push({ folder: f, depth, label: f.name });
        walk(f.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [list, query]);

  const targetName =
    target === null
      ? t("folders.topLevel")
      : target
      ? list.find((f) => f.id === target)?.name ?? ""
      : "";

  async function createHere() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const parentId = target ?? null;
      const res = await api.createFolder({ name, parentId });
      setList((l) => [...l, res.folder]);
      setTarget(res.folder.id);
      setNewName("");
      notifyFoldersChanged();
    } catch (err) {
      setError(errText(err, t("common.error")));
    } finally {
      setCreating(false);
    }
  }

  async function submit() {
    if (target === undefined) return;
    setBusy(true);
    setError(null);
    try {
      if (movingFolderId) {
        await api.updateFolder(movingFolderId, { parentId: target });
        notifyFoldersChanged();
      } else if (galleryIds && galleryIds.length > 0) {
        await api.assignGalleriesToFolder(target, galleryIds);
        notifyGalleriesChanged();
      }
      onMoved();
    } catch (err) {
      setError(errText(err, t("common.error")));
      setBusy(false);
    }
  }

  const rowClass = (selected: boolean, disabled: boolean) =>
    `w-full flex items-center gap-2 h-8 pr-2.5 rounded-md text-ui-sm text-left transition-colors duration-motion ${
      disabled
        ? "text-ink-tertiary opacity-50 cursor-not-allowed"
        : selected
        ? "bg-accent/10 text-accent font-medium"
        : "text-ink-secondary hover:text-ink-primary hover:bg-surface-raised"
    }`;

  return (
    <Modal onClose={onClose} labelledBy="move-folder-title">
      <div className="space-y-4">
        <div>
          <h2 id="move-folder-title" className="text-lg font-semibold">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-ui-sm text-ink-secondary">{description}</p>
          )}
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("folders.searchPlaceholder")}
          aria-label={t("folders.searchPlaceholder")}
          className="w-full h-9 px-3 rounded-md text-ui-sm bg-surface-sunken border border-line-subtle focus:border-accent focus:outline-none"
        />
        <div
          role="listbox"
          aria-label={t("folders.treeLabel")}
          className="max-h-72 overflow-y-auto rounded-md border border-line-subtle bg-surface-sunken p-1 space-y-px"
        >
          <button
            type="button"
            role="option"
            aria-selected={target === null}
            disabled={currentFolderId === null && !movingFolderId}
            onClick={() => setTarget(null)}
            className={`${rowClass(target === null, currentFolderId === null && !movingFolderId)} pl-2.5`}
          >
            <span className="flex-1">{t("folders.topLevel")}</span>
            {currentFolderId === null && (
              <span className="text-ui-xs text-ink-tertiary">{t("folders.current")}</span>
            )}
          </button>
          {rows.map(({ folder: f, depth, label }) => {
            const isCurrent = f.id === currentFolderId;
            const disabled = blocked.has(f.id) || (isCurrent && !movingFolderId);
            return (
              <button
                key={f.id}
                type="button"
                role="option"
                aria-selected={target === f.id}
                disabled={disabled}
                onClick={() => setTarget(f.id)}
                style={{ paddingLeft: 10 + depth * 16 }}
                className={rowClass(target === f.id, disabled)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="flex-none" aria-hidden>
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                </svg>
                <span className="flex-1 min-w-0 truncate">{label}</span>
                {isCurrent && (
                  <span className="text-ui-xs text-ink-tertiary">{t("folders.current")}</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void createHere();
              }
            }}
            maxLength={120}
            placeholder={
              target
                ? t("folders.newSubfolderIn", { name: targetName })
                : t("folders.newFolderTop")
            }
            aria-label={t("folders.newFolder")}
            className="flex-1 h-9 px-3 rounded-md text-ui-sm bg-surface-sunken border border-line-subtle focus:border-accent focus:outline-none"
          />
          <Button onClick={() => void createHere()} disabled={creating || !newName.trim()}>
            {t("folders.create")}
          </Button>
        </div>
        {error && (
          <div className="text-sm text-semantic-danger bg-semantic-danger/10 border border-semantic-danger/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}
        <DialogActions>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            disabled={busy || target === undefined}
            onClick={() => void submit()}
          >
            {target === undefined
              ? t("folders.move")
              : t("folders.moveTo", { name: targetName })}
          </Button>
        </DialogActions>
      </div>
    </Modal>
  );
}
