/**
 * Ordnerbaum über den Galerien (#73) — reine Funktionen ohne DB-Zugriff,
 * damit Zyklen-, Tiefen- und Sichtbarkeitsregeln testbar bleiben.
 *
 * Die Routen laden einmal alle Ordner eines Studios (das sind Dutzende bis
 * wenige Tausend Zeilen) und rechnen hier im Speicher.
 */

export interface FolderNode {
  id: string;
  parentId: string | null;
  name: string;
}

/** Maximale Tiefe (Wurzelordner = 1). Großzügig, schützt nur vor Unfug. */
export const MAX_FOLDER_DEPTH = 20;
/** Obergrenze pro Studio. */
export const MAX_FOLDERS_PER_TENANT = 10_000;

export function childrenMap(
  folders: readonly FolderNode[]
): Map<string | null, FolderNode[]> {
  const m = new Map<string | null, FolderNode[]>();
  for (const f of folders) {
    const list = m.get(f.parentId) ?? [];
    list.push(f);
    m.set(f.parentId, list);
  }
  return m;
}

/** Alle Nachfahren von `id` (ohne `id` selbst). */
export function descendantIds(
  folders: readonly FolderNode[],
  id: string
): Set<string> {
  const kids = childrenMap(folders);
  const out = new Set<string>();
  const stack = [...(kids.get(id) ?? [])];
  while (stack.length) {
    const f = stack.pop()!;
    if (out.has(f.id)) continue; // Schutz gegen kaputte Daten
    out.add(f.id);
    stack.push(...(kids.get(f.id) ?? []));
  }
  return out;
}

/** Tiefe eines Ordners: Wurzelordner = 1, `null` (oberste Ebene) = 0. */
export function depthOf(
  folders: readonly FolderNode[],
  id: string | null
): number {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let depth = 0;
  let cur = id;
  const seen = new Set<string>();
  while (cur) {
    if (seen.has(cur)) break;
    seen.add(cur);
    depth++;
    cur = byId.get(cur)?.parentId ?? null;
  }
  return depth;
}

/** Höhe des Teilbaums unter `id`, inklusive `id` selbst (Blatt = 1). */
export function subtreeHeight(
  folders: readonly FolderNode[],
  id: string
): number {
  const kids = childrenMap(folders);
  const walk = (fid: string, seen: Set<string>): number => {
    if (seen.has(fid)) return 0;
    seen.add(fid);
    let max = 0;
    for (const c of kids.get(fid) ?? []) max = Math.max(max, walk(c.id, seen));
    return 1 + max;
  };
  return walk(id, new Set());
}

/** Würde `selfId` unter `newParentId` einen Zyklus erzeugen? */
export function wouldCreateCycle(
  folders: readonly FolderNode[],
  selfId: string,
  newParentId: string | null
): boolean {
  if (newParentId === null) return false;
  if (newParentId === selfId) return true;
  return descendantIds(folders, selfId).has(newParentId);
}

/** Passt `selfId` mit seinem Teilbaum unter `newParentId`? */
export function fitsDepth(
  folders: readonly FolderNode[],
  selfId: string | null,
  newParentId: string | null
): boolean {
  const height = selfId ? subtreeHeight(folders, selfId) : 1;
  return depthOf(folders, newParentId) + height <= MAX_FOLDER_DEPTH;
}

/** Gibt es unter `parentId` schon einen Ordner gleichen Namens? */
export function siblingWithName(
  folders: readonly FolderNode[],
  parentId: string | null,
  name: string,
  exceptId?: string
): FolderNode | undefined {
  const needle = name.trim().toLocaleLowerCase();
  return folders.find(
    (f) =>
      f.parentId === parentId &&
      f.id !== exceptId &&
      f.name.trim().toLocaleLowerCase() === needle
  );
}

export interface FolderCounts {
  /** Galerien direkt in diesem Ordner. */
  direct: number;
  /** Galerien in diesem Ordner und allen Unterordnern. */
  deep: number;
}

/**
 * Zählt Galerien pro Ordner (direkt und inklusive Unterordner).
 * `perFolder` = Anzahl Galerien mit genau diesem folderId.
 */
export function countGalleries(
  folders: readonly FolderNode[],
  perFolder: ReadonlyMap<string, number>
): Map<string, FolderCounts> {
  const kids = childrenMap(folders);
  const out = new Map<string, FolderCounts>();
  const walk = (id: string, seen: Set<string>): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    const direct = perFolder.get(id) ?? 0;
    let deep = direct;
    for (const c of kids.get(id) ?? []) deep += walk(c.id, seen);
    out.set(id, { direct, deep });
    return deep;
  };
  for (const root of kids.get(null) ?? []) walk(root.id, new Set());
  // Verwaiste Knoten (parentId zeigt ins Leere) trotzdem zählen.
  for (const f of folders) if (!out.has(f.id)) walk(f.id, new Set());
  return out;
}

/**
 * Welche Ordner sieht jemand mit eingeschränktem Galerie-Zugriff?
 *
 * Ein Ordner ist sichtbar, wenn sein Teilbaum mindestens eine Galerie
 * enthält, auf die der Nutzer Zugriff hat — oder wenn er gar keine
 * Galerien enthält (frisch angelegte, noch leere Struktur soll jeder
 * sehen und befüllen können). Ausgeblendet werden nur Ordner, deren
 * Galerien ausnahmslos anderen gehören.
 */
export function visibleFolderIds(
  folders: readonly FolderNode[],
  total: ReadonlyMap<string, FolderCounts>,
  accessible: ReadonlyMap<string, FolderCounts>
): Set<string> {
  const visible = new Set<string>();
  for (const f of folders) {
    const t = total.get(f.id)?.deep ?? 0;
    const a = accessible.get(f.id)?.deep ?? 0;
    if (t === 0 || a > 0) visible.add(f.id);
  }
  // Vorfahren sichtbarer Ordner müssen mit, sonst hängt der Ast in der Luft.
  const byId = new Map(folders.map((f) => [f.id, f]));
  for (const id of [...visible]) {
    let cur = byId.get(id)?.parentId ?? null;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      visible.add(cur);
      cur = byId.get(cur)?.parentId ?? null;
    }
  }
  return visible;
}
