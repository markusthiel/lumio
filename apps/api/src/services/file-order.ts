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
