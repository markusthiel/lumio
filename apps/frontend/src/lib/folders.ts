"use client";

/**
 * Ordner über den Galerien (#73) — gemeinsamer Zustand für den Baum in der
 * Navigation, die Galerieliste und den Verschieben-Dialog.
 *
 * Alle drei laden die Ordner selbst; nach jeder Änderung wird ein
 * Window-Event gefeuert, damit die anderen nachladen, ohne dass es einen
 * globalen Store braucht.
 */
import { useCallback, useEffect, useState } from "react";
import { api, type GalleryFolder, type GalleryFolderList } from "@/lib/api";

export const FOLDERS_CHANGED = "lumio:folders-changed";
export const GALLERIES_CHANGED = "lumio:galleries-changed";
/** dataTransfer-Typ für Galerien, die auf einen Ordner gezogen werden. */
export const GALLERY_DRAG_TYPE = "application/x-lumio-gallery";

export function notifyFoldersChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(FOLDERS_CHANGED));
}
export function notifyGalleriesChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(GALLERIES_CHANGED));
}

const EMPTY: GalleryFolderList = {
  folders: [],
  allGalleryCount: 0,
  noFolderGalleryCount: 0,
};

export function useFolders(): GalleryFolderList & {
  loaded: boolean;
  reload: () => Promise<void>;
} {
  const [data, setData] = useState<GalleryFolderList>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    try {
      setData(await api.listFolders());
    } catch {
      /* nicht eingeloggt oder API älter — Baum bleibt leer */
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    void reload();
    const on = () => void reload();
    window.addEventListener(FOLDERS_CHANGED, on);
    window.addEventListener(GALLERIES_CHANGED, on);
    return () => {
      window.removeEventListener(FOLDERS_CHANGED, on);
      window.removeEventListener(GALLERIES_CHANGED, on);
    };
  }, [reload]);
  return { ...data, loaded, reload };
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function childrenOf(
  folders: readonly GalleryFolder[],
  parentId: string | null
): GalleryFolder[] {
  return folders
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => collator.compare(a.name, b.name));
}

/** Pfad von der Wurzel bis einschließlich `id`. */
export function pathOf(
  folders: readonly GalleryFolder[],
  id: string | null | undefined
): GalleryFolder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out: GalleryFolder[] = [];
  const seen = new Set<string>();
  let cur = id ? byId.get(id) : undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out;
}

/** Ordner-ID samt aller Nachfahren — zum Ausschließen beim Verschieben. */
export function subtreeIds(
  folders: readonly GalleryFolder[],
  id: string
): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Galerien per Drag & Drop in einen Ordner legen (null = ohne Ordner). */
export async function dropGalleries(
  folderId: string | null,
  e: React.DragEvent
): Promise<number> {
  const raw = e.dataTransfer.getData(GALLERY_DRAG_TYPE);
  if (!raw) return 0;
  let ids: string[] = [];
  try {
    ids = JSON.parse(raw) as string[];
  } catch {
    return 0;
  }
  if (ids.length === 0) return 0;
  const res = await api.assignGalleriesToFolder(folderId, ids);
  notifyGalleriesChanged();
  return res.affected;
}
