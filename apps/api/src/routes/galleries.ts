/**
 * Lumio API — Gallery Routes
 *
 * Studio-seitig (mit Auth):
 *   GET    /galleries              — Liste eigener Galerien
 *   POST   /galleries              — neue Galerie
 *   GET    /galleries/:id          — Details
 *   PATCH  /galleries/:id          — Einstellungen ändern
 *   DELETE /galleries/:id          — Galerie löschen
 *
 * Kunden-seitig (öffentlich, optional mit Access-Token):
 *   GET    /g/:slug                — öffentliche Galerie-Daten
 *   POST   /g/:slug/unlock         — Passwort eingeben
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { generateGallerySlug } from "../services/ids.js";
import { presignGet } from "../services/storage.js";

const createGallerySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  mode: z.enum(["collaboration", "presentation"]).default("collaboration"),
  brandingId: z.string().uuid().optional(),
  downloadEnabled: z.boolean().default(true),
  watermarkEnabled: z.boolean().default(false),
  commentsEnabled: z.boolean().default(true),
  ratingsEnabled: z.boolean().default(true),
  selectionLimit: z.number().int().positive().optional(),
  expiresAt: z.string().datetime().optional(),
});

const updateGallerySchema = createGallerySchema.partial().extend({
  status: z.enum(["draft", "live", "archived"]).optional(),
});

export async function registerGalleryRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // GET /galleries — Liste eigener Galerien
  // -------------------------------------------------------------------------
  app.get("/galleries", async (req) => {
    const s = req.requireAuth();
    const galleries = await prisma.gallery.findMany({
      where: { tenantId: req.tenantId, ownerId: s.user.id },
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
      },
    });
    return {
      galleries: galleries.map((g) => ({
        ...g,
        fileCount: g._count.files,
        _count: undefined,
      })),
    };
  });

  // -------------------------------------------------------------------------
  // POST /galleries — neue Galerie anlegen
  // -------------------------------------------------------------------------
  app.post("/galleries", async (req, reply) => {
    const s = req.requireAuth();
    const body = createGallerySchema.parse(req.body);

    // Slug ist global eindeutig (User klickt einen Share-Link, der den Tenant
    // nicht im Pfad mitführt). Wir versuchen ein paar Mal bei Kollision.
    let slug = generateGallerySlug();
    for (let attempt = 0; attempt < 5; attempt++) {
      const exists = await prisma.gallery.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (!exists) break;
      slug = generateGallerySlug();
      if (attempt === 4) {
        return reply
          .status(500)
          .send({ error: "slug_collision", message: "could not generate slug" });
      }
    }

    const gallery = await prisma.gallery.create({
      data: {
        tenantId: req.tenantId,
        ownerId: s.user.id,
        slug,
        title: body.title,
        description: body.description ?? null,
        mode: body.mode,
        brandingId: body.brandingId ?? null,
        downloadEnabled: body.downloadEnabled,
        watermarkEnabled: body.watermarkEnabled,
        commentsEnabled: body.commentsEnabled,
        ratingsEnabled: body.ratingsEnabled,
        selectionLimit: body.selectionLimit ?? null,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      },
    });

    await prisma.event
      .create({
        data: {
          tenantId: req.tenantId,
          actorType: "user",
          actorId: s.user.id,
          action: "gallery.create",
          targetType: "gallery",
          targetId: gallery.id,
          payload: { slug, title: body.title },
        },
      })
      .catch(() => {});

    return reply.status(201).send({ gallery });
  });

  // -------------------------------------------------------------------------
  // GET /galleries/:id — Details inkl. Files
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    "/galleries/:id",
    async (req, reply) => {
      const s = req.requireAuth();
      const gallery = await prisma.gallery.findFirst({
        where: {
          id: req.params.id,
          tenantId: req.tenantId,
          ownerId: s.user.id,
        },
        include: {
          files: {
            orderBy: { sortIndex: "asc" },
            select: {
              id: true,
              originalFilename: true,
              mimeType: true,
              sizeBytes: true,
              kind: true,
              status: true,
              width: true,
              height: true,
              sortIndex: true,
              createdAt: true,
              renditions: {
                select: { kind: true, storageKey: true, format: true },
              },
            },
          },
          _count: { select: { files: true } },
        },
      });
      if (!gallery) {
        return reply.status(404).send({ error: "not_found" });
      }

      // BigInt → number + thumbUrl optional auflösen
      const files = await Promise.all(
        gallery.files.map(async (f) => {
          const thumb = f.renditions.find((r) => r.kind === "thumb");
          const thumbUrl = thumb
            ? await presignGet({ key: thumb.storageKey })
            : null;
          return {
            id: f.id,
            originalFilename: f.originalFilename,
            mimeType: f.mimeType,
            sizeBytes: Number(f.sizeBytes),
            kind: f.kind,
            status: f.status,
            width: f.width,
            height: f.height,
            sortIndex: f.sortIndex,
            createdAt: f.createdAt,
            thumbUrl,
          };
        })
      );

      return {
        gallery: {
          ...gallery,
          files,
          fileCount: gallery._count.files,
          _count: undefined,
        },
      };
    }
  );

  // -------------------------------------------------------------------------
  // PATCH /galleries/:id
  // -------------------------------------------------------------------------
  app.patch<{ Params: { id: string } }>(
    "/galleries/:id",
    async (req, reply) => {
      const s = req.requireAuth();
      const body = updateGallerySchema.parse(req.body);

      const existing = await prisma.gallery.findFirst({
        where: {
          id: req.params.id,
          tenantId: req.tenantId,
          ownerId: s.user.id,
        },
        select: { id: true },
      });
      if (!existing) return reply.status(404).send({ error: "not_found" });

      const gallery = await prisma.gallery.update({
        where: { id: existing.id },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.description !== undefined
            ? { description: body.description }
            : {}),
          ...(body.mode !== undefined ? { mode: body.mode } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.brandingId !== undefined
            ? { brandingId: body.brandingId }
            : {}),
          ...(body.downloadEnabled !== undefined
            ? { downloadEnabled: body.downloadEnabled }
            : {}),
          ...(body.watermarkEnabled !== undefined
            ? { watermarkEnabled: body.watermarkEnabled }
            : {}),
          ...(body.commentsEnabled !== undefined
            ? { commentsEnabled: body.commentsEnabled }
            : {}),
          ...(body.ratingsEnabled !== undefined
            ? { ratingsEnabled: body.ratingsEnabled }
            : {}),
          ...(body.selectionLimit !== undefined
            ? { selectionLimit: body.selectionLimit }
            : {}),
          ...(body.expiresAt !== undefined
            ? {
                expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
              }
            : {}),
        },
      });
      return { gallery };
    }
  );

  // -------------------------------------------------------------------------
  // DELETE /galleries/:id
  // -------------------------------------------------------------------------
  // Soft-Delete via status=archived ist auch sinnvoll, aber für jetzt:
  // Hard-Delete. S3-Aufräumen läuft als Worker-Job (TODO).
  app.delete<{ Params: { id: string } }>(
    "/galleries/:id",
    async (req, reply) => {
      const s = req.requireAuth();
      const existing = await prisma.gallery.findFirst({
        where: {
          id: req.params.id,
          tenantId: req.tenantId,
          ownerId: s.user.id,
        },
        select: { id: true, slug: true },
      });
      if (!existing) return reply.status(404).send({ error: "not_found" });

      await prisma.gallery.delete({ where: { id: existing.id } });

      await prisma.event
        .create({
          data: {
            tenantId: req.tenantId,
            actorType: "user",
            actorId: s.user.id,
            action: "gallery.delete",
            targetType: "gallery",
            targetId: existing.id,
            payload: { slug: existing.slug },
          },
        })
        .catch(() => {});

      // TODO: Worker-Job zum Aufräumen der S3-Objekte queuen
      return reply.status(204).send();
    }
  );

  // -------------------------------------------------------------------------
  // GET /g/:slug — Kunden-Sicht (öffentlich)
  // -------------------------------------------------------------------------
  app.get<{ Params: { slug: string } }>("/g/:slug", async (req, reply) => {
    const gallery = await prisma.gallery.findUnique({
      where: { slug: req.params.slug },
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        mode: true,
        status: true,
        downloadEnabled: true,
        watermarkEnabled: true,
        commentsEnabled: true,
        ratingsEnabled: true,
        passwordHash: true,
        expiresAt: true,
        branding: true,
      },
    });
    if (!gallery || gallery.status !== "live") {
      return reply.status(404).send({ error: "not_found" });
    }
    if (gallery.expiresAt && gallery.expiresAt < new Date()) {
      return reply.status(410).send({ error: "expired" });
    }

    // Wenn ein Passwort gesetzt ist, gibt's hier nur die Minimal-Info,
    // bis der Client /g/:slug/unlock aufgerufen hat. Vollständige Auflistung
    // kommt in einem Folge-Endpoint (Sprint 3 für die Kunden-Seite).
    return {
      gallery: {
        id: gallery.id,
        slug: gallery.slug,
        title: gallery.title,
        description: gallery.description,
        mode: gallery.mode,
        downloadEnabled: gallery.downloadEnabled,
        watermarkEnabled: gallery.watermarkEnabled,
        commentsEnabled: gallery.commentsEnabled,
        ratingsEnabled: gallery.ratingsEnabled,
        requiresPassword: !!gallery.passwordHash,
        branding: gallery.branding,
      },
    };
  });
}
