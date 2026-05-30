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
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { galleryAccessWhere } from "../lib/gallery-access.js";
import { generateAccessToken } from "../services/ids.js";
import { hashPassword } from "../services/auth.js";
import { logEvent } from "../services/audit.js";
import { sendGalleryInvitation } from "../services/notifier.js";

/** Empfaenger-Liste: max 10 Adressen pro Access, jede valid + lowercase
 *  + getrimmt + unique. Doppelte werden silently dedupliziert. */
const emailsSchema = z
  .array(z.string().email().toLowerCase().trim().max(200))
  .max(10)
  .transform((arr) => Array.from(new Set(arr)));

const createAccessSchema = z.object({
  label: z.string().min(1).max(100),
  emails: emailsSchema.default([]),
  canDownload: z.boolean().default(true),
  canComment: z.boolean().default(true),
  canSelect: z.boolean().default(true),
  canSeeOthers: z.boolean().default(false),
  expiresAt: z.string().datetime().optional(),
  /** Wenn true UND mindestens eine Adresse in emails: direkt nach dem
   *  Anlegen eine Einladungs-Mail an alle Adressen schicken. */
  sendInvitation: z.boolean().default(false),
  /** Optionale persoenliche Nachricht in der Einladung. Max 1000 Zeichen. */
  personalMessage: z.string().max(1000).optional(),
});

// PATCH-Schema: ohne sendInvitation/personalMessage — bei Patch
// gehen NICHT automatisch Mails raus. Re-Send geht ueber den
// separaten Invite-Endpoint.
const updateAccessSchema = z
  .object({
    label: z.string().min(1).max(100),
    emails: emailsSchema,
    canDownload: z.boolean(),
    canComment: z.boolean(),
    canSelect: z.boolean(),
    canSeeOthers: z.boolean(),
    expiresAt: z.string().datetime(),
  })
  .partial();

// Re-Send-Schema:
//   - personalMessage: optionale Notiz fuer diesen Versand
//   - recipients: optional, ueberschreibt fuer DIESEN Versand die
//     hinterlegten emails (z.B. um nur an eine bestimmte Adresse zu
//     senden oder eine neue Adresse einmalig zu versuchen). Ohne
//     recipients geht die Mail an alle hinterlegten emails.
//   - updateDefaults: wenn true, werden die recipients als neue
//     Default-emails auf dem Access gespeichert. Damit kann der
//     User aus dem Re-Send-Dialog die Liste pflegen.
const invitationSchema = z.object({
  personalMessage: z.string().max(1000).optional(),
  recipients: emailsSchema.optional(),
  updateDefaults: z.boolean().default(false),
});

const setPasswordSchema = z.object({
  password: z.string().min(4).max(200),
});

async function loadOwnedGallery(req: FastifyRequest, galleryId: string) {
  const s = req.requireAuth();
  // Granulares Zugriffsmodell: Ersteller ODER freigegeben ODER Studio-Owner.
  return prisma.gallery.findFirst({
    where: {
      id: galleryId,
      tenantId: req.tenantId,
      ...galleryAccessWhere(s),
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
          emails: a.emails,
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
          emails: body.emails,
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

      // Einladungs-Mail: nur wenn explizit angefordert UND mindestens
      // eine Adresse vorhanden ist. Fire-and-forget.
      let invitationSent = false;
      if (body.sendInvitation && body.emails.length > 0) {
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
            payload: {
              galleryId: gallery.id,
              recipientCount: body.emails.length,
            },
            ipAddress: req.ip,
          });
        }
      }

      return reply.status(201).send({
        access: {
          id: access.id,
          label: access.label,
          token: access.token,
          emails: access.emails,
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
          ...(body.emails !== undefined ? { emails: body.emails } : {}),
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
        select: { id: true, emails: true },
      });
      if (!access) return reply.status(404).send({ error: "not_found" });

      const body = invitationSchema.parse(req.body ?? {});

      // Welche Empfaenger fuer DIESEN Versand?
      // - Wenn recipients im Body: die nehmen
      // - Sonst: hinterlegte emails am Access
      const recipients =
        body.recipients !== undefined ? body.recipients : access.emails;

      if (recipients.length === 0) {
        return reply.status(400).send({
          error: "no_recipients",
          message:
            "Keine Empfänger angegeben. Lege erst Adressen am Access an oder gib sie im Versand mit.",
        });
      }

      // Optional: ad-hoc-Adressen als neue Defaults speichern
      if (body.updateDefaults && body.recipients !== undefined) {
        await prisma.galleryAccess.update({
          where: { id: access.id },
          data: { emails: body.recipients },
        });
      }

      const sent = await sendGalleryInvitation({
        accessId: access.id,
        personalMessage: body.personalMessage,
        recipientsOverride:
          body.recipients !== undefined ? body.recipients : undefined,
      });

      if (sent) {
        await logEvent({
          tenantId: req.tenantId,
          actorType: "user",
          actorId: s.user.id,
          action: "share.invite",
          targetType: "gallery_access",
          targetId: access.id,
          payload: {
            galleryId: gallery.id,
            recipientCount: recipients.length,
            resend: true,
            updateDefaults: body.updateDefaults,
          },
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
