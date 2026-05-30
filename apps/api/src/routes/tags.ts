/**
 * Lumio API — Tag Management Routes
 *
 *   GET    /tags                                 — Liste aller Tags des Tenants
 *   POST   /tags                                 — Neuen Tag anlegen
 *   PATCH  /tags/:id                             — Name / Color / Parent ändern
 *   DELETE /tags/:id                             — Tag löschen (Joins kaskadieren)
 *
 *   POST   /galleries/:id/tags                   — Tag auf Galerie setzen
 *   DELETE /galleries/:id/tags/:tagId            — Tag von Galerie entfernen
 *   POST   /files/:id/tags                       — Tag auf File setzen
 *   DELETE /files/:id/tags/:tagId                — Tag von File entfernen
 *
 * Bulk-Assign auf mehreren Files kann später kommen — erstmal kommt das
 * Studio mit einzelnen Picks gut aus.
 *
 * Validierung:
 *   - color muss "#rrggbb" sein (lower- oder uppercase)
 *   - name max 60 chars, min 1, getrimmt
 *   - parentId-Cycle wird verhindert: ein Tag kann nicht zum Vorfahren
 *     seines eigenen Subtrees gemacht werden
 *   - name innerhalb eines Parents unique (case-insensitive)
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { galleryAccessWhere } from "../lib/gallery-access.js";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(HEX_COLOR, "color must be #rrggbb").optional(),
  parentId: z.string().uuid().nullable().optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  color: z.string().regex(HEX_COLOR, "color must be #rrggbb").optional(),
  parentId: z.string().uuid().nullable().optional(),
});

const assignSchema = z.object({
  tagId: z.string().uuid(),
});

/**
 * Erlaubt parentId? Verhindert Selbst-Referenz und Zyklen, indem wir
 * den Pfad vom Kandidaten-Parent zur Wurzel zurückverfolgen und prüfen,
 * dass `selfId` nicht darin auftaucht.
 *
 * Bei einer realistischen Tag-Tree-Tiefe (≤ 10) ist die Schleife
 * vernachlässigbar. Wenn jemand 1000 Tags nestet, fallen wir nach
 * 50 Hops raus und antworten 400 — billiger als ein Detection-
 * Algorithmus auf SQL-Ebene.
 */
async function wouldCreateCycle(
  tenantId: string,
  selfId: string,
  newParentId: string
): Promise<boolean> {
  if (selfId === newParentId) return true;
  let cursor: string | null = newParentId;
  for (let hops = 0; hops < 50 && cursor; hops++) {
    const node: { parentId: string | null } | null = await prisma.tag.findFirst(
      {
        where: { id: cursor, tenantId },
        select: { parentId: true },
      }
    );
    if (!node) return false;
    if (node.parentId === selfId) return true;
    cursor = node.parentId;
  }
  return false;
}

/**
 * Sucht ein gleichnamiges Sibling im selben Parent. Case-insensitive,
 * exklusive `exceptId` (für Updates, wo das Tag selbst nicht gegen sich
 * gewinnt).
 */
