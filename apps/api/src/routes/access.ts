/**
 * Lumio API — Gallery Access (Share Links)
 *
 * Studio-seitig (mit Auth):
 *   GET    /galleries/:id/access          — Liste der Share-Links einer Galerie
 *   POST   /galleries/:id/access          — neuen Link anlegen
 *   PATCH  /galleries/:id/access/:accessId — Berechtigungen ändern
 *   DELETE /galleries/:id/access/:accessId — Link widerrufen
 *
 * Optional: Galerie-Passwort setzen/entfernen (separater Endpoint, weil
 * das ein Hash-Operation ist).
 *   PUT    /galleries/:id/password        — Passwort setzen
 *   DELETE /galleries/:id/password        — Passwort entfernen
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { generateAccessToken } from "../services/ids.js";
import { hashPassword } from "../services/auth.js";
import { logEvent } from "../services/audit.js";
import { sendGalleryInvitation } from "../services/notifier.js";

const createAccessSchema = z.object({
  label: z.string().min(1).max(100),
  email: z.string().email().optional(),
  canDownload: z.boolean().default(true),
  canComment: z.boolean().default(true),
  canSelect: z.boolean().default(true),
  canSeeOthers: z.boolean().default(false),
  expiresAt: z.string().datetime().optional(),
  /** Wenn true UND eine email gesetzt ist: direkt nach dem Anlegen
   *  eine Einladungs-Mail an die Adresse schicken. Default false,
   *  damit das alte Verhalten (nur Link, kein Versand) erhalten
   *  bleibt. */
  sendInvitation: z.boolean().default(false),
  /** Optionale persoenliche Nachricht in der Einladung. Wird ueber
   *  den Standard-Begruessungstext gesetzt. Max 1000 Zeichen damit
   *  die Mail nicht ausartet. */
  personalMessage: z.string().max(1000).optional(),
});

// PATCH-Schema: explizit ohne sendInvitation/personalMessage — bei
// einer Aenderung sollen NICHT automatisch Mails rausgehen. Wer eine
// Einladung neu schicken will, nutzt POST /access/:id/invite.
const updateAccessSchema = z
  .object({
    label: z.string().min(1).max(100),
    email: z.string().email(),
    canDownload: z.boolean(),
    canComment: z.boolean(),
    canSelect: z.boolean(),
    canSeeOthers: z.boolean(),
    expiresAt: z.string().datetime(),
  })
  .partial();

// Schema fuer den (Re-)Send-Endpoint — nur personalMessage als Option.
const invitationSchema = z.object({
  personalMessage: z.string().max(1000).optional(),
});

const setPasswordSchema = z.object({
  password: z.string().min(4).max(200),
});

async function loadOwnedGallery(req: {
  tenantId: string;
  session: { user: { id: string } } | null;
}, galleryId: string) {
  if (!req.session) return null;
  return prisma.gallery.findFirst({
    where: {
      id: galleryId,
      tenantId: req.tenantId,
      ownerId: req.session.user.id,
    },
    select: { id: true, slug: true },
  });
}

