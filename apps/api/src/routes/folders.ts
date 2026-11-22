/**
 * Lumio API — Galerie-Ordner (#73)
 *
 *   GET    /folders               — Ordnerbaum des Studios (flache Liste)
 *   POST   /folders               — Ordner anlegen { name, parentId? }
 *   PATCH  /folders/:id           — umbenennen / verschieben { name?, parentId? }
 *   DELETE /folders/:id           — löschen; Inhalt rutscht eine Ebene höher
 *   PUT    /folders/assign        — Galerien einem Ordner zuweisen
 *                                    { folderId: uuid | null, galleryIds: uuid[] }
 *
 * Ordner gelten pro Studio und sind für alle Teammitglieder gleich. Wer nur
 * auf einen Teil der Galerien Zugriff hat, sieht Ordner, deren Galerien
 * ausnahmslos anderen gehören, nicht (siehe visibleFolderIds). Kunden sehen
 * von Ordnern nichts — es gibt keine öffentliche Route.
 *
 * Alle Routen funktionieren auch mit API-Tokens (Authorization: Bearer …),
 * damit sich ein bestehendes Archiv per Skript einsortieren lässt.
 * Doku mit Beispiel: docs/FOLDERS.md.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { galleryAccessWhere } from "../lib/gallery-access.js";
import { logEvent } from "../services/audit.js";
import {
  MAX_FOLDERS_PER_TENANT,
  countGalleries,
  descendantIds,
  fitsDepth,
  siblingWithName,
  visibleFolderIds,
  wouldCreateCycle,
  type FolderNode,
} from "../services/folder-tree.js";
import type { SessionContext } from "../services/auth.js";

const nameSchema = z.string().trim().min(1).max(120);

const createSchema = z.object({
  name: nameSchema,
  parentId: z.string().uuid().nullable().optional(),
});

const updateSchema = z.object({
  name: nameSchema.optional(),
  parentId: z.string().uuid().nullable().optional(),
});

const assignSchema = z.object({
  folderId: z.string().uuid().nullable(),
  galleryIds: z.array(z.string().uuid()).min(1).max(1000),
});

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

async function loadFolders(tenantId: string): Promise<FolderNode[]> {
  return prisma.galleryFolder.findMany({
    where: { tenantId },
    select: { id: true, parentId: true, name: true },
  });
}

/** Anzahl Galerien je folderId — einmal gesamt, einmal mit Zugriff. */
async function galleryCountsByFolder(
  tenantId: string,
  s: SessionContext
): Promise<{ total: Map<string, number>; accessible: Map<string, number> }> {
  const [totalRows, accRows] = await Promise.all([
    prisma.gallery.groupBy({
      by: ["folderId"],
      where: { tenantId, folderId: { not: null } },
      _count: { _all: true },
    }),
    prisma.gallery.groupBy({
      by: ["folderId"],
      where: { tenantId, folderId: { not: null }, ...galleryAccessWhere(s) },
      _count: { _all: true },
    }),
  ]);
  const toMap = (rows: { folderId: string | null; _count: { _all: number } }[]) =>
    new Map(
      rows
        .filter((r) => r.folderId)
        .map((r) => [r.folderId as string, r._count._all])
    );
  return { total: toMap(totalRows), accessible: toMap(accRows) };
}

function isManager(s: SessionContext): boolean {
  return s.user.role === "owner" || s.user.role === "admin";
}

function notFound(reply: FastifyReply) {
  return reply.status(404).send({ error: "folder_not_found", message: "Folder not found." });
}