async function nameConflict(
  tenantId: string,
  name: string,
  parentId: string | null,
  exceptId?: string
): Promise<boolean> {
  const existing = await prisma.tag.findFirst({
    where: {
      tenantId,
      parentId: parentId ?? null,
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
    select: { id: true },
  });
  return !!existing;
}

export async function registerTagRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // GET /tags — flache Liste mit Counts (galleries / files je Tag)
  // -------------------------------------------------------------------------
  // Wir liefern die Liste flach + parentId, damit das Frontend selber den
  // Baum zusammenbauen kann (oder als flache Liste rendern). Counts
  // helfen beim Aufräum-Workflow ("welche Tags sind ungenutzt?").
  app.get("/tags", async (req) => {
    req.requireAuth();
    const tags = await prisma.tag.findMany({
      where: { tenantId: req.tenantId },
      orderBy: [{ parentId: { sort: "asc", nulls: "first" } }, { name: "asc" }],
      include: {
        _count: { select: { galleries: true, files: true } },
      },
    });
    return {
      tags: tags.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        parentId: t.parentId,
        galleryCount: t._count.galleries,
        fileCount: t._count.files,
      })),
    };
  });

  // -------------------------------------------------------------------------
  // POST /tags
  // -------------------------------------------------------------------------
  app.post("/tags", async (req, reply) => {
    req.requireAuth();
    const body = createSchema.parse(req.body);

    // Parent-Validierung: gehört zum selben Tenant?
    if (body.parentId) {
      const parent = await prisma.tag.findFirst({
        where: { id: body.parentId, tenantId: req.tenantId },
        select: { id: true },
      });
      if (!parent) {
        return reply.status(400).send({ error: "parent_not_found" });
      }
    }

    if (await nameConflict(req.tenantId, body.name, body.parentId ?? null)) {
      return reply.status(409).send({ error: "name_taken" });
    }

    const tag = await prisma.tag.create({
      data: {
        tenantId: req.tenantId,
        name: body.name,
        color: body.color ?? "#94a3b8",
        parentId: body.parentId ?? null,
      },
    });
    return reply.status(201).send({
      tag: {
        id: tag.id,
        name: tag.name,
        color: tag.color,
        parentId: tag.parentId,
        galleryCount: 0,
        fileCount: 0,
      },
    });
  });

  // -------------------------------------------------------------------------
  // PATCH /tags/:id
  // -------------------------------------------------------------------------
  app.patch<{ Params: { id: string } }>("/tags/:id", async (req, reply) => {
    req.requireAuth();
    const body = updateSchema.parse(req.body);
    const existing = await prisma.tag.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
    });
    if (!existing) return reply.status(404).send({ error: "not_found" });

    // Cycle-Check: nur wenn parentId neu gesetzt wird und nicht null ist
    if (body.parentId !== undefined && body.parentId !== null) {
      if (await wouldCreateCycle(req.tenantId, existing.id, body.parentId)) {
        return reply.status(400).send({ error: "cycle_detected" });
      }
      // Parent muss zum Tenant gehören
      const parent = await prisma.tag.findFirst({
        where: { id: body.parentId, tenantId: req.tenantId },
        select: { id: true },
      });
      if (!parent) {
        return reply.status(400).send({ error: "parent_not_found" });
      }
    }

    // Name-Conflict-Check: nur prüfen wenn name oder parentId geändert
    const newName = body.name ?? existing.name;
    const newParentId =
      body.parentId !== undefined ? body.parentId : existing.parentId;
    if (
      (body.name !== undefined && body.name !== existing.name) ||
      (body.parentId !== undefined && body.parentId !== existing.parentId)
    ) {
      if (
        await nameConflict(req.tenantId, newName, newParentId, existing.id)
      ) {
        return reply.status(409).send({ error: "name_taken" });
      }
    }

    const tag = await prisma.tag.update({
      where: { id: existing.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.parentId !== undefined
          ? { parentId: body.parentId }
          : {}),
      },
      include: {
        _count: { select: { galleries: true, files: true } },
      },
    });
    return {
      tag: {
        id: tag.id,
        name: tag.name,
        color: tag.color,
        parentId: tag.parentId,
        galleryCount: tag._count.galleries,
        fileCount: tag._count.files,
      },
    };
  });

  // -------------------------------------------------------------------------
  // DELETE /tags/:id
  // -------------------------------------------------------------------------
  app.delete<{ Params: { id: string } }>("/tags/:id", async (req, reply) => {
    req.requireAuth();
    const existing = await prisma.tag.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
      select: { id: true },
    });
    if (!existing) return reply.status(404).send({ error: "not_found" });
    await prisma.tag.delete({ where: { id: existing.id } });
    return reply.status(204).send();
  });

  // -------------------------------------------------------------------------
  // POST /galleries/:id/tags + DELETE /galleries/:id/tags/:tagId
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/galleries/:id/tags",
    async (req, reply) => {
      const s = req.requireAuth();
      const body = assignSchema.parse(req.body);

      // Ownership: nur eigene Galerien
      const gallery = await prisma.gallery.findFirst({
        where: {
          id: req.params.id,
          tenantId: req.tenantId,
          ...galleryAccessWhere(s),
        },
        select: { id: true },
      });
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const tag = await prisma.tag.findFirst({
        where: { id: body.tagId, tenantId: req.tenantId },
        select: { id: true },
      });
      if (!tag) return reply.status(404).send({ error: "tag_not_found" });

      // upsert (idempotent — doppeltes Assign ist no-op)
      await prisma.galleryTag.upsert({
        where: {
          galleryId_tagId: { galleryId: gallery.id, tagId: tag.id },
        },
        update: {},
        create: { galleryId: gallery.id, tagId: tag.id },
      });
      return reply.status(204).send();
    }
  );

  app.delete<{ Params: { id: string; tagId: string } }>(
    "/galleries/:id/tags/:tagId",
    async (req, reply) => {
      const s = req.requireAuth();
      const gallery = await prisma.gallery.findFirst({
        where: {
          id: req.params.id,
          tenantId: req.tenantId,
          ...galleryAccessWhere(s),
        },
        select: { id: true },
      });
      if (!gallery) return reply.status(404).send({ error: "not_found" });
      await prisma.galleryTag.deleteMany({
        where: { galleryId: gallery.id, tagId: req.params.tagId },
      });
      return reply.status(204).send();
    }
  );

  // -------------------------------------------------------------------------
  // POST /files/:id/tags + DELETE /files/:id/tags/:tagId
  // -------------------------------------------------------------------------
  // File-Ownership läuft über Gallery → Tenant + Owner.
  app.get<{ Params: { id: string } }>(
    "/files/:id/tags",
    async (req, reply) => {
      const s = req.requireAuth();
      const file = await prisma.file.findFirst({
        where: {
          id: req.params.id,
          gallery: { tenantId: req.tenantId, ...galleryAccessWhere(s) },
        },
        select: {
          id: true,
          tags: {
            select: {
              tag: { select: { id: true, name: true, color: true } },
            },
          },
        },
      });
      if (!file) return reply.status(404).send({ error: "not_found" });
      return { tags: file.tags.map((ft) => ft.tag) };
    }
  );

  app.post<{ Params: { id: string } }>(
    "/files/:id/tags",
    async (req, reply) => {
      const s = req.requireAuth();
      const body = assignSchema.parse(req.body);
      const file = await prisma.file.findFirst({
        where: {
          id: req.params.id,
          gallery: { tenantId: req.tenantId, ...galleryAccessWhere(s) },
        },
        select: { id: true },
      });
      if (!file) return reply.status(404).send({ error: "not_found" });
      const tag = await prisma.tag.findFirst({
        where: { id: body.tagId, tenantId: req.tenantId },
        select: { id: true },
      });
      if (!tag) return reply.status(404).send({ error: "tag_not_found" });
      await prisma.fileTag.upsert({
        where: { fileId_tagId: { fileId: file.id, tagId: tag.id } },
        update: {},
        create: { fileId: file.id, tagId: tag.id },
      });
      return reply.status(204).send();
    }
  );

  app.delete<{ Params: { id: string; tagId: string } }>(
    "/files/:id/tags/:tagId",
    async (req, reply) => {
      const s = req.requireAuth();
      const file = await prisma.file.findFirst({
        where: {
          id: req.params.id,
          gallery: { tenantId: req.tenantId, ...galleryAccessWhere(s) },
        },
        select: { id: true },
      });
      if (!file) return reply.status(404).send({ error: "not_found" });
      await prisma.fileTag.deleteMany({
        where: { fileId: file.id, tagId: req.params.tagId },
      });
      return reply.status(204).send();
    }
  );
}
