/**
 * Lumio API — Smart Collections
 *
 *   GET    /collections                        — Liste eigener Collections
 *   POST   /collections                        — Anlegen
 *   PATCH  /collections/:id                    — Umbenennen, Filter ändern, Reorder
 *   DELETE /collections/:id                    — Löschen
 *   GET    /collections/:id/galleries          — Filter ausführen, Galerien-Resultat
 *
 * Alle Routen sind owner-scoped — ein User sieht nur seine eigenen
 * Collections. Cross-Tenant-Zugriff ist nicht möglich, weil tenantId
 * UND ownerId aus der Auth kommen, nicht aus dem Request-Body.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import {
  smartCollectionFilterSchema,
  buildWhereClause,
} from "../services/smart-collection-filter.js";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  icon: z.string().max(40).optional(),
  filter: smartCollectionFilterSchema.default({}),
});

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  icon: z.string().max(40).nullable().optional(),
  filter: smartCollectionFilterSchema.optional(),
  sortOrder: z.number().int().optional(),
});

export async function registerCollectionRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // GET /collections
  // -------------------------------------------------------------------------
  app.get("/collections", async (req) => {
    const s = req.requireAuth();
    if (!req.tenantId) return { collections: [] };
    const cs = await prisma.smartCollection.findMany({
      where: { tenantId: req.tenantId, ownerId: s.user.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return {
      collections: cs.map((c) => ({
        id: c.id,
        name: c.name,
        icon: c.icon,
        filter: c.filter,
        sortOrder: c.sortOrder,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
    };
  });

  // -------------------------------------------------------------------------
  // POST /collections
  // -------------------------------------------------------------------------
  app.post("/collections", async (req, reply) => {
    const s = req.requireAuth();
    if (!req.tenantId) return reply.status(401).send({ error: "tenant" });
    const body = createSchema.parse(req.body);

    // sortOrder: ans Ende der existierenden Liste hängen.
    const max = await prisma.smartCollection.aggregate({
      where: { tenantId: req.tenantId, ownerId: s.user.id },
      _max: { sortOrder: true },
    });
    const sortOrder = (max._max.sortOrder ?? -1) + 1;

    const c = await prisma.smartCollection.create({
      data: {
        tenantId: req.tenantId,
        ownerId: s.user.id,
        name: body.name,
        icon: body.icon ?? null,
        filter: body.filter,
        sortOrder,
      },
    });
    return reply.status(201).send({
      collection: {
        id: c.id,
        name: c.name,
        icon: c.icon,
        filter: c.filter,
        sortOrder: c.sortOrder,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      },
    });
  });

  // -------------------------------------------------------------------------
  // PATCH /collections/:id
  // -------------------------------------------------------------------------
  app.patch<{ Params: { id: string } }>(
    "/collections/:id",
    async (req, reply) => {
      const s = req.requireAuth();
      if (!req.tenantId) return reply.status(401).send({ error: "tenant" });
      const body = patchSchema.parse(req.body);

      // Existenz + Owner-Match prüfen, damit wir auf 404 statt 500 fallen.
      const existing = await prisma.smartCollection.findFirst({
        where: {
          id: req.params.id,
          tenantId: req.tenantId,
          ownerId: s.user.id,
        },
      });
      if (!existing) {
        return reply.status(404).send({ error: "not_found" });
      }

      const c = await prisma.smartCollection.update({
        where: { id: existing.id },
        data: {
          ...(body.name !== undefined && { name: body.name }),
          ...(body.icon !== undefined && { icon: body.icon }),
          ...(body.filter !== undefined && { filter: body.filter }),
          ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
        },
      });
      return {
        collection: {
          id: c.id,
          name: c.name,
          icon: c.icon,
          filter: c.filter,
          sortOrder: c.sortOrder,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        },
      };
    }
  );

  // -------------------------------------------------------------------------
  // DELETE /collections/:id
  // -------------------------------------------------------------------------
  app.delete<{ Params: { id: string } }>(
    "/collections/:id",
    async (req, reply) => {
      const s = req.requireAuth();
      if (!req.tenantId) return reply.status(401).send({ error: "tenant" });
      const deleted = await prisma.smartCollection.deleteMany({
        where: {
          id: req.params.id,
          tenantId: req.tenantId,
          ownerId: s.user.id,
        },
      });
      if (deleted.count === 0) {
        return reply.status(404).send({ error: "not_found" });
      }
      return reply.status(204).send();
    }
  );

  // -------------------------------------------------------------------------
  // GET /collections/:id/galleries
  // -------------------------------------------------------------------------
  // Führt den Filter aus und gibt die Galerien-Liste zurück. Schema
  // matched die existierende GET /galleries-Response damit das Frontend
  // beide Pfade gleich rendern kann.
  app.get<{ Params: { id: string } }>(
    "/collections/:id/galleries",
    async (req, reply) => {
      const s = req.requireAuth();
      if (!req.tenantId) return reply.status(401).send({ error: "tenant" });

      const c = await prisma.smartCollection.findFirst({
        where: {
          id: req.params.id,
          tenantId: req.tenantId,
          ownerId: s.user.id,
        },
      });
      if (!c) return reply.status(404).send({ error: "not_found" });

      const where = buildWhereClause(c.filter, {
        tenantId: req.tenantId,
        ownerId: s.user.id,
      });

      const galleries = await prisma.gallery.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          slug: true,
          title: true,
          description: true,
          mode: true,
          status: true,
          downloadEnabled: true,
          watermarkEnabled: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { files: true } },
          tags: {
            select: {
              tag: { select: { id: true, name: true, color: true } },
            },
          },
        },
      });

      return {
        galleries: galleries.map((g) => ({
          id: g.id,
          slug: g.slug,
          title: g.title,
          description: g.description,
          mode: g.mode,
          status: g.status,
          downloadEnabled: g.downloadEnabled,
          watermarkEnabled: g.watermarkEnabled,
          createdAt: g.createdAt,
          updatedAt: g.updatedAt,
          fileCount: g._count.files,
          tags: g.tags.map((gt) => gt.tag),
        })),
      };
    }
  );
}
