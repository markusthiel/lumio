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
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { randomBytes, createHash } from "node:crypto";

import { prisma } from "../db.js";
import { config } from "../config.js";
import { generateGallerySlug } from "../services/ids.js";
import { presignGet, presignPut } from "../services/storage.js";
import { verifyPassword } from "../services/auth.js";
import { enqueue, Queues } from "../services/queue.js";
import { resolveGalleryBranding } from "../services/branding.js";
import { logEvent } from "../services/audit.js";
import { checkActiveGalleriesLimit, checkFeatureAvailable } from "../services/usage.js";
import { publishEvent } from "../services/webhooks.js";
import {
  createVisitorToken,
  verifyVisitorToken,
  visitorCookieName,
} from "../services/visitor.js";

const createGallerySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  mode: z.enum(["collaboration", "presentation"]).optional(),
  brandingId: z.string().uuid().nullable().optional(),
  downloadEnabled: z.boolean().optional(),
  downloadOriginalsEnabled: z.boolean().optional(),
  watermarkEnabled: z.boolean().optional(),
  commentsEnabled: z.boolean().optional(),
  ratingsEnabled: z.boolean().optional(),
  selectionLimit: z.number().int().positive().optional(),
  expiresAt: z.string().datetime().optional(),
  // Optional: Template übernehmen. Explizit gesetzte Felder im Request
  // gewinnen über die Template-Werte.
  templateId: z.string().uuid().optional(),
});

const HEX_RGB = /^#[0-9a-fA-F]{6}$/;
const HEX_RGBA = /^#[0-9a-fA-F]{8}$/;
const HEX_RGB_OR_RGBA = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const updateGallerySchema = createGallerySchema.partial().extend({
  status: z.enum(["draft", "live", "archived"]).optional(),
  // Header-Customization. Alle nullable, damit das Studio Felder
  // wieder leeren kann (null = "wieder Default").
  heroFileId: z.string().uuid().nullable().optional(),
  heroUrl: z.string().max(500).nullable().optional(),
  heroOverlayColor: z
    .string()
    .regex(HEX_RGBA, "must be #RRGGBBAA")
    .nullable()
    .optional(),
  heroBackgroundColor: z
    .string()
    .regex(HEX_RGB, "must be #RRGGBB")
    .nullable()
    .optional(),
  eventLogoUrl: z.string().max(500).nullable().optional(),
  welcomeMarkdown: z.string().max(20_000).nullable().optional(),
  heroLayout: z
    .enum(["minimal", "splash", "side_by_side", "centered"])
    .optional(),
  fontHeading: z.string().max(40).nullable().optional(),
  fontBody: z.string().max(40).nullable().optional(),
  gridLayout: z.enum(["justified", "equal"]).optional(),
  slideshowTransition: z
    .enum(["fade", "slide", "kenburns"])
    .optional(),
  slideshowAudioUrl: z.string().max(500).nullable().optional(),
  footerMarkdown: z.string().max(20_000).nullable().optional(),
  colorBackground: z
    .string()
    .regex(HEX_RGB, "must be #RRGGBB")
    .nullable()
    .optional(),
  colorAccent: z
    .string()
    .regex(HEX_RGB, "must be #RRGGBB")
    .nullable()
    .optional(),
});

const unlockSchema = z.object({
  password: z.string().min(1).max(200).optional(),
  token: z.string().min(1).max(200).optional(),
});

/**
 * Lädt aus dem Visitor-Cookie der Galerie die Galerie-Id und (falls geliefert)
 * den Access-Token. Gibt null zurück, wenn der Visitor nicht freigeschaltet ist.
 *
 * Wir können hier nicht über den Slug auflösen, ohne erst die Galerie zu
 * fetchen, weil das Cookie an die galleryId gebunden ist. Caller muss also
 * den Slug → galleryId schon haben (z.B. aus dem Pfad-Param).
 */
export async function loadVisitor(
  req: FastifyRequest & { params: { slug: string } }
): Promise<{ galleryId: string; accessId: string | null } | null> {
  // Wir holen die Galerie über den Slug, damit wir wissen, welches
  // Cookie zu prüfen ist.
  const gallery = await prisma.gallery.findUnique({
    where: { slug: req.params.slug },
    select: {
      id: true,
      status: true,
      expiresAt: true,
      passwordHash: true,
    },
  });
  if (!gallery || gallery.status !== "live") return null;
  if (gallery.expiresAt && gallery.expiresAt < new Date()) return null;

  const cookieName = visitorCookieName(gallery.id);
  const cookie = req.cookies?.[cookieName];
  if (!cookie) {
    // Wenn keine Auth nötig ist (kein Passwort), darf der Visitor anonym
    // browsen. Das ist Picdrop-Verhalten.
    if (!gallery.passwordHash) {
      return { galleryId: gallery.id, accessId: null };
    }
    return null;
  }

  const claims = verifyVisitorToken(cookie);
  if (!claims || claims.gid !== gallery.id) return null;
  if (gallery.passwordHash && !claims.pw) return null;

  return { galleryId: gallery.id, accessId: claims.aid };
}

