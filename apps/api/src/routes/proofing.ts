/**
 * Lumio API — Proofing Routes (Kunden-seitig)
 *
 * Wird mit gültigem Visitor-Cookie aufgerufen.
 *
 *   PUT    /g/:slug/files/:fileId/selection   — color/rating/like setzen (upsert)
 *   DELETE /g/:slug/files/:fileId/selection   — Auswahl zurücknehmen
 *   POST   /g/:slug/files/:fileId/comments    — neuer Kommentar
 *   GET    /g/:slug/files/:fileId/comments    — Kommentare lesen
 *
 * Studio-seitig:
 *   GET    /galleries/:id/proofing/summary    — Übersicht: pro File die
 *                                                Auswahl aller Access-Teams
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { loadVisitor } from "./galleries.js";
import { notifyNewComment, notifySelectionFinished } from "../services/notifier.js";
import { logEvent } from "../services/audit.js";

const selectionSchema = z.object({
  color: z.enum(["red", "yellow", "green"]).nullable().optional(),
  rating: z.number().int().min(0).max(5).nullable().optional(),
  liked: z.boolean().optional(),
  status: z.enum(["pick", "reject", "maybe"]).nullable().optional(),
});

const commentSchema = z.object({
  body: z.string().min(1).max(5000),
  parentId: z.string().uuid().optional(),
  annotation: z.unknown().optional(),
  authorLabel: z.string().min(1).max(100).optional(),
});

export async function registerProofingRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // PUT /g/:slug/files/:fileId/selection
  // -------------------------------------------------------------------------
  app.put<{ Params: { slug: string; fileId: string } }>(
    "/g/:slug/files/:fileId/selection",
    async (req, reply) => {
      const visitor = await loadVisitor(req);
      if (!visitor) {
        return reply.status(401).send({ error: "unlock_required" });
      }
      // Selection nur mit gültigem Access-Token (zur Zuordnung "wer hat
      // was ausgewählt"). Anonyme Visitor können nur ansehen.
      if (!visitor.accessId) {
        return reply
          .status(403)
          .send({ error: "access_token_required" });
      }

      // Access-Permissions prüfen
      const access = await prisma.galleryAccess.findFirst({
        where: { id: visitor.accessId, galleryId: visitor.galleryId },
        select: { canSelect: true },
      });
      if (!access || !access.canSelect) {
        return reply.status(403).send({ error: "not_allowed" });
      }

      // File muss zur Galerie gehören
      const file = await prisma.file.findFirst({
        where: { id: req.params.fileId, galleryId: visitor.galleryId },
        select: { id: true },
      });
      if (!file) return reply.status(404).send({ error: "not_found" });

      const body = selectionSchema.parse(req.body);

      // Selection-Limit prüfen (nur bei Pick-Status)
      if (body.status === "pick" || body.liked === true) {
        const gallery = await prisma.gallery.findUnique({
          where: { id: visitor.galleryId },
          select: { selectionLimit: true },
        });
        if (gallery?.selectionLimit) {
          const currentPicks = await prisma.selection.count({
            where: {
              accessId: visitor.accessId,
              OR: [{ status: "pick" }, { liked: true }],
              NOT: { fileId: file.id }, // den eigenen ausschließen
            },
          });
          if (currentPicks >= gallery.selectionLimit) {
            return reply.status(409).send({
              error: "selection_limit_reached",
              limit: gallery.selectionLimit,
            });
          }
        }
      }

      const selection = await prisma.selection.upsert({
        where: {
          fileId_accessId: {
            fileId: file.id,
            accessId: visitor.accessId,
          },
        },
        update: {
          ...(body.color !== undefined ? { color: body.color } : {}),
          ...(body.rating !== undefined ? { rating: body.rating } : {}),
          ...(body.liked !== undefined ? { liked: body.liked } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
        },
        create: {
          fileId: file.id,
          accessId: visitor.accessId,
          color: body.color ?? null,
          rating: body.rating ?? null,
          liked: body.liked ?? false,
          status: body.status ?? null,
        },
      });

      return { selection };
    }
  );

  // -------------------------------------------------------------------------
  // DELETE /g/:slug/files/:fileId/selection
  // -------------------------------------------------------------------------
  app.delete<{ Params: { slug: string; fileId: string } }>(
    "/g/:slug/files/:fileId/selection",
    async (req, reply) => {
      const visitor = await loadVisitor(req);
      if (!visitor || !visitor.accessId) {
        return reply.status(401).send({ error: "unlock_required" });
      }
      await prisma.selection.deleteMany({
        where: {
          fileId: req.params.fileId,
          accessId: visitor.accessId,
        },
      });
      return reply.status(204).send();
    }
  );

  // -------------------------------------------------------------------------
  // POST /g/:slug/files/:fileId/comments
  // -------------------------------------------------------------------------
  app.post<{ Params: { slug: string; fileId: string } }>(
    "/g/:slug/files/:fileId/comments",
    async (req, reply) => {
      const visitor = await loadVisitor(req);
      if (!visitor) {
        return reply.status(401).send({ error: "unlock_required" });
      }
      if (!visitor.accessId) {
        return reply
          .status(403)
          .send({ error: "access_token_required" });
      }

      const access = await prisma.galleryAccess.findFirst({
        where: { id: visitor.accessId, galleryId: visitor.galleryId },
        select: { canComment: true, label: true },
      });
      if (!access || !access.canComment) {
        return reply.status(403).send({ error: "not_allowed" });
      }

      const gallery = await prisma.gallery.findUnique({
        where: { id: visitor.galleryId },
        select: { commentsEnabled: true },
      });
      if (!gallery?.commentsEnabled) {
        return reply.status(403).send({ error: "comments_disabled" });
      }

      const file = await prisma.file.findFirst({
        where: { id: req.params.fileId, galleryId: visitor.galleryId },
        select: { id: true },
      });
      if (!file) return reply.status(404).send({ error: "not_found" });

      const body = commentSchema.parse(req.body);

      const comment = await prisma.comment.create({
        data: {
          fileId: file.id,
          accessId: visitor.accessId,
          authorLabel: body.authorLabel ?? access.label,
          authorIsStudio: false,
          body: body.body,
          annotation: (body.annotation as object | undefined) ?? undefined,
          parentId: body.parentId ?? null,
        },
      });

      // Studio per Mail benachrichtigen (fire-and-forget)
      void notifyNewComment({
        galleryId: visitor.galleryId,
        authorLabel: comment.authorLabel,
        body: comment.body,
      });

      return reply.status(201).send({ comment });
    }
  );

  // -------------------------------------------------------------------------
  // GET /g/:slug/files/:fileId/comments
  // -------------------------------------------------------------------------
  app.get<{ Params: { slug: string; fileId: string } }>(
    "/g/:slug/files/:fileId/comments",
    async (req, reply) => {
      const visitor = await loadVisitor(req);
      if (!visitor) {
        return reply.status(401).send({ error: "unlock_required" });
      }

      // Welche Kommentare darf der Visitor sehen?
      //   - Studio-Kommentare immer
      //   - Eigene Kommentare immer
      //   - Andere Visitor-Kommentare nur wenn access.canSeeOthers
      let canSeeOthers = false;
      if (visitor.accessId) {
        const access = await prisma.galleryAccess.findUnique({
          where: { id: visitor.accessId },
          select: { canSeeOthers: true },
        });
        canSeeOthers = !!access?.canSeeOthers;
      }

      const comments = await prisma.comment.findMany({
        where: {
          fileId: req.params.fileId,
          OR: canSeeOthers
            ? undefined
            : [
                { authorIsStudio: true },
                ...(visitor.accessId
                  ? [{ accessId: visitor.accessId }]
                  : []),
              ],
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          authorLabel: true,
          authorIsStudio: true,
          body: true,
          annotation: true,
          parentId: true,
          createdAt: true,
        },
      });

      return { comments };
    }
  );

  // -------------------------------------------------------------------------
  // POST /g/:slug/finalize — Kunde schließt seine Auswahl ab
  // -------------------------------------------------------------------------
  // Setzt finalizedAt auf dem Access-Record und triggert eine Mail ans
  // Studio. Idempotent — erneuter Aufruf setzt das Datum wieder neu.
  app.post<{ Params: { slug: string } }>(
    "/g/:slug/finalize",
    async (req, reply) => {
      const visitor = await loadVisitor(req);
      if (!visitor) {
        return reply.status(401).send({ error: "unlock_required" });
      }
      if (!visitor.accessId) {
        return reply
          .status(403)
          .send({ error: "access_token_required" });
      }

      const access = await prisma.galleryAccess.findFirst({
        where: { id: visitor.accessId, galleryId: visitor.galleryId },
        select: { id: true, finalizedAt: true },
      });
      if (!access) return reply.status(404).send({ error: "not_found" });

      // Anzahl Picks/Likes prüfen — leerer Abschluss ist nicht sinnvoll
      const count = await prisma.selection.count({
        where: {
          accessId: access.id,
          OR: [{ liked: true }, { status: "pick" }],
        },
      });
      if (count === 0) {
        return reply
          .status(400)
          .send({ error: "empty_selection", message: "Keine Auswahl getroffen." });
      }

      await prisma.galleryAccess.update({
        where: { id: access.id },
        data: { finalizedAt: new Date() },
      });

      // Mail ans Studio (fire-and-forget)
      void notifySelectionFinished({
        galleryId: visitor.galleryId,
        accessId: access.id,
      });

      // Audit-Log — wir brauchen die tenantId der Galerie. Die Selection
      // ist eine Kunden-Aktion, also actorType="access".
      const galleryRow = await prisma.gallery.findUnique({
        where: { id: visitor.galleryId },
        select: { tenantId: true },
      });
      if (galleryRow) {
        await logEvent({
          tenantId: galleryRow.tenantId,
          actorType: "access",
          actorId: access.id,
          action: "selection.finalize",
          targetType: "gallery",
          targetId: visitor.galleryId,
          payload: { count },
          ipAddress: req.ip,
        });
      }

      return { ok: true, count, finalizedAt: new Date() };
    }
  );

  // -------------------------------------------------------------------------
  // GET /galleries/:id/proofing/summary (Studio-seitig)
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    "/galleries/:id/proofing/summary",
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

      // Pro File: alle Selektionen aggregieren
      const selections = await prisma.selection.findMany({
        where: { file: { galleryId: gallery.id } },
        select: {
          fileId: true,
          color: true,
          rating: true,
          liked: true,
          status: true,
          access: { select: { id: true, label: true } },
        },
      });

      // Comment-Counts pro File (klein gehalten — Details lassen sich
      // dann pro File über den Comments-Endpoint laden)
      const commentCounts = await prisma.comment.groupBy({
        by: ["fileId"],
        where: { file: { galleryId: gallery.id } },
        _count: { _all: true },
      });
      const commentMap = Object.fromEntries(
        commentCounts.map((c) => [c.fileId, c._count._all])
      );

      // Gruppieren pro File
      const byFile: Record<
        string,
        {
          selections: Array<{
            accessId: string;
            accessLabel: string;
            color: string | null;
            rating: number | null;
            liked: boolean;
            status: string | null;
          }>;
          commentCount: number;
        }
      > = {};

      for (const sel of selections) {
        if (!byFile[sel.fileId]) {
          byFile[sel.fileId] = { selections: [], commentCount: 0 };
        }
        byFile[sel.fileId].selections.push({
          accessId: sel.access.id,
          accessLabel: sel.access.label,
          color: sel.color,
          rating: sel.rating,
          liked: sel.liked,
          status: sel.status,
        });
      }

      for (const fileId of Object.keys(commentMap)) {
        if (!byFile[fileId]) byFile[fileId] = { selections: [], commentCount: 0 };
        byFile[fileId].commentCount = commentMap[fileId];
      }

      return { byFile };
    }
  );
}
