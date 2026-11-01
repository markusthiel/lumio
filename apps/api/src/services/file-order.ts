/**
 * Reihenfolge der Files innerhalb einer Galerie.
 *
 * Hintergrund (#71): Neue Uploads bekamen bisher alle sortIndex 0, und die
 * Abfragen sortierten NUR nach sortIndex. Bei lauter Gleichständen ist die
 * Reihenfolge in Postgres nicht definiert — nach einem Lightroom-Publish
 * (oder jedem Batch-Upload) konnte die Galerie also in beliebiger,
 * wechselnder Reihenfolge erscheinen.
 *
 * Zwei Bausteine:
 *  - FILE_ORDER_BY: stabile Sortierung mit Tiebreaker (Upload-Zeitpunkt,
 *    dann id). Damit sind auch Altbestände mit sortIndex 0 deterministisch,
 *    und zwar in Upload-Reihenfolge.
 *  - nextFileSortIndex(): neue Uploads werden hinten angehängt
 *    (max + 1), statt bei 0 zu landen.
 */
import type { Prisma, PrismaClient } from "@prisma/client";

export const FILE_ORDER_BY: Prisma.FileOrderByWithRelationInput[] = [
  { sortIndex: "asc" },
  { createdAt: "asc" },
  { id: "asc" },
];

type Db = Pick<PrismaClient, "file">;

/**
 * Erster freier sortIndex am Ende der Galerie. Bei mehreren Files in einem
 * Init-Call einmal abfragen und dann lokal hochzählen. Parallele Inits
 * können denselben Wert bekommen — unkritisch, der Tiebreaker in
 * FILE_ORDER_BY hält die Reihenfolge trotzdem stabil.
 */
export async function nextFileSortIndex(
  db: Db,
  galleryId: string
): Promise<number> {
  const agg = await db.file.aggregate({
    where: { galleryId },
    _max: { sortIndex: true },
  });
  const max = agg._max.sortIndex;
  return max === null || max === undefined ? 0 : max + 1;
}

// ---------------------------------------------------------------------------
// Einmalige Sortierung einer Galerie (Studio, Sortier-Modus)
// ---------------------------------------------------------------------------

export const FILE_SORT_KEYS = ["filename", "takenAt"] as const;
export type FileSortKey = (typeof FILE_SORT_KEYS)[number];

export interface SortableFile {
  id: string;
  originalFilename: string;
  takenAt: Date | null;
}

// Natürlich-numerisch ("IMG_2" vor "IMG_10"), Groß/Klein egal — dieselbe
// Logik wie die kundenseitige Ansichts-Sortierung in GalleryView.
const nameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/**
 * Liefert die neue Reihenfolge. `files` muss in der aktuellen
 * Galerie-Reihenfolge kommen (FILE_ORDER_BY): Array.prototype.sort ist
 * stabil, Gleichstände und Files ohne Aufnahmedatum behalten also ihre
 * bisherige relative Position. Files ohne Aufnahmedatum landen am Ende.
 */
export function sortFilesBy<T extends SortableFile>(
  files: readonly T[],
  by: FileSortKey
): T[] {
  const copy = [...files];
  if (by === "filename") {
    copy.sort((a, b) =>
      nameCollator.compare(a.originalFilename, b.originalFilename)
    );
    return copy;
  }
  copy.sort((a, b) => {
    const ta = a.takenAt ? a.takenAt.getTime() : NaN;
    const tb = b.takenAt ? b.takenAt.getTime() : NaN;
    const na = Number.isNaN(ta);
    const nb = Number.isNaN(tb);
    if (na && nb) return 0;
    if (na) return 1;
    if (nb) return -1;
    return ta - tb;
  });
  return copy;
}