export async function registerAccessRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // GET /galleries/:id/access
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    "/galleries/:id/access",
    async (req, reply) => {
      req.requireAuth();
      const gallery = await loadOwnedGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const accesses = await prisma.galleryAccess.findMany({
        where: { galleryId: gallery.id },
        orderBy: { createdAt: "desc" },
      });
      return {
        accesses: accesses.map((a) => ({
          id: a.id,
          label: a.label,
          email: a.email,
          token: a.token,
          canDownload: a.canDownload,
          canComment: a.canComment,
          canSelect: a.canSelect,
          canSeeOthers: a.canSeeOthers,
          expiresAt: a.expiresAt,
          lastAccessAt: a.lastAccessAt,
          accessCount: a.accessCount,
          createdAt: a.createdAt,
        })),
      };
    }
  );

  // -------------------------------------------------------------------------
  // POST /galleries/:id/access
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/galleries/:id/access",
    async (req, reply) => {
      const s = req.requireAuth();
      const gallery = await loadOwnedGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const body = createAccessSchema.parse(req.body);
      const access = await prisma.galleryAccess.create({
        data: {
          galleryId: gallery.id,
          token: generateAccessToken(),
          label: body.label,
          email: body.email ?? null,
          canDownload: body.canDownload,
          canComment: body.canComment,
          canSelect: body.canSelect,
          canSeeOthers: body.canSeeOthers,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        },
      });

      await logEvent({
        tenantId: req.tenantId,
        actorType: "user",
        actorId: s.user.id,
        action: "share.create",
        targetType: "gallery_access",
        targetId: access.id,
        payload: { galleryId: gallery.id, label: body.label },
        ipAddress: req.ip,
      });

      // Einladungs-Mail: nur wenn explizit angefordert UND eine email
      // gesetzt ist. Fire-and-forget — das Response darf nicht auf SMTP
      // warten (3-5s Latenz waeren UX-Killer).
      let invitationSent = false;
      if (body.sendInvitation && body.email) {
        invitationSent = await sendGalleryInvitation({
          accessId: access.id,
          personalMessage: body.personalMessage,
        });
        if (invitationSent) {
          await logEvent({
            tenantId: req.tenantId,
            actorType: "user",
            actorId: s.user.id,
            action: "share.invite",
            targetType: "gallery_access",
            targetId: access.id,
            payload: { galleryId: gallery.id, email: body.email },
            ipAddress: req.ip,
          });
        }
      }

      return reply.status(201).send({
        access: {
          id: access.id,
          label: access.label,
          token: access.token,
          email: access.email,
          canDownload: access.canDownload,
          canComment: access.canComment,
          canSelect: access.canSelect,
          canSeeOthers: access.canSeeOthers,
          expiresAt: access.expiresAt,
          createdAt: access.createdAt,
        },
        invitationSent,
      });
    }
  );

  // -------------------------------------------------------------------------
  // PATCH /galleries/:id/access/:accessId
  // -------------------------------------------------------------------------
  app.patch<{ Params: { id: string; accessId: string } }>(
    "/galleries/:id/access/:accessId",
    async (req, reply) => {
      req.requireAuth();
      const gallery = await loadOwnedGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const access = await prisma.galleryAccess.findFirst({
        where: { id: req.params.accessId, galleryId: gallery.id },
        select: { id: true },
      });
      if (!access) return reply.status(404).send({ error: "not_found" });

      const body = updateAccessSchema.parse(req.body);
      const updated = await prisma.galleryAccess.update({
        where: { id: access.id },
        data: {
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.email !== undefined ? { email: body.email } : {}),
          ...(body.canDownload !== undefined
            ? { canDownload: body.canDownload }
            : {}),
          ...(body.canComment !== undefined
            ? { canComment: body.canComment }
            : {}),
          ...(body.canSelect !== undefined
            ? { canSelect: body.canSelect }
            : {}),
          ...(body.canSeeOthers !== undefined
            ? { canSeeOthers: body.canSeeOthers }
            : {}),
          ...(body.expiresAt !== undefined
            ? {
                expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
              }
            : {}),
        },
      });
      return { access: updated };
    }
  );

  // -------------------------------------------------------------------------
  // DELETE /galleries/:id/access/:accessId
  // -------------------------------------------------------------------------
  app.delete<{ Params: { id: string; accessId: string } }>(
    "/galleries/:id/access/:accessId",
    async (req, reply) => {
      const s = req.requireAuth();
      const gallery = await loadOwnedGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      await prisma.galleryAccess.deleteMany({
        where: { id: req.params.accessId, galleryId: gallery.id },
      });
      await logEvent({
        tenantId: req.tenantId,
        actorType: "user",
        actorId: s.user.id,
        action: "share.delete",
        targetType: "gallery_access",
        targetId: req.params.accessId,
        payload: { galleryId: gallery.id },
        ipAddress: req.ip,
      });
      return reply.status(204).send();
    }
  );

  // -------------------------------------------------------------------------
  // POST /galleries/:id/access/:accessId/invite
  // Einladung (erneut) verschicken — z.B. wenn der Empfaenger die erste
  // Mail nicht bekommen hat oder eine persoenliche Notiz nachgereicht
  // werden soll.
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string; accessId: string } }>(
    "/galleries/:id/access/:accessId/invite",
    async (req, reply) => {
      const s = req.requireAuth();
      const gallery = await loadOwnedGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const access = await prisma.galleryAccess.findFirst({
        where: { id: req.params.accessId, galleryId: gallery.id },
        select: { id: true, email: true },
      });
      if (!access) return reply.status(404).send({ error: "not_found" });
      if (!access.email)
        return reply
          .status(400)
          .send({ error: "no_email", message: "Auf diesem Link ist keine E-Mail hinterlegt." });

      const body = invitationSchema.parse(req.body ?? {});

      const sent = await sendGalleryInvitation({
        accessId: access.id,
        personalMessage: body.personalMessage,
      });

      if (sent) {
        await logEvent({
          tenantId: req.tenantId,
          actorType: "user",
          actorId: s.user.id,
          action: "share.invite",
          targetType: "gallery_access",
          targetId: access.id,
          payload: { galleryId: gallery.id, email: access.email, resend: true },
          ipAddress: req.ip,
        });
      }

      return { sent };
    }
  );

  // -------------------------------------------------------------------------
  // PUT /galleries/:id/password
  // -------------------------------------------------------------------------
  app.put<{ Params: { id: string } }>(
    "/galleries/:id/password",
    async (req, reply) => {
      req.requireAuth();
      const gallery = await loadOwnedGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const body = setPasswordSchema.parse(req.body);
      const passwordHash = await hashPassword(body.password);
      await prisma.gallery.update({
        where: { id: gallery.id },
        data: { passwordHash },
      });
      return { ok: true };
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/galleries/:id/password",
    async (req, reply) => {
      req.requireAuth();
      const gallery = await loadOwnedGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      await prisma.gallery.update({
        where: { id: gallery.id },
        data: { passwordHash: null },
      });
      return { ok: true };
    }
  );
}