export async function registerFolderRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // GET /folders
  // -------------------------------------------------------------------------
  app.get("/folders", async (req: FastifyRequest) => {
    const s = req.requireAuth();
    const folders = await loadFolders(req.tenantId);
    const counts = await galleryCountsByFolder(req.tenantId, s);
    const total = countGalleries(folders, counts.total);
    const accessible = countGalleries(folders, counts.accessible);
    const visible = visibleFolderIds(folders, total, accessible);

    const out = folders
      .filter((f) => visible.has(f.id))
      .sort((a, b) => collator.compare(a.name, b.name))
      .map((f) => ({
        id: f.id,
        parentId: f.parentId && visible.has(f.parentId) ? f.parentId : null,
        name: f.name,
        galleryCount: accessible.get(f.id)?.direct ?? 0,
        totalGalleryCount: accessible.get(f.id)?.deep ?? 0,
      }));
    const [allCount, noFolderCount] = await Promise.all([
      prisma.gallery.count({ where: { tenantId: req.tenantId, ...galleryAccessWhere(s) } }),
      prisma.gallery.count({
        where: { tenantId: req.tenantId, folderId: null, ...galleryAccessWhere(s) },
      }),
    ]);
    return { folders: out, allGalleryCount: allCount, noFolderGalleryCount: noFolderCount };
  });

  // -------------------------------------------------------------------------
  // POST /folders
  // -------------------------------------------------------------------------
  app.post("/folders", async (req, reply) => {
    req.requireAuth();
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "bad_request", issues: parsed.error.issues });
    }
    const { name } = parsed.data;
    const parentId = parsed.data.parentId ?? null;

    const folders = await loadFolders(req.tenantId);
    if (folders.length >= MAX_FOLDERS_PER_TENANT) {
      return reply.status(400).send({ error: "folder_limit", message: "Too many folders." });
    }
    if (parentId && !folders.some((f) => f.id === parentId)) {
      return reply.status(404).send({ error: "folder_not_found", message: "Parent folder not found." });
    }
    const twin = siblingWithName(folders, parentId, name);
    if (twin) {
      return reply.status(409).send({
        error: "folder_name_taken",
        message: "A folder with this name already exists here.",
        folderId: twin.id,
      });
    }
    if (!fitsDepth(folders, null, parentId)) {
      return reply.status(400).send({ error: "folder_too_deep", message: "Folders are nested too deeply." });
    }

    const folder = await prisma.galleryFolder.create({
      data: { tenantId: req.tenantId, parentId, name },
      select: { id: true, parentId: true, name: true },
    });
    return reply.status(201).send({
      folder: { ...folder, galleryCount: 0, totalGalleryCount: 0 },
    });
  });

  // -------------------------------------------------------------------------
  // PATCH /folders/:id
  // -------------------------------------------------------------------------
  app.patch<{ Params: { id: string } }>("/folders/:id", async (req, reply) => {
    req.requireAuth();
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "bad_request", issues: parsed.error.issues });
    }
    const folders = await loadFolders(req.tenantId);
    const self = folders.find((f) => f.id === req.params.id);
    if (!self) return notFound(reply);

    const nextParent =
      parsed.data.parentId !== undefined ? parsed.data.parentId : self.parentId;
    const nextName = parsed.data.name ?? self.name;

    if (nextParent && !folders.some((f) => f.id === nextParent)) {
      return reply.status(404).send({ error: "folder_not_found", message: "Parent folder not found." });
    }
    if (wouldCreateCycle(folders, self.id, nextParent)) {
      return reply.status(400).send({
        error: "folder_cycle",
        message: "A folder cannot be moved into itself or one of its subfolders.",
      });
    }
    if (nextParent !== self.parentId && !fitsDepth(folders, self.id, nextParent)) {
      return reply.status(400).send({ error: "folder_too_deep", message: "Folders are nested too deeply." });
    }
    const twin = siblingWithName(folders, nextParent, nextName, self.id);
    if (twin) {
      return reply.status(409).send({
        error: "folder_name_taken",
        message: "A folder with this name already exists here.",
        folderId: twin.id,
      });
    }

    const folder = await prisma.galleryFolder.update({
      where: { id: self.id },
      data: { name: nextName, parentId: nextParent },
      select: { id: true, parentId: true, name: true },
    });
    return { folder };
  });

  // -------------------------------------------------------------------------
  // DELETE /folders/:id
  // -------------------------------------------------------------------------
  // Unterordner und Galerien wandern in den Elternordner (bzw. auf die
  // oberste Ebene). Es wird nichts außer dem Ordner selbst gelöscht.
  // Owner/Admin dürfen immer; andere nur, wenn im Teilbaum keine Galerie
  // liegt, auf die sie keinen Zugriff haben.
  app.delete<{ Params: { id: string } }>("/folders/:id", async (req, reply) => {
    const s = req.requireAuth();
    const folders = await loadFolders(req.tenantId);
    const self = folders.find((f) => f.id === req.params.id);
    if (!self) return notFound(reply);

    if (!isManager(s)) {
      const subtree = [self.id, ...descendantIds(folders, self.id)];
      const [all, mine] = await Promise.all([
        prisma.gallery.count({ where: { tenantId: req.tenantId, folderId: { in: subtree } } }),
        prisma.gallery.count({
          where: { tenantId: req.tenantId, folderId: { in: subtree }, ...galleryAccessWhere(s) },
        }),
      ]);
      if (all !== mine) {
        return reply.status(403).send({
          error: "folder_delete_forbidden",
          message: "This folder contains galleries you have no access to.",
        });
      }
    }

    const [movedFolders, movedGalleries] = await prisma.$transaction([
      prisma.galleryFolder.updateMany({
        where: { tenantId: req.tenantId, parentId: self.id },
        data: { parentId: self.parentId },
      }),
      prisma.gallery.updateMany({
        where: { tenantId: req.tenantId, folderId: self.id },
        data: { folderId: self.parentId },
      }),
      prisma.galleryFolder.delete({ where: { id: self.id } }),
    ]);

    await logEvent({
      tenantId: req.tenantId,
      actorType: "user",
      actorId: s.user.id,
      action: "folder.delete",
      targetType: "folder",
      targetId: self.id,
      payload: {
        name: self.name,
        movedFolders: movedFolders.count,
        movedGalleries: movedGalleries.count,
      },
      ipAddress: req.ip,
    });

    return {
      movedFolders: movedFolders.count,
      movedGalleries: movedGalleries.count,
    };
  });

  // -------------------------------------------------------------------------
  // PUT /folders/assign
  // -------------------------------------------------------------------------
  // Weist eine oder mehrere Galerien einem Ordner zu (folderId: null = aus
  // allen Ordnern nehmen). Galerien ohne Zugriff werden stillschweigend
  // übersprungen; `affected` sagt, wie viele tatsächlich bewegt wurden.
  app.put("/folders/assign", async (req, reply) => {
    const s = req.requireAuth();
    const parsed = assignSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "bad_request", issues: parsed.error.issues });
    }
    const { folderId, galleryIds } = parsed.data;
    if (folderId) {
      const exists = await prisma.galleryFolder.findFirst({
        where: { id: folderId, tenantId: req.tenantId },
        select: { id: true },
      });
      if (!exists) return notFound(reply);
    }
    const res = await prisma.gallery.updateMany({
      where: {
        tenantId: req.tenantId,
        id: { in: galleryIds },
        ...galleryAccessWhere(s),
      },
      data: { folderId },
    });
    return { affected: res.count };
  });
}
