/**
 * Lumio API — Smart-Collection-Filter
 *
 * Definiert das JSON-Schema der gespeicherten Filter und liefert eine
 * Funktion die das Filter-Objekt in eine Prisma-WHERE-Clause für die
 * Galerien-Liste übersetzt.
 *
 * MVP-Filter-Achsen (alle optional, AND-verknüpft):
 *   - mode:    "collaboration" | "presentation"
 *   - status:  "draft" | "live" | "archived"
 *   - tagIds:  string[]   — Galerien die ALLE genannten Tags tragen
 *   - since:   ISO-Datum   — updatedAt >= since
 *   - until:   ISO-Datum   — updatedAt <= until
 *
 * Spätere Erweiterungen (nicht im MVP):
 *   - fileKinds:   Array von File-Typen
 *   - hasLiked:    Boolean
 *   - viewsGt:     number
 *   - createdSince/Until (vs. updatedSince/Until)
 *
 * Das Schema wird per Zod validiert beim CREATE/UPDATE einer Collection,
 * damit wir nicht mit kaputten JSON-Daten in der DB enden. Beim READ
 * verlassen wir uns auf die DB-Zustand — falls jemand die DB direkt
 * editiert und Müll reinhaut, fällt buildWhereClause sauber zurück
 * auf "leerer Filter".
 */

import { z } from "zod";
import type { Prisma } from "@prisma/client";

export const smartCollectionFilterSchema = z
  .object({
    mode: z.enum(["collaboration", "presentation"]).optional(),
    status: z.enum(["draft", "live", "archived"]).optional(),
    tagIds: z.array(z.string().uuid()).max(20).optional(),
    since: z.string().datetime().optional(),
    until: z.string().datetime().optional(),
  })
  .strict();

export type SmartCollectionFilter = z.infer<typeof smartCollectionFilterSchema>;

/** Übersetzt einen Filter in eine Prisma-WHERE-Clause für gallery.findMany.
 *  Erwartet zusätzlich tenantId + ownerId von außen — die kommen NICHT
 *  aus dem Filter selbst (Cross-Tenant-Schutz). */
export function buildWhereClause(
  filter: unknown,
  ctx: { tenantId: string; ownerId: string }
): Prisma.GalleryWhereInput {
  // Defensiv parsen: kaputter JSON in der DB → wir behandeln das als
  // "leerer Filter" und zeigen alle Galerien des Owners. Falls jemand
  // wirklich Schaden anrichten wollte, ist der schlimmste Fall "User
  // sieht keine Galerien" — kein Cross-Tenant-Leak möglich, weil
  // tenantId/ownerId immer aus der Auth kommen.
  const parsed = smartCollectionFilterSchema.safeParse(filter);
  const f: SmartCollectionFilter = parsed.success ? parsed.data : {};

  const where: Prisma.GalleryWhereInput = {
    tenantId: ctx.tenantId,
    ownerId: ctx.ownerId,
  };

  if (f.mode) where.mode = f.mode;
  if (f.status) where.status = f.status;
  if (f.tagIds && f.tagIds.length > 0) {
    // AND-Semantik: alle Tags müssen vorhanden sein. Identisch zur
    // existierenden ?tag=...,...-Filter-Logik in routes/galleries.ts.
    where.AND = f.tagIds.map((tagId) => ({
      tags: { some: { tagId } },
    }));
  }
  if (f.since || f.until) {
    where.updatedAt = {};
    if (f.since) where.updatedAt.gte = new Date(f.since);
    if (f.until) where.updatedAt.lte = new Date(f.until);
  }

  return where;
}
