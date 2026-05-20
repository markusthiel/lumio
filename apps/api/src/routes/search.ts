/**
 * Lumio API — Globale Suche
 *
 *   GET /search?q=<query>[&limit=5]
 *
 * Sucht tenant-weit nach Galerien (Titel/Beschreibung/Slug), Files
 * (Original-Filename), Brandings (Name) und Templates (Name). Per
 * Kategorie max `limit` (Default 5) Treffer.
 *
 * Design-Entscheidungen:
 *
 * 1) Wir nutzen ILIKE statt full-text-search-tsvector. Begründung:
 *    - Tenant-Daten sind übersichtlich (ein einzelner Photograph hat
 *      vielleicht 200 Galerien, ein paar 10k Files).
 *    - ILIKE %term% läuft auf indizierten Tabellen problemlos in
 *      einigen ms, solange wir auf tenantId vor-filtern.
 *    - Tsvector + GIN-Index wäre der nächste Schritt, wenn ein Tenant
 *      ein Mehrfaches dieser Größenordnung erreicht — Trigger fürs
 *      Index-Maintenance schreibt sich ein eigener Sprint.
 *
 * 2) Eine einzige Request beantwortet alle vier Kategorien. Vier
 *    parallele Queries kosten ~3 ms Latenz vs. 4 Roundtrips client-
 *    seitig; das ist es wert.
 *
 * 3) Min-Länge 2 — Single-Letter-Suchen würden bei ILIKE %a% den
 *    halben Tenant zurückliefern, und der User meint das selten
 *    ernst. Frontend debounced sowieso.
 *
 * 4) Owner-Scope: nur Galerien, die dem aktuellen User gehören. Files
 *    werden über die Galerie gefiltert. Brandings + Templates sind
 *    tenant-weit (nicht owner-spezifisch).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";

const querySchema = z.object({
  q: z.string().min(2).max(120),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

export async function registerSearchRoutes(app: FastifyInstance) {
  app.get("/search", async (req, reply) => {
    const s = req.requireAuth();
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      // 200 mit leerer Antwort ist freundlicher fürs Frontend als 400 —
      // beim Tippen erste Buchstaben wäre 400 ein noise-Generator
      return {
        galleries: [],
        files: [],
        brandings: [],
        templates: [],
        truncated: false,
      };
    }
    const { q, limit = 5 } = parsed.data;

    // ILIKE-Pattern. Wir escapen NICHT — der Wert geht durch Prisma's
    // Parameter-Binding und %/_ darin sind echte Sucheingaben (selten,
    // aber okay). Wer "100%" sucht, kriegt eben Felder mit "100" wieder.
    const term = `%${q}%`;

    const [galleries, files, brandings, templates] = await Promise.all([
      // Galerien: title | description | slug
      prisma.gallery.findMany({
        where: {
          tenantId: req.tenantId,
          ownerId: s.user.id,
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
            { slug: { contains: q, mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          slug: true,
          title: true,
          status: true,
        },
        // Live-Galerien zuerst — ein aktiver Job ist relevanter als ein
        // archivierter mit ähnlichem Titel.
        orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
        take: limit,
      }),

      // Files: originalFilename match. Filterung auf Files in Galerien
      // dieses Owners. Wir bringen die galerieslug gleich mit, damit
      // das Frontend direkt verlinken kann.
      prisma.file.findMany({
        where: {
          originalFilename: { contains: q, mode: "insensitive" },
          gallery: {
            tenantId: req.tenantId,
            ownerId: s.user.id,
          },
        },
        include: {
          gallery: { select: { slug: true, title: true } },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      }),

      // Brandings: tenant-weit
      prisma.branding.findMany({
        where: {
          tenantId: req.tenantId,
          name: { contains: q, mode: "insensitive" },
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take: limit,
      }),

      // Templates: tenant-weit
      prisma.galleryTemplate.findMany({
        where: {
          tenantId: req.tenantId,
          name: { contains: q, mode: "insensitive" },
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take: limit,
      }),
    ]);

    void term; // (currently unused; reserved für future LIKE-Raw-Fallback)

    return {
      galleries: galleries.map((g) => ({
        id: g.id,
        slug: g.slug,
        title: g.title,
        status: g.status,
      })),
      files: files.map((f) => ({
        id: f.id,
        galleryId: f.galleryId,
        gallerySlug: f.gallery.slug,
        galleryTitle: f.gallery.title,
        filename: f.originalFilename,
        kind: f.kind,
        status: f.status,
      })),
      brandings: brandings.map((b) => ({ id: b.id, name: b.name })),
      templates: templates.map((tpl) => ({ id: tpl.id, name: tpl.name })),
      // truncated=true sagt dem Frontend: "es gab mindestens so viele
      // Treffer wie limit" — hilft beim Anzeigen eines "mehr ..."-Hinweises.
      // Wir prüfen das per length === limit; das stimmt nur als Approximation
      // (genau-am-Limit zählt fälschlich als truncated), reicht aber für
      // den Hint.
      truncated:
        galleries.length === limit ||
        files.length === limit ||
        brandings.length === limit ||
        templates.length === limit,
    };
  });
}
