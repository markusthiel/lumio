"use client";

/**
 * Ordnerbaum in der linken Studio-Navigation unter „Galerien" (#73).
 *
 * Erscheint erst, wenn das Studio mindestens einen Ordner hat — ohne Ordner
 * bleibt die Navigation wie bisher. Einträge: „Alle Galerien", „Ohne
 * Ordner", dann der Baum. Aufgeklappte Ordner merkt sich der Browser.
 * Galerien lassen sich aus der Liste auf einen Ordner ziehen.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { GalleryFolder } from "@/lib/api";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useNotify, usePrompt } from "@/components/ui/dialogs";
import { useErrorText } from "@/lib/error-i18n";
import {
  GALLERY_DRAG_TYPE,
  childrenOf,
  dropGalleries,
  notifyFoldersChanged,
  pathOf,
} from "@/lib/folders";

const OPEN_KEY = "lumio.folderTree.open";

export function FolderTree({
  folders,
  allCount,
  noFolderCount,
  onNavigate,
}: {
  folders: GalleryFolder[];
  allCount: number;
  noFolderCount: number;
  onNavigate: () => void;
}) {
  const t = useT();
  const ask = usePrompt();
  const notify = useNotify();
  const errText = useErrorText();
  const pathname = usePathname();
  const params = useSearchParams();
  const onList = pathname === "/studio";
  const current = onList ? params.get("folder") : null;

  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem(OPEN_KEY);
      if (raw) setOpen(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* Defaults */
    }
  }, []);
  // Den Pfad zum aktuellen Ordner immer aufklappen.
  useEffect(() => {
    if (!current || current === "none") return;
    const path = pathOf(folders, current);
    if (path.length < 2) return;
    setOpen((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const f of path.slice(0, -1)) {
        if (!next.has(f.id)) {
          next.add(f.id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [current, folders]);

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  }

  async function newFolder() {
    const name = await ask({
      title: t("folders.newTitle"),
      message: t("folders.newMessageRoot"),
      placeholder: t("folders.namePlaceholder"),
      confirmLabel: t("folders.create"),
    });
    if (!name?.trim()) return;
    try {
      await api.createFolder({ name: name.trim(), parentId: null });
      notifyFoldersChanged();
    } catch (err) {
      notify(errText(err, t("common.error")));
    }
  }

  const rowBase =
    "group flex items-center gap-1.5 h-7 min-w-0 rounded-md text-ui-sm transition-colors duration-motion";
  const active = "bg-accent/10 text-accent font-medium";
  const idle = "text-ink-secondary hover:text-ink-primary hover:bg-surface-raised";

  function renderLevel(parentId: string | null, depth: number): React.ReactNode {
    return childrenOf(folders, parentId).map((f) => {
      const kids = childrenOf(folders, f.id).length > 0;
      const isOpen = open.has(f.id);
      const isCurrent = current === f.id;
      return (
        <li key={f.id}>
          <Drop
            onError={(err) => notify(errText(err, t("common.error")))}
            folderId={f.id}
            className={`${rowBase} ${isCurrent ? active : idle}`}
          >
            <span style={{ width: depth * 12 }} className="flex-none" aria-hidden />
            {kids ? (
              <button
                type="button"
                onClick={() => toggle(f.id)}
                aria-label={
                  isOpen
                    ? t("folders.collapse", { name: f.name })
                    : t("folders.expand", { name: f.name })
                }
                aria-expanded={isOpen}
                className="flex-none h-7 w-5 flex items-center justify-center text-ink-tertiary hover:text-ink-primary"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  className={`transition-transform duration-motion ${isOpen ? "rotate-90" : ""}`}
                  aria-hidden
                >
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            ) : (
              <span className="flex-none w-5" aria-hidden />
            )}
            <Link
              href={`/studio?folder=${f.id}`}
              onClick={onNavigate}
              aria-current={isCurrent ? "page" : undefined}
              className="flex-1 min-w-0 flex items-center gap-1.5 h-7 pr-2"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="flex-none"
                aria-hidden
              >
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              </svg>
              <span className="flex-1 min-w-0 truncate">{f.name}</span>
              <span className="flex-none text-ui-xs text-ink-tertiary tabular-nums">
                {f.totalGalleryCount}
              </span>
            </Link>
          </Drop>
          {kids && isOpen && <ul>{renderLevel(f.id, depth + 1)}</ul>}
        </li>
      );
    });
  }

  return (
    <li>
      <ul
        className="ml-4 pl-2 mt-0.5 mb-1.5 border-l border-line-subtle space-y-px"
        aria-label={t("folders.treeLabel")}
      >
        <li>
          <Link
            href="/studio"
            onClick={onNavigate}
            className={`${rowBase} pl-2 pr-2 ${onList && !current ? active : idle}`}
          >
            <span className="flex-1 truncate">{t("folders.allGalleries")}</span>
            <span className="text-ui-xs text-ink-tertiary tabular-nums">{allCount}</span>
          </Link>
        </li>
        <li>
          <Drop onError={(err) => notify(errText(err, t("common.error")))} folderId={null} className={`${rowBase} ${current === "none" ? active : idle}`}>
            <Link
              href="/studio?folder=none"
              onClick={onNavigate}
              className="flex-1 min-w-0 flex items-center h-7 pl-2 pr-2"
            >
              <span className="flex-1 truncate">{t("folders.noFolder")}</span>
              <span className="text-ui-xs text-ink-tertiary tabular-nums">{noFolderCount}</span>
            </Link>
          </Drop>
        </li>
        {renderLevel(null, 0)}
        <li>
          <button
            type="button"
            onClick={() => void newFolder()}
            className="h-7 pl-2 pr-2 text-ui-xs text-ink-tertiary hover:text-ink-primary transition-colors duration-motion"
          >
            + {t("folders.newFolder")}
          </button>
        </li>
      </ul>
    </li>
  );
}

function Drop({
  folderId,
  children,
  className,
  onError,
}: {
  folderId: string | null;
  children: React.ReactNode;
  className: string;
  onError: (err: unknown) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`${className} ${over ? "ring-1 ring-accent bg-accent/10" : ""}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(GALLERY_DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={async (e) => {
        setOver(false);
        e.preventDefault();
        try {
          await dropGalleries(folderId, e);
        } catch (err) {
          onError(err);
        }
      }}
    >
      {children}
    </div>
  );
}