export async function registerGalleryRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // GET /galleries — Liste eigener Galerien
  // -------------------------------------------------------------------------
  // Optionaler Filter: ?tag=<uuid>[,<uuid>...] — Galerien, die JEDEN
  // der angegebenen Tags tragen ("AND"-Semantik). Wir gehen mit AND statt
  // OR, weil das Studio damit zielführend einschränkt; OR-Filter
  // ("zeige Hochzeit ODER Portrait") hat selten praktischen Wert, der
  // den Mental-Load wert wäre.
  app.get<{ Querystring: { tag?: string } }>(
    "/galleries",
    async (req) => {
      const s = req.requireAuth();
      const tagFilterIds = (req.query.tag ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter((t) => /^[0-9a-f-]{36}$/i.test(t));

      const galleries = await prisma.gallery.findMany({
        where: {
          tenantId: req.tenantId,
          ownerId: s.user.id,
          // AND-Semantik: für jeden geforderten Tag muss ein GalleryTag
          // existieren. Prisma's "AND: [...]" + "some" baut genau das.
          ...(tagFilterIds.length > 0
            ? {
                AND: tagFilterIds.map((tagId) => ({
                  tags: { some: { tagId } },
                })),
              }
            : {}),
        },
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
              tag: {
                select: { id: true, name: true, color: true },
              },
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

  // -------------------------------------------------------------------------
  // POST /galleries — neue Galerie anlegen
  // -------------------------------------------------------------------------
  app.post("/galleries", async (req, reply) => {
    const s = req.requireAuth();
    const body = createGallerySchema.parse(req.body);

    // Plan-Limit-Check: aktive Galerien-Limit noch nicht erreicht?
    // Nur wenn Billing-Mode aktiv ist (sonst selbst-gehostet, keine Limits).
    if (config.BILLING_ENABLED && req.tenantId) {
      const check = await checkActiveGalleriesLimit(req.tenantId);
      if (!check.ok) {
        return reply.status(402).send(check);
      }
    }

    // Template laden, falls angegeben — und prüfen dass es dem Tenant gehört.
    let template: Awaited<ReturnType<typeof prisma.galleryTemplate.findFirst>> =
      null;
    if (body.templateId) {
      template = await prisma.galleryTemplate.findFirst({
        where: { id: body.templateId, tenantId: req.tenantId },
      });
      if (!template) {
        return reply.status(400).send({ error: "bad_template" });
      }
    }

    // Effektive Werte: explizit im Request → Template → Lumio-Defaults
    const eff = {
      mode: body.mode ?? template?.mode ?? "collaboration",
      description:
        body.description ?? template?.defaultDescription ?? null,
      brandingId: body.brandingId !== undefined
        ? body.brandingId
        : template?.brandingId ?? null,
      downloadEnabled:
        body.downloadEnabled ?? template?.downloadEnabled ?? true,
      watermarkEnabled:
        body.watermarkEnabled ?? template?.watermarkEnabled ?? false,
      commentsEnabled:
        body.commentsEnabled ?? template?.commentsEnabled ?? true,
      ratingsEnabled:
        body.ratingsEnabled ?? template?.ratingsEnabled ?? true,
      expiresAt: body.expiresAt
        ? new Date(body.expiresAt)
        : template?.defaultExpiryDays
        ? new Date(
            Date.now() + template.defaultExpiryDays * 24 * 3600 * 1000
          )
        : null,
    };

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
        description: eff.description,
        mode: eff.mode,
        brandingId: eff.brandingId,
        downloadEnabled: eff.downloadEnabled,
        watermarkEnabled: eff.watermarkEnabled,
        commentsEnabled: eff.commentsEnabled,
        ratingsEnabled: eff.ratingsEnabled,
        selectionLimit: body.selectionLimit ?? null,
        expiresAt: eff.expiresAt,
      },
    });

    await logEvent({
      tenantId: req.tenantId,
      actorType: "user",
      actorId: s.user.id,
      action: "gallery.create",
      targetType: "gallery",
      targetId: gallery.id,
      payload: { slug, title: body.title },
      ipAddress: req.ip,
    });

    await publishEvent({
      tenantId: req.tenantId,
      eventType: "gallery.created",
      payload: {
        galleryId: gallery.id,
        slug,
        title: body.title,
        mode: gallery.mode,
        ownerId: s.user.id,
      },
    });

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
              errorMessage: true,
              width: true,
              height: true,
              sortIndex: true,
              sectionId: true,
              createdAt: true,
              renditions: {
                select: { kind: true, storageKey: true, format: true },
              },
              tags: {
                select: {
                  tag: { select: { id: true, name: true, color: true } },
                },
              },
            },
          },
          tags: {
            select: {
              tag: { select: { id: true, name: true, color: true } },
            },
          },
          _count: { select: { files: true } },
        },
      });
      if (!gallery) {
        return reply.status(404).send({ error: "not_found" });
      }

      // BigInt → number + thumbUrl + webUrl optional auflösen.
      // webUrl wird gebraucht für die Annotation-Detail-Ansicht im
      // Proofing-Tab — höhere Auflösung als der Thumb, ohne dass wir
      // ein Original ausliefern müssen.
      const files = await Promise.all(
        gallery.files.map(async (f) => {
          const thumb = f.renditions.find((r) => r.kind === "thumb");
          const web = f.renditions.find((r) => r.kind === "web");
          const preview = f.renditions.find((r) => r.kind === "preview");
          const thumbUrl = thumb
            ? await presignGet({ key: thumb.storageKey })
            : null;
          const webUrl = web
            ? await presignGet({ key: web.storageKey })
            : preview
            ? await presignGet({ key: preview.storageKey })
            : null;
          return {
            id: f.id,
            originalFilename: f.originalFilename,
            mimeType: f.mimeType,
            sizeBytes: Number(f.sizeBytes),
            kind: f.kind,
            status: f.status,
            errorMessage: f.errorMessage,
            width: f.width,
            height: f.height,
            sortIndex: f.sortIndex,
            sectionId: f.sectionId,
            createdAt: f.createdAt,
            thumbUrl,
            webUrl,
            tags: f.tags.map((ft) => ft.tag),
          };
        })
      );

      return {
        gallery: {
          ...gallery,
          files,
          fileCount: gallery._count.files,
          tags: gallery.tags.map((gt) => gt.tag),
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
        select: { id: true, slug: true, watermarkEnabled: true, status: true },
      });
      if (!existing) return reply.status(404).send({ error: "not_found" });

      const turningOnWatermark =
        body.watermarkEnabled === true && !existing.watermarkEnabled;
      const goingLive = body.status === "live" && existing.status !== "live";

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
          ...(body.downloadOriginalsEnabled !== undefined
            ? { downloadOriginalsEnabled: body.downloadOriginalsEnabled }
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
          // Header-Customization — durchreichen wenn explizit gesetzt
          // (auch null → Feld leeren ist erlaubt).
          ...(body.heroFileId !== undefined ? { heroFileId: body.heroFileId } : {}),
          ...(body.heroUrl !== undefined ? { heroUrl: body.heroUrl } : {}),
          ...(body.heroOverlayColor !== undefined
            ? { heroOverlayColor: body.heroOverlayColor }
            : {}),
          ...(body.heroBackgroundColor !== undefined
            ? { heroBackgroundColor: body.heroBackgroundColor }
            : {}),
          ...(body.eventLogoUrl !== undefined
            ? { eventLogoUrl: body.eventLogoUrl }
            : {}),
          ...(body.welcomeMarkdown !== undefined
            ? { welcomeMarkdown: body.welcomeMarkdown }
            : {}),
          ...(body.heroLayout !== undefined
            ? { heroLayout: body.heroLayout }
            : {}),
          ...(body.fontHeading !== undefined
            ? { fontHeading: body.fontHeading }
            : {}),
          ...(body.fontBody !== undefined
            ? { fontBody: body.fontBody }
            : {}),
          ...(body.gridLayout !== undefined
            ? { gridLayout: body.gridLayout }
            : {}),
          ...(body.slideshowTransition !== undefined
            ? { slideshowTransition: body.slideshowTransition }
            : {}),
          ...(body.slideshowAudioUrl !== undefined
            ? { slideshowAudioUrl: body.slideshowAudioUrl }
            : {}),
          ...(body.footerMarkdown !== undefined
            ? { footerMarkdown: body.footerMarkdown }
            : {}),
          ...(body.colorBackground !== undefined
            ? { colorBackground: body.colorBackground }
            : {}),
          ...(body.colorAccent !== undefined
            ? { colorAccent: body.colorAccent }
            : {}),
        },
      });

      // Watermark gerade eingeschaltet → für alle Files Watermark-Rendition
      // generieren (fire-and-forget — der Worker macht den Rest)
      if (turningOnWatermark) {
        const files = await prisma.file.findMany({
          where: { galleryId: gallery.id, status: "ready" },
          select: { id: true },
        });
        for (const f of files) {
          await enqueue(Queues.FILE_PROCESSING, {
            type: "process_watermark",
            fileId: f.id,
            tenantId: req.tenantId,
            galleryId: gallery.id,
          }).catch(() => {});
        }
        app.log.info(
          { galleryId: gallery.id, count: files.length },
          "watermark jobs enqueued"
        );
      }

      // Welche Felder wurden eigentlich geändert? Nicht alles ist
      // Audit-würdig, aber das Set ist klein genug, dass wir's einfach
      // mitschreiben. Vermeidet späteres Raten "was hat sich geändert".
      const changedFields = Object.entries(body)
        .filter(([, v]) => v !== undefined)
        .map(([k]) => k);
      await logEvent({
        tenantId: req.tenantId,
        actorType: "user",
        actorId: s.user.id,
        action: "gallery.update",
        targetType: "gallery",
        targetId: gallery.id,
        payload: { fields: changedFields },
        ipAddress: req.ip,
      });

      if (goingLive) {
        await publishEvent({
          tenantId: req.tenantId,
          eventType: "gallery.live",
          payload: {
            galleryId: gallery.id,
            slug: existing.slug,
            title: gallery.title,
          },
        });
      }

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

      await logEvent({
        tenantId: req.tenantId,
        actorType: "user",
        actorId: s.user.id,
        action: "gallery.delete",
        targetType: "gallery",
        targetId: existing.id,
        payload: { slug: existing.slug },
        ipAddress: req.ip,
      });

      await publishEvent({
        tenantId: req.tenantId,
        eventType: "gallery.deleted",
        payload: { galleryId: existing.id, slug: existing.slug },
      });

      // TODO: Worker-Job zum Aufräumen der S3-Objekte queuen
      return reply.status(204).send();
    }
  );

  // -------------------------------------------------------------------------
  // Section-CRUD (Kapitel-Verwaltung pro Galerie)
  // -------------------------------------------------------------------------
  // Sections sind optionale Kapitel innerhalb einer Galerie. Eine
  // Section gehört genau einer Galerie; Files gehören optional einer
  // Section (sectionId null = im Default-Bucket der Galerie). Sortier-
  // Reihenfolge über sortIndex (kleinster oben).
  //
  // Routes:
  //   GET    /galleries/:id/sections                — alle Sections + File-Counts
  //   POST   /galleries/:id/sections                — neue Section anlegen
  //   PATCH  /galleries/:id/sections/:sectionId     — Section bearbeiten
  //   DELETE /galleries/:id/sections/:sectionId     — Section löschen
  //                                                   (Files fallen zurück in Default)
  //   POST   /galleries/:id/sections/reorder        — sortIndex-Bulk-Update
  //   POST   /galleries/:id/sections/:sectionId/files — Files zuweisen (bulk)
  //   DELETE /galleries/:id/sections/files          — sectionId von Files entfernen

  const sectionCreateSchema = z.object({
    title: z.string().min(1).max(120),
    description: z.string().max(400).nullable().optional(),
    coverFileId: z.string().uuid().nullable().optional(),
  });

  const sectionUpdateSchema = z.object({
    title: z.string().min(1).max(120).optional(),
    description: z.string().max(400).nullable().optional(),
    coverFileId: z.string().uuid().nullable().optional(),
    sortIndex: z.number().int().min(0).max(10_000).optional(),
  });

  const sectionReorderSchema = z.object({
    // Liste von Section-IDs in gewünschter Reihenfolge. Wir setzen
    // sortIndex = position * 10 (Lücken für künftige Insert-Operationen
    // ohne Full-Reorder).
    order: z.array(z.string().uuid()).min(1).max(100),
  });

  const sectionAssignSchema = z.object({
    fileIds: z.array(z.string().uuid()).min(1).max(500),
  });

  /** Helfer: prüft Ownership der Galerie und gibt die Galerie-ID
   *  zurück. Wenn der User nicht der Owner ist oder die Galerie nicht
   *  im aktuellen Tenant liegt, returnt null (Caller schickt 404). */
  async function findOwnedGallery(req: FastifyRequest, galleryId: string) {
    const s = req.requireAuth();
    return prisma.gallery.findFirst({
      where: { id: galleryId, tenantId: req.tenantId, ownerId: s.user.id },
      select: { id: true },
    });
  }

  // GET /galleries/:id/sections
  app.get<{ Params: { id: string } }>(
    "/galleries/:id/sections",
    async (req, reply) => {
      const gallery = await findOwnedGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const sections = await prisma.gallerySection.findMany({
        where: { galleryId: gallery.id },
        orderBy: { sortIndex: "asc" },
        select: {
          id: true,
          title: true,
          description: true,
          coverFileId: true,
          sortIndex: true,
          _count: { select: { files: true } },
        },
      });
      return {
        sections: sections.map((s) => ({
          id: s.id,
          title: s.title,
          description: s.description,
          coverFileId: s.coverFileId,
          sortIndex: s.sortIndex,
          fileCount: s._count.files,
        })),
      };
    }
  );

  // POST /galleries/:id/sections
  app.post<{ Params: { id: string } }>(
    "/galleries/:id/sections",
    async (req, reply) => {
      const gallery = await findOwnedGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });
      const body = sectionCreateSchema.parse(req.body);

      // coverFileId muss zur selben Galerie gehören (anwendungsseitiger
      // Check, weil das Schema keinen Composite-Constraint hat).
      if (body.coverFileId) {
        const f = await prisma.file.findFirst({
          where: { id: body.coverFileId, galleryId: gallery.id },
          select: { id: true },
        });
        if (!f) return reply.status(400).send({ error: "invalid_cover_file" });
      }

      // sortIndex auf max+10 setzen, damit neue Section ans Ende kommt
      const last = await prisma.gallerySection.findFirst({
        where: { galleryId: gallery.id },
        orderBy: { sortIndex: "desc" },
        select: { sortIndex: true },
      });
      const sortIndex = (last?.sortIndex ?? -10) + 10;

      const section = await prisma.gallerySection.create({
        data: {
          galleryId: gallery.id,
          title: body.title,
          description: body.description ?? null,
          coverFileId: body.coverFileId ?? null,
          sortIndex,
        },
      });
      return { section };
    }
  );

  // PATCH /galleries/:id/sections/:sectionId
  app.patch<{ Params: { id: string; sectionId: string } }>(
    "/galleries/:id/sections/:sectionId",
    async (req, reply) => {
      const gallery = await findOwnedGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });
      const body = sectionUpdateSchema.parse(req.body);

      const section = await prisma.gallerySection.findFirst({
        where: { id: req.params.sectionId, galleryId: gallery.id },
        select: { id: true },
      });
      if (!section) return reply.status(404).send({ error: "not_found" });

      if (body.coverFileId) {
        const f = await prisma.file.findFirst({
          where: { id: body.coverFileId, galleryId: gallery.id },
          select: { id: true },
        });
        if (!f) return reply.status(400).send({ error: "invalid_cover_file" });
      }

      const updated = await prisma.gallerySection.update({
        where: { id: section.id },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.description !== undefined
            ? { description: body.description }
            : {}),
          ...(body.coverFileId !== undefined
            ? { coverFileId: body.coverFileId }
            : {}),
          ...(body.sortIndex !== undefined ? { sortIndex: body.sortIndex } : {}),
        },
      });
      return { section: updated };
    }
  );

  // DELETE /galleries/:id/sections/:sectionId
  app.delete<{ Params: { id: string; sectionId: string } }>(
    "/galleries/:id/sections/:sectionId",
    async (req, reply) => {
      const gallery = await findOwnedGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const section = await prisma.gallerySection.findFirst({
        where: { id: req.params.sectionId, galleryId: gallery.id },
        select: { id: true },
      });
      if (!section) return reply.status(404).send({ error: "not_found" });

      // ON DELETE SET NULL auf files.sectionId — Files fallen
      // automatisch in den Default-Bucket zurück.
      await prisma.gallerySection.delete({ where: { id: section.id } });
      return { ok: true };
    }
  );

  // POST /galleries/:id/sections/reorder
  app.post<{ Params: { id: string } }>(
    "/galleries/:id/sections/reorder",
    async (req, reply) => {
      const gallery = await findOwnedGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });
      const body = sectionReorderSchema.parse(req.body);

      // Alle Sections der Galerie holen und gegen die übergebene Liste
      // matchen. Sections die nicht in der Reorder-Liste stehen, werden
      // ignoriert (kann passieren wenn der Studio-Client veraltete
      // Daten hat).
      const existing = await prisma.gallerySection.findMany({
        where: { galleryId: gallery.id },
        select: { id: true },
      });
      const known = new Set(existing.map((s) => s.id));

      // sortIndex = position * 10 — gibt Lücken für künftige Insertions
      // ohne dass wir alles neu nummerieren müssen.
      const updates = body.order
        .filter((id) => known.has(id))
        .map((id, idx) =>
          prisma.gallerySection.update({
            where: { id },
            data: { sortIndex: idx * 10 },
          })
        );
      await prisma.$transaction(updates);
      return { ok: true };
    }
  );

  // POST /galleries/:id/sections/:sectionId/files — Files in Section assignen
  app.post<{ Params: { id: string; sectionId: string } }>(
    "/galleries/:id/sections/:sectionId/files",
    async (req, reply) => {
      const gallery = await findOwnedGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });
      const body = sectionAssignSchema.parse(req.body);

      const section = await prisma.gallerySection.findFirst({
        where: { id: req.params.sectionId, galleryId: gallery.id },
        select: { id: true },
      });
      if (!section) return reply.status(404).send({ error: "not_found" });

      // updateMany mit Filter auf galleryId — verhindert dass Files
      // anderer Galerien per ID-Manipulation eingehängt werden.
      const res = await prisma.file.updateMany({
        where: {
          id: { in: body.fileIds },
          galleryId: gallery.id,
        },
        data: { sectionId: section.id },
      });
      return { assigned: res.count };
    }
  );

  // DELETE /galleries/:id/sections/files — sectionId der gegebenen Files entfernen
  app.delete<{ Params: { id: string } }>(
    "/galleries/:id/sections/files",
    async (req, reply) => {
      const gallery = await findOwnedGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });
      const body = sectionAssignSchema.parse(req.body);

      const res = await prisma.file.updateMany({
        where: {
          id: { in: body.fileIds },
          galleryId: gallery.id,
        },
        data: { sectionId: null },
      });
      return { removed: res.count };
    }
  );

  // -------------------------------------------------------------------------
  // GET /galleries/:id/stats — Aggregierte Auswertungen für die Studio-UI
  // -------------------------------------------------------------------------
  // Liefert pro Galerie:
  //   - Visit-Counts pro Tag (letzte 30 Tage), basierend auf share.unlock-Events
  //   - Pro-Access-Aufschlüsselung (Visits, Likes, Kommentare)
  //   - Top-Files nach Like-Anzahl
  //   - Download-Aktivität (single + zip getrennt)
  //
  // Bewusst ALLES in eine Route — die UI zeigt die vier Sektionen
  // zusammen, ein Roundtrip statt vier ist freundlicher zum Backend
  // und vermeidet asynchrone UI-Glitches beim Re-Render. Die Queries
  // sind alle leicht (max ~30 Tage, max top-20 Files), insgesamt
  // sub-100ms.
  app.get<{ Params: { id: string } }>(
    "/galleries/:id/stats",
    async (req, reply) => {
      const s = req.requireAuth();
      const gallery = await prisma.gallery.findFirst({
        where: {
          id: req.params.id,
          tenantId: req.tenantId,
          ownerId: s.user.id,
        },
        select: { id: true },
      });
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      // 1) Visits pro Tag (letzte 30 Tage). share.unlock ist der einzige
      //    Event, der zuverlässig pro Visitor pro 8h-Cookie-Window
      //    geloggt wird — also keine künstliche Inflation durch Reloads.
      //
      //    DATE_TRUNC liefert uns Tages-Buckets in der DB-Zeitzone (UTC).
      //    Für die UI tut's das — Datumsanzeige passt der Client an.
      const dailyVisits = await prisma.$queryRaw<
        Array<{ day: Date; count: bigint }>
      >`
        SELECT DATE_TRUNC('day', "createdAt") AS day, COUNT(*)::bigint AS count
        FROM events
        WHERE "tenantId" = ${req.tenantId}::uuid
          AND action = 'share.unlock'
          AND "targetType" = 'gallery'
          AND "targetId" = ${gallery.id}
          AND "createdAt" >= ${since}
        GROUP BY day
        ORDER BY day ASC
      `;

      // 2) Pro-Access-Aufschlüsselung. Anonyme Visitors (actorId=null)
      //    summieren wir in einen einzigen "Anonym"-Bucket — sonst hätte
      //    die UI eine endlose Liste namenloser Zeilen.
      const accesses = await prisma.galleryAccess.findMany({
        where: { galleryId: gallery.id },
        select: {
          id: true,
          label: true,
          finalizedAt: true,
          _count: {
            select: {
              selections: { where: { liked: true } },
              comments: true,
            },
          },
        },
      });

      // Visits pro Access (nochmal über Events, mit actorId-Group)
      const visitsByActor = await prisma.event.groupBy({
        by: ["actorId"],
        where: {
          tenantId: req.tenantId,
          action: "share.unlock",
          targetType: "gallery",
          targetId: gallery.id,
        },
        _count: true,
      });
      const visitsByAccessId = new Map<string, number>();
      let anonymousVisits = 0;
      for (const v of visitsByActor) {
        if (v.actorId) {
          visitsByAccessId.set(v.actorId, v._count);
        } else {
          anonymousVisits += v._count;
        }
      }

      const accessStats = accesses.map((a) => ({
        accessId: a.id,
        label: a.label,
        visits: visitsByAccessId.get(a.id) ?? 0,
        likes: a._count.selections,
        comments: a._count.comments,
        finalized: !!a.finalizedAt,
      }));

      // 3) Top-Files nach Like-Anzahl. Limit 20 — mehr wäre
      //    Schroteffekt-Liste, wenn der Photograph 5000 Files
      //    hochgeladen hat. Die UI bietet ggf. später "alle anzeigen".
      const topFiles = await prisma.selection.groupBy({
        by: ["fileId"],
        where: {
          liked: true,
          file: { galleryId: gallery.id },
        },
        _count: true,
        orderBy: { _count: { fileId: "desc" } },
        take: 20,
      });

      // Filenames für die Top-Files in einer Query nachholen statt N+1
      const topFileIds = topFiles.map((f) => f.fileId);
      const topFileMeta =
        topFileIds.length > 0
          ? await prisma.file.findMany({
              where: { id: { in: topFileIds } },
              select: {
                id: true,
                originalFilename: true,
                kind: true,
              },
            })
          : [];
      const fileMetaById = new Map(topFileMeta.map((f) => [f.id, f]));

      const topLikedFiles = topFiles
        .map((f) => {
          const meta = fileMetaById.get(f.fileId);
          if (!meta) return null;
          return {
            fileId: f.fileId,
            filename: meta.originalFilename,
            kind: meta.kind,
            likes: f._count,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      // 4) Downloads. Wir splitten in zip / single / rendition, weil
      //    das im Studio interessante Sub-Cuts sind (zip = "alle
      //    runtergeladen", single = "ein einzelnes Original",
      //    rendition = "Web-Variante" — letzteres wahrscheinlich
      //    geringer Erkenntnisgewinn, aber zur Vollständigkeit).
      const downloadsByKind = await prisma.downloadLog.groupBy({
        by: ["kind"],
        where: { galleryId: gallery.id },
        _count: true,
      });
      const downloadsTotal = downloadsByKind.reduce(
        (sum, d) => sum + d._count,
        0
      );

      const dailyDownloads = await prisma.$queryRaw<
        Array<{ day: Date; count: bigint }>
      >`
        SELECT DATE_TRUNC('day', "createdAt") AS day, COUNT(*)::bigint AS count
        FROM download_logs
        WHERE "galleryId" = ${gallery.id}::uuid
          AND "createdAt" >= ${since}
        GROUP BY day
        ORDER BY day ASC
      `;

      return {
        // Cast bigint → number; bei den Größenordnungen (max ein paar
        // 1000 visits/day) safe.
        dailyVisits: dailyVisits.map((r) => ({
          day: r.day.toISOString(),
          count: Number(r.count),
        })),
        anonymousVisits,
        accessStats,
        topLikedFiles,
        downloadsByKind: downloadsByKind.map((d) => ({
          kind: d.kind,
          count: d._count,
        })),
        downloadsTotal,
        dailyDownloads: dailyDownloads.map((r) => ({
          day: r.day.toISOString(),
          count: Number(r.count),
        })),
      };
    }
  );

  // -------------------------------------------------------------------------
  // GET /g/:slug — Kunden-Sicht, Meta + Gate-Info
  // -------------------------------------------------------------------------
  // Liefert nur das Minimum: Titel, Branding, ob Passwort/Token nötig.
  // Files kommen erst nach /unlock + gültigem Visitor-Cookie.
  app.get<{
    Params: { slug: string };
    Querystring: { t?: string };
  }>("/g/:slug", async (req, reply) => {
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
        downloadOriginalsEnabled: true,
        watermarkEnabled: true,
        commentsEnabled: true,
        ratingsEnabled: true,
        selectionLimit: true,
        passwordHash: true,
        expiresAt: true,
        tenantId: true,
        brandingId: true,
        // Header-Customization
        heroFileId: true,
        heroUrl: true,
        heroOverlayColor: true,
        heroBackgroundColor: true,
        eventLogoUrl: true,
        welcomeMarkdown: true,
        heroLayout: true,
        footerMarkdown: true,
        colorBackground: true,
        colorAccent: true,
        fontHeading: true,
        fontBody: true,
        gridLayout: true,
        slideshowTransition: true,
        slideshowAudioUrl: true,
        tenant: { select: { status: true } },
      },
    });
    if (!gallery || gallery.status !== "live") {
      return reply.status(404).send({ error: "not_found" });
    }
    if (gallery.tenant.status !== "active") {
      return reply
        .status(503)
        .send({ error: "tenant_unavailable" });
    }
    if (gallery.expiresAt && gallery.expiresAt < new Date()) {
      return reply.status(410).send({ error: "expired" });
    }

    // Prüfen, ob das Visitor-Cookie schon gesetzt ist (auto-unlock bei
    // erneutem Aufruf)
    const cookieName = visitorCookieName(gallery.id);
    const cookie = req.cookies?.[cookieName];
    let unlocked = false;
    if (cookie) {
      const claims = verifyVisitorToken(cookie);
      if (
        claims &&
        claims.gid === gallery.id &&
        (!gallery.passwordHash || claims.pw)
      ) {
        unlocked = true;
      }
    }

    const branding = await resolveGalleryBranding({
      galleryBrandingId: gallery.brandingId,
      tenantId: gallery.tenantId,
    });

    // Hero-File auflösen: wenn heroFileId gesetzt, geben wir einen
    // Presigned-URL zur Web-Rendition zurück. Bevorzugt web_jpeg
    // (kunden-freundliches Format), fallback web (webp).
    let heroFileUrl: string | null = null;
    if (gallery.heroFileId) {
      const heroFile = await prisma.file.findFirst({
        where: { id: gallery.heroFileId, galleryId: gallery.id },
        select: {
          id: true,
          renditions: {
            where: { kind: { in: ["web_jpeg", "web"] } },
            select: { kind: true, storageKey: true },
          },
        },
      });
      if (heroFile && heroFile.renditions.length > 0) {
        // web_jpeg zuerst, sonst web. Beide werden hier akzeptiert,
        // damit Galerien aus der Zeit vor web_jpeg auch funktionieren.
        const r =
          heroFile.renditions.find((x) => x.kind === "web_jpeg") ??
          heroFile.renditions[0];
        heroFileUrl = await presignGet({ key: r.storageKey });
      }
    }

    // Asset-URLs für Hero-Upload und Logo: voller API-Pfad inkl.
    // /api/v1/-Prefix, damit Frontend (das den Wert direkt in <img src>
    // setzt) ohne weitere URL-Manipulation lädt. Wir verwenden den
    // gleichen Same-Origin-Pfad wie Frontend-fetch — kein NEXT_PUBLIC-
    // Resolving nötig.
    //
    // Cache-Buster (?v=<hash>): die Asset-Route schickt
    // Cache-Control: max-age=300, weil mehrfaches Aufrufen des
    // gleichen Hero/Logo nicht jedes Mal eine neue Signatur braucht.
    // Aber: wenn das Studio einen NEUEN Hero hochlädt, ändert sich
    // der Storage-Key. Damit der Customer-Browser nicht 5 Minuten
    // das alte Bild aus seinem Cache zeigt, hängen wir einen kurzen
    // Hash des Storage-Keys an die URL — wechselt der Key, wechselt
    // der URL, und der Browser holt das neue Bild sofort.
    const cacheBust = (key: string) =>
      "?v=" + createHash("sha1").update(key).digest("hex").slice(0, 8);
    const heroUploadUrl = gallery.heroUrl
      ? `/api/v1/g/${gallery.slug}/assets/hero${cacheBust(gallery.heroUrl)}`
      : null;
    const eventLogoPublicUrl = gallery.eventLogoUrl
      ? `/api/v1/g/${gallery.slug}/assets/logo${cacheBust(gallery.eventLogoUrl)}`
      : null;
    const slideshowAudioPublicUrl = gallery.slideshowAudioUrl
      ? `/api/v1/g/${gallery.slug}/assets/audio${cacheBust(gallery.slideshowAudioUrl)}`
      : null;

    // Sections (Kapitel) der Galerie. Wenn keine Sections angelegt
    // sind, returnen wir ein leeres Array — das Frontend rendert
    // dann den klassischen Hauptraster-Modus. Cover-File-Thumb wird
    // mit signiertem URL durchgereicht, damit das Customer-View
    // Section-Header mit Bildern rendern kann.
    const sectionRows = await prisma.gallerySection.findMany({
      where: { galleryId: gallery.id },
      orderBy: { sortIndex: "asc" },
      select: {
        id: true,
        title: true,
        description: true,
        coverFileId: true,
        sortIndex: true,
      },
    });
    // Cover-Thumb-URLs für alle Cover-File-IDs vorab in einer
    // Query holen, dann pro Section zuordnen — vermeidet N+1.
    const coverFileIds = sectionRows
      .map((s) => s.coverFileId)
      .filter((id): id is string => !!id);
    let coverThumbByFileId = new Map<string, string>();
    if (coverFileIds.length > 0) {
      const covers = await prisma.file.findMany({
        where: { id: { in: coverFileIds }, galleryId: gallery.id },
        select: {
          id: true,
          renditions: {
            where: { kind: "thumb" },
            select: { storageKey: true },
            take: 1,
          },
        },
      });
      for (const c of covers) {
        const thumb = c.renditions[0];
        if (thumb) {
          coverThumbByFileId.set(
            c.id,
            await presignGet({ key: thumb.storageKey })
          );
        }
      }
    }
    const sections = sectionRows.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      coverThumbUrl: s.coverFileId
        ? coverThumbByFileId.get(s.coverFileId) ?? null
        : null,
      sortIndex: s.sortIndex,
    }));

    return {
      gallery: {
        id: gallery.id,
        slug: gallery.slug,
        title: gallery.title,
        description: gallery.description,
        mode: gallery.mode,
        downloadEnabled: gallery.downloadEnabled,
        downloadOriginalsEnabled: gallery.downloadOriginalsEnabled,
        watermarkEnabled: gallery.watermarkEnabled,
        commentsEnabled: gallery.commentsEnabled,
        ratingsEnabled: gallery.ratingsEnabled,
        selectionLimit: gallery.selectionLimit,
        requiresPassword: !!gallery.passwordHash,
        unlocked,
        branding,
        // Header-Customization durchreichen
        header: {
          // Render-Variante: minimal | splash | side_by_side | centered
          layout: gallery.heroLayout,
          // heroImageUrl: relativer URL zum Bild (entweder File-Rendition
          // oder Upload-Asset) — Frontend baut mit api-base zusammen.
          heroImageUrl: heroFileUrl ?? heroUploadUrl,
          overlayColor: gallery.heroOverlayColor,
          backgroundColor: gallery.heroBackgroundColor,
          eventLogoUrl: eventLogoPublicUrl,
          welcomeMarkdown: gallery.welcomeMarkdown,
        },
        // Footer + Galerie-Farben überschreiben Branding-Werte nur
        // für diese Galerie. null bedeutet "kein Override → Branding
        // gewinnt".
        footerMarkdown: gallery.footerMarkdown,
        colors: {
          background: gallery.colorBackground,
          accent: gallery.colorAccent,
        },
        fonts: {
          heading: gallery.fontHeading,
          body: gallery.fontBody,
        },
        gridLayout: gallery.gridLayout,
        slideshowTransition: gallery.slideshowTransition,
        slideshowAudioUrl: slideshowAudioPublicUrl,
        sections,
      },
    };
  });

  // -------------------------------------------------------------------------
  // POST /g/:slug/unlock — Passwort/Token einlösen
  // -------------------------------------------------------------------------
  app.post<{
    Params: { slug: string };
    Body: { password?: string; token?: string };
  }>(
    "/g/:slug/unlock",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const body = unlockSchema.parse(req.body);
      const gallery = await prisma.gallery.findUnique({
        where: { slug: req.params.slug },
        select: {
          id: true,
          tenantId: true,
          status: true,
          expiresAt: true,
          passwordHash: true,
        },
      });
      if (!gallery || gallery.status !== "live") {
        return reply.status(404).send({ error: "not_found" });
      }
      if (gallery.expiresAt && gallery.expiresAt < new Date()) {
        return reply.status(410).send({ error: "expired" });
      }

      // Passwort prüfen, falls nötig
      let passwordOk = !gallery.passwordHash;
      if (gallery.passwordHash) {
        if (!body.password) {
          return reply
            .status(401)
            .send({ error: "password_required" });
        }
        passwordOk = await verifyPassword(
          gallery.passwordHash,
          body.password
        );
        if (!passwordOk) {
          await logEvent({
            tenantId: gallery.tenantId,
            actorType: "system",
            action: "share.unlock.failed",
            targetType: "gallery",
            targetId: gallery.id,
            payload: { reason: "bad_password" },
            ipAddress: req.ip,
          });
          return reply
            .status(401)
            .send({ error: "invalid_password" });
        }
      }

      // Token validieren, falls geliefert
      let accessId: string | null = null;
      if (body.token) {
        const access = await prisma.galleryAccess.findUnique({
          where: { token: body.token },
          select: {
            id: true,
            galleryId: true,
            expiresAt: true,
          },
        });
        if (
          access &&
          access.galleryId === gallery.id &&
          (!access.expiresAt || access.expiresAt > new Date())
        ) {
          accessId = access.id;
          // Audit-Count + last-access aktualisieren
          await prisma.galleryAccess
            .update({
              where: { id: access.id },
              data: {
                lastAccessAt: new Date(),
                accessCount: { increment: 1 },
              },
            })
            .catch(() => {});
        }
        // Ungültiger Token → kein Fehler, einfach als anonym behandeln.
        // Das verhindert Token-Enumeration: jeder Token-Versuch sieht aus
        // wie ein normaler Visitor-Aufruf.
      }

      // Visitor-Cookie setzen
      const token = createVisitorToken({
        gid: gallery.id,
        aid: accessId,
        pw: passwordOk,
      });
      reply.setCookie(visitorCookieName(gallery.id), token, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: req.protocol === "https",
        maxAge: 8 * 60 * 60, // 8h
      });

      await logEvent({
        tenantId: gallery.tenantId,
        actorType: accessId ? "access" : "system",
        actorId: accessId,
        action: "share.unlock",
        targetType: "gallery",
        targetId: gallery.id,
        payload: { hasAccessToken: !!accessId, hasPassword: !!gallery.passwordHash },
        ipAddress: req.ip,
      });

      return { ok: true, hasAccessToken: !!accessId };
    }
  );

  // -------------------------------------------------------------------------
  // GET /g/:slug/files — Files mit signierten Preview-URLs
  // -------------------------------------------------------------------------
  app.get<{ Params: { slug: string } }>(
    "/g/:slug/files",
    async (req, reply) => {
      const visitor = await loadVisitor(req);
      if (!visitor) {
        return reply
          .status(401)
          .send({ error: "unlock_required" });
      }

      const files = await prisma.file.findMany({
        where: {
          galleryId: visitor.galleryId,
          status: "ready",
        },
        orderBy: { sortIndex: "asc" },
        select: {
          id: true,
          originalFilename: true,
          mimeType: true,
          sizeBytes: true,
          kind: true,
          width: true,
          height: true,
          sortIndex: true,
          sectionId: true,
          renditions: {
            select: {
              kind: true,
              storageKey: true,
              width: true,
              height: true,
              metadata: true,
            },
          },
        },
      });

      const galleryRow = await prisma.gallery.findUnique({
        where: { id: visitor.galleryId },
        select: {
          watermarkEnabled: true,
          downloadEnabled: true,
        },
      });
      // Watermark wird ausgeliefert, wenn watermarkEnabled UND der Kunde
      // sowieso keinen Download bekommt (sonst hätten sie das Original).
      const useWatermark =
        !!galleryRow?.watermarkEnabled && !galleryRow?.downloadEnabled;

      // Signed URLs für thumb + preview + web. Wenn Watermark aktiv ist
      // und eine watermarked-Rendition existiert, ersetzen wir die
      // preview-/web-URLs durch deren signierten Pfad.
      const items = await Promise.all(
        files.map(async (f) => {
          const thumb = f.renditions.find((r) => r.kind === "thumb");
          const preview = f.renditions.find((r) => r.kind === "preview");
          const web = f.renditions.find((r) => r.kind === "web");
          const watermarked = f.renditions.find((r) => r.kind === "watermarked");
          const hls = f.renditions.find((r) => r.kind === "hls");
          const sprite = f.renditions.find((r) => r.kind === "sprite");

          const hlsUrl = hls
            ? `/api/v1/g/${req.params.slug}/files/${f.id}/hls/master.m3u8`
            : null;

          // Lightbox-Quelle: watermarked > web > preview
          const lightboxRendition =
            useWatermark && watermarked ? watermarked : web ?? preview;
          const previewRendition =
            useWatermark && watermarked ? watermarked : preview;

          // Sprite-Sheet zum Scrubbing — nur bei Videos, nur wenn der
          // Worker das tatsächlich erstellt hat (kurze Videos haben keins).
          const spritePayload =
            f.kind === "video" && sprite && sprite.metadata
              ? {
                  url: await presignGet({ key: sprite.storageKey }),
                  ...(sprite.metadata as {
                    interval: number;
                    cols: number;
                    rows: number;
                    tileWidth: number;
                    tileHeight: number;
                    frames: number;
                  }),
                }
              : null;

          return {
            id: f.id,
            filename: f.originalFilename,
            mimeType: f.mimeType,
            sizeBytes: Number(f.sizeBytes),
            kind: f.kind,
            width: f.width,
            height: f.height,
            sectionId: f.sectionId,
            thumbUrl: thumb
              ? await presignGet({ key: thumb.storageKey })
              : null,
            previewUrl: previewRendition
              ? await presignGet({ key: previewRendition.storageKey })
              : null,
            webUrl: lightboxRendition
              ? await presignGet({ key: lightboxRendition.storageKey })
              : null,
            hlsUrl,
            sprite: spritePayload,
            previewWidth: preview?.width ?? null,
            previewHeight: preview?.height ?? null,
          };
        })
      );

      // Auswahl + Kommentare des aktuellen Visitors mitliefern, damit
      // das Frontend den State direkt anzeigen kann (Like, Color, Rating).
      let mySelections: Record<
        string,
        { color: string | null; rating: number | null; liked: boolean }
      > = {};
      let finalizedAt: Date | null = null;
      // canSelect signalisiert dem Frontend, ob es Auswahl-UI überhaupt
      // anzeigen soll. False für anonyme Visitor (kein Access-Token) oder
      // wenn der Access-Token zwar gültig, aber `canSelect=false` im
      // GalleryAccess-Eintrag gesetzt ist (z.B. nur-Anschauen-Link). Ohne
      // dieses Flag wäre ein Like-Klick eine 403-Falle und der Kunde
      // wüsste nicht warum nichts gespeichert wird — siehe Bugreport
      // "Markierungen verschwinden nach Reload".
      let canSelect = false;
      if (visitor.accessId) {
        const selections = await prisma.selection.findMany({
          where: { accessId: visitor.accessId },
          select: { fileId: true, color: true, rating: true, liked: true },
        });
        mySelections = Object.fromEntries(
          selections.map((s) => [
            s.fileId,
            { color: s.color, rating: s.rating, liked: s.liked },
          ])
        );
        const access = await prisma.galleryAccess.findUnique({
          where: { id: visitor.accessId },
          select: { finalizedAt: true, canSelect: true },
        });
        finalizedAt = access?.finalizedAt ?? null;
        canSelect = access?.canSelect ?? false;
      }

      return { files: items, mySelections, finalizedAt, canSelect };
    }
  );

  // -------------------------------------------------------------------------
  // GET /g/:slug/files/:fileId/download?variant=original|web
  // -------------------------------------------------------------------------
  // Kunden-Download eines einzelnen Files. Variant entscheidet, ob das
  // Original oder die Web-Rendition (2560px webp) ausgeliefert wird.
  // Default "original" wegen Rückwärtskompatibilität — alter UI-Code
  // ohne ?variant-Param funktioniert weiter, sofern downloadOriginalsEnabled.
  app.get<{
    Params: { slug: string; fileId: string };
    Querystring: { variant?: string };
  }>(
    "/g/:slug/files/:fileId/download",
    async (req, reply) => {
      const visitor = await loadVisitor(req);
      if (!visitor) {
        return reply
          .status(401)
          .send({ error: "unlock_required" });
      }

      const gallery = await prisma.gallery.findUnique({
        where: { id: visitor.galleryId },
        select: {
          id: true,
          downloadEnabled: true,
          downloadOriginalsEnabled: true,
          tenantId: true,
        },
      });
      if (!gallery || !gallery.downloadEnabled) {
        return reply.status(403).send({ error: "downloads_disabled" });
      }

      const variant: "original" | "web" =
        req.query.variant === "web" ? "web" : "original";
      if (variant === "original" && !gallery.downloadOriginalsEnabled) {
        return reply.status(403).send({ error: "originals_disabled" });
      }

      const file = await prisma.file.findFirst({
        where: { id: req.params.fileId, galleryId: gallery.id },
        select: {
          id: true,
          storageKey: true,
          originalFilename: true,
          sizeBytes: true,
          renditions: {
            // Beide Web-Renditions kommen mit; wir wählen unten web_jpeg
            // bevorzugt, web als Fallback für Altbestand.
            where: { kind: { in: ["web_jpeg", "web"] } },
            select: { kind: true, storageKey: true, format: true },
          },
        },
      });
      if (!file) return reply.status(404).send({ error: "not_found" });

      // Storage-Key + Dateiname je nach Variant. Bei "web" hängen wir
      // _web ans Filename und passen die Extension an das gelieferte
      // Format an — damit klar ist, was der Kunde bekommt, und damit
      // es nicht die Original-Datei im Download-Ordner überschreibt,
      // wenn er beide herunterlädt.
      let storageKey = file.storageKey;
      let downloadFilename = file.originalFilename;
      let bytes: bigint | null = file.sizeBytes;

      if (variant === "web") {
        // Bevorzuge web_jpeg vor web — Kunden öffnen JPEG überall,
        // webp nur in modernen Browsern und macOS Preview.
        const webJpeg = file.renditions.find((r) => r.kind === "web_jpeg");
        const webWebp = file.renditions.find((r) => r.kind === "web");
        const chosen = webJpeg ?? webWebp;
        if (!chosen) {
          if (gallery.downloadOriginalsEnabled) {
            // implizit auf Original umschalten, kein Fehler
          } else {
            return reply
              .status(404)
              .send({ error: "web_rendition_unavailable" });
          }
        } else {
          storageKey = chosen.storageKey;
          const dotIdx = downloadFilename.lastIndexOf(".");
          const stem =
            dotIdx > 0 ? downloadFilename.slice(0, dotIdx) : downloadFilename;
          const ext = chosen.format === "jpg" ? "jpg" : "webp";
          downloadFilename = `${stem}_web.${ext}`;
          bytes = null; // Größe der Rendition kennen wir hier nicht ohne extra Query
        }
      }

      const url = await presignGet({
        key: storageKey,
        responseContentDisposition: `attachment; filename="${encodeURIComponent(
          downloadFilename
        )}"`,
      });

      // Audit — wir loggen den Variant nicht extra (würde DownloadLog-Schema
      // erweitern); kind=single bleibt wie bisher
      await prisma.downloadLog
        .create({
          data: {
            galleryId: gallery.id,
            fileId: file.id,
            kind: "single",
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]?.slice(0, 500) ?? null,
            bytes,
          },
        })
        .catch(() => {});

      return reply.redirect(url);
    }
  );

  // ---------------------------------------------------------------------------
  // POST /galleries/:id/assets/presign — Logo / Hero-Upload vorbereiten
  // ---------------------------------------------------------------------------
  // Studio-Client uploadet Header-Assets (Event-Logo, Hero-Bild) UND
  // optional Slideshow-Musik direkt zu S3. Diese Route gibt eine
  // kurzlebige PUT-URL zurück und den späteren Storage-Key, den der
  // Client beim PATCH der Galerie als eventLogoUrl/heroUrl/
  // slideshowAudioUrl einträgt.
  //
  // Limits:
  //   logo, hero  → image/*, max 10 MB
  //   audio       → audio/*, max 30 MB (3-5 min MP3 ist meist <10 MB,
  //                 längere Tracks knapp drüber)
  app.post<{
    Params: { id: string };
    Body: {
      kind: "logo" | "hero" | "audio";
      contentType: string;
      contentLength?: number;
    };
  }>("/galleries/:id/assets/presign", async (req, reply) => {
    const s = req.requireAuth();

    const schema = z.object({
      kind: z.enum(["logo", "hero", "audio"]),
      contentType: z.string().min(1).max(100),
      contentLength: z.number().int().positive().optional(),
    });
    const body = schema.parse(req.body);

    // Pro Asset-Kind separate Validation. Wir machen das hier statt
    // im zod-Schema, damit die Fehlermeldung passt ("audio darf bis
    // 30 MB" vs "image bis 10 MB").
    if (body.kind === "audio") {
      if (!/^audio\//.test(body.contentType)) {
        return reply.status(400).send({ error: "must be audio/*" });
      }
      if (body.contentLength && body.contentLength > 30 * 1024 * 1024) {
        return reply.status(400).send({ error: "audio too large (max 30 MB)" });
      }
    } else {
      if (!/^image\//.test(body.contentType)) {
        return reply.status(400).send({ error: "must be image/*" });
      }
      if (body.contentLength && body.contentLength > 10 * 1024 * 1024) {
        return reply.status(400).send({ error: "image too large (max 10 MB)" });
      }
    }

    const gallery = await prisma.gallery.findFirst({
      where: {
        id: req.params.id,
        tenantId: req.tenantId,
        ownerId: s.user.id,
      },
      select: { id: true, tenantId: true },
    });
    if (!gallery) return reply.status(404).send({ error: "not_found" });

    // Storage-Key-Schema:
    //   t/<tenant>/galleries/<gallery>/assets/<kind>-<rand>.<ext>
    // Die Random-Komponente verhindert Browser-Cache-Probleme nach
    // Re-Upload (alte URL ist tot, neue lebt — kein "alter Cache zeigt
    // altes Logo"-Effekt).
    const ext = body.contentType.split("/")[1]?.split("+")[0] ?? "bin";
    const rand = randomBytes(8).toString("hex");
    const storageKey = `t/${gallery.tenantId}/galleries/${gallery.id}/assets/${body.kind}-${rand}.${ext}`;

    const uploadUrl = await presignPut({
      key: storageKey,
      contentType: body.contentType,
      contentLength: body.contentLength,
      ttlSeconds: 900, // 15 Minuten
    });

    return {
      uploadUrl,
      storageKey,
    };
  });

  // ---------------------------------------------------------------------------
  // GET /g/:slug/assets/:kind — Customer-Asset abrufen (Logo / Hero-Upload)
  // ---------------------------------------------------------------------------
  // Public-Endpoint für Header-Assets, die NICHT aus der File-Tabelle
  // kommen (also: Event-Logo + Hero-Upload). Hero-aus-Galerie nutzt
  // weiter den File-Rendition-Pfad.
  //
  // Liefert einen Redirect auf eine kurzlebige Presigned-GET-URL. Wir
  // signieren nicht den storageKey direkt zum Public-Cache, damit
  // wir später Asset-Caching/CDN dazwischenschalten können ohne die
  // Customer-URLs zu ändern.
  app.get<{ Params: { slug: string; kind: "logo" | "hero" | "audio" } }>(
    "/g/:slug/assets/:kind",
    async (req, reply) => {
      const gallery = await prisma.gallery.findUnique({
        where: { slug: req.params.slug },
        select: {
          status: true,
          eventLogoUrl: true,
          heroUrl: true,
          slideshowAudioUrl: true,
          tenant: { select: { status: true } },
        },
      });
      if (!gallery || gallery.status !== "live") {
        return reply.status(404).send({ error: "not_found" });
      }
      if (gallery.tenant.status !== "active") {
        return reply.status(503).send({ error: "tenant_unavailable" });
      }

      const key =
        req.params.kind === "logo"
          ? gallery.eventLogoUrl
          : req.params.kind === "hero"
          ? gallery.heroUrl
          : req.params.kind === "audio"
          ? gallery.slideshowAudioUrl
          : null;
      if (!key) return reply.status(404).send({ error: "not_set" });

      // Wenn ein absoluter URL drinsteht (z.B. CDN), direkt durchreichen.
      // Sonst S3-Key → presignen.
      if (/^https?:\/\//.test(key)) {
        return reply.redirect(key);
      }

      const url = await presignGet({
        key,
        ttlSeconds: 60 * 15, // 15 Min reicht für Page-Load + Asset-Time
      });
      // Browser-Cache: Asset ändert sich selten, also 5 Min cachen lassen.
      // Nicht länger weil Presigned-URLs nach 15 Min eh tot sind.
      reply.header("Cache-Control", "private, max-age=300");
      return reply.redirect(url);
    }
  );
}
