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

import { prisma } from "../db.js";
import { generateGallerySlug } from "../services/ids.js";
import { presignGet } from "../services/storage.js";
import { verifyPassword } from "../services/auth.js";
import { enqueue, Queues } from "../services/queue.js";
import {
  createVisitorToken,
  verifyVisitorToken,
  visitorCookieName,
} from "../services/visitor.js";

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
        select: { id: true, watermarkEnabled: true },
      });
      if (!existing) return reply.status(404).send({ error: "not_found" });

      const turningOnWatermark =
        body.watermarkEnabled === true && !existing.watermarkEnabled;

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
        // Hinweis: ob ein Token nötig ist, sagen wir nicht hier — der Token
        // ist optional. Wenn ein Kunde keinen hat, läuft er als anonymer
        // Besucher (keine Selektionen/Kommentare). Studio kann auch
        // entscheiden, ohne Token zu teilen.
        unlocked,
        branding: gallery.branding,
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
          renditions: {
            select: { kind: true, storageKey: true, width: true, height: true },
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

          const hlsUrl = hls
            ? `/api/v1/g/${req.params.slug}/files/${f.id}/hls/master.m3u8`
            : null;

          // Lightbox-Quelle: watermarked > web > preview
          const lightboxRendition =
            useWatermark && watermarked ? watermarked : web ?? preview;
          const previewRendition =
            useWatermark && watermarked ? watermarked : preview;

          return {
            id: f.id,
            filename: f.originalFilename,
            mimeType: f.mimeType,
            sizeBytes: Number(f.sizeBytes),
            kind: f.kind,
            width: f.width,
            height: f.height,
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
      }

      return { files: items, mySelections };
    }
  );

  // -------------------------------------------------------------------------
  // GET /g/:slug/files/:fileId/download — Original-Download für Kunden
  // -------------------------------------------------------------------------
  app.get<{ Params: { slug: string; fileId: string } }>(
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
        select: { id: true, downloadEnabled: true, tenantId: true },
      });
      if (!gallery || !gallery.downloadEnabled) {
        return reply.status(403).send({ error: "downloads_disabled" });
      }

      const file = await prisma.file.findFirst({
        where: { id: req.params.fileId, galleryId: gallery.id },
        select: {
          id: true,
          storageKey: true,
          originalFilename: true,
          sizeBytes: true,
        },
      });
      if (!file) return reply.status(404).send({ error: "not_found" });

      const url = await presignGet({
        key: file.storageKey,
        responseContentDisposition: `attachment; filename="${encodeURIComponent(
          file.originalFilename
        )}"`,
      });

      // Audit
      await prisma.downloadLog
        .create({
          data: {
            galleryId: gallery.id,
            fileId: file.id,
            kind: "single",
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]?.slice(0, 500) ?? null,
            bytes: file.sizeBytes,
          },
        })
        .catch(() => {});

      return reply.redirect(url);
    }
  );
}
