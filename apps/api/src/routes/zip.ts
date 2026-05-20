/**
 * Lumio API — ZIP Download Routes
 *
 * Kunden-seitig:
 *   POST /g/:slug/download/zip            — ZIP der ganzen Galerie anfordern
 *   POST /g/:slug/download/selection      — ZIP der eigenen Auswahl anfordern
 *   GET  /g/:slug/download/zip/:zipId     — Status pollen oder zum Download-URL redirecten
 *
 * Studio-seitig:
 *   POST /galleries/:id/download/zip      — ZIP der ganzen Galerie anfordern
 *   GET  /galleries/:id/download/zip/:zipId
 */
import type { FastifyInstance } from "fastify";

import { prisma } from "../db.js";
import { presignGet } from "../services/storage.js";
import { requestZipDownload } from "../services/zip.js";
import { notifyZipReadyOnce } from "../services/notifier.js";
import { loadVisitor } from "./galleries.js";

export async function registerZipRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // POST /g/:slug/download/zip?variant=original|web  — ganze Galerie
  // -------------------------------------------------------------------------
  app.post<{
    Params: { slug: string };
    Querystring: { variant?: string };
  }>(
    "/g/:slug/download/zip",
    async (req, reply) => {
      const visitor = await loadVisitor(req);
      if (!visitor) {
        return reply.status(401).send({ error: "unlock_required" });
      }

      const gallery = await prisma.gallery.findUnique({
        where: { id: visitor.galleryId },
        select: {
          id: true,
          tenantId: true,
          downloadEnabled: true,
          downloadOriginalsEnabled: true,
        },
      });
      if (!gallery || !gallery.downloadEnabled) {
        return reply.status(403).send({ error: "downloads_disabled" });
      }

      // Variant validieren + Permission-Check
      const variant: "original" | "web" =
        req.query.variant === "web" ? "web" : "original";
      if (variant === "original" && !gallery.downloadOriginalsEnabled) {
        return reply
          .status(403)
          .send({ error: "originals_disabled" });
      }

      const zipDownload = await requestZipDownload({
        tenantId: gallery.tenantId,
        galleryId: gallery.id,
        accessId: null, // öffentlich/anonym → keine Auswahl-Zuordnung
        fileIds: null, // alle
        label: variant === "web" ? "all_web" : "all",
        variant,
      });

      return reply.status(202).send({
        id: zipDownload.id,
        status: zipDownload.status,
      });
    }
  );

  // -------------------------------------------------------------------------
  // POST /g/:slug/download/selection?variant=original|web — Auswahl
  // -------------------------------------------------------------------------
  app.post<{
    Params: { slug: string };
    Querystring: { variant?: string };
  }>(
    "/g/:slug/download/selection",
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

      const gallery = await prisma.gallery.findUnique({
        where: { id: visitor.galleryId },
        select: {
          id: true,
          tenantId: true,
          downloadEnabled: true,
          downloadOriginalsEnabled: true,
        },
      });
      if (!gallery || !gallery.downloadEnabled) {
        return reply.status(403).send({ error: "downloads_disabled" });
      }

      const variant: "original" | "web" =
        req.query.variant === "web" ? "web" : "original";
      if (variant === "original" && !gallery.downloadOriginalsEnabled) {
        return reply
          .status(403)
          .send({ error: "originals_disabled" });
      }

      // Auswahl des Visitors holen — alle liked oder picked
      const selections = await prisma.selection.findMany({
        where: {
          accessId: visitor.accessId,
          OR: [{ liked: true }, { status: "pick" }],
          file: { galleryId: gallery.id, status: "ready" },
        },
        select: { fileId: true },
      });
      if (selections.length === 0) {
        return reply
          .status(400)
          .send({ error: "no_selection", message: "Keine Auswahl getroffen." });
      }

      const fileIds = selections.map((s) => s.fileId);
      const zipDownload = await requestZipDownload({
        tenantId: gallery.tenantId,
        galleryId: gallery.id,
        accessId: visitor.accessId,
        fileIds,
        label: `selection_${visitor.accessId.slice(0, 8)}${
          variant === "web" ? "_web" : ""
        }`,
        variant,
      });

      return reply.status(202).send({
        id: zipDownload.id,
        status: zipDownload.status,
        fileCount: fileIds.length,
      });
    }
  );

  // -------------------------------------------------------------------------
  // GET /g/:slug/download/zip/:zipId — Status oder Redirect
  // -------------------------------------------------------------------------
  app.get<{ Params: { slug: string; zipId: string } }>(
    "/g/:slug/download/zip/:zipId",
    async (req, reply) => {
      const visitor = await loadVisitor(req);
      if (!visitor) {
        return reply.status(401).send({ error: "unlock_required" });
      }

      const zip = await prisma.zipDownload.findFirst({
        where: {
          id: req.params.zipId,
          galleryId: visitor.galleryId,
        },
        select: {
          id: true,
          status: true,
          storageKey: true,
          sizeBytes: true,
          fileCount: true,
          accessId: true,
          errorMessage: true,
          expiresAt: true,
        },
      });
      if (!zip) return reply.status(404).send({ error: "not_found" });

      // Wenn die ZIP einem Access-Token zugeordnet ist (Auswahl), darf nur
      // dieser Visitor sie sehen.
      if (zip.accessId && zip.accessId !== visitor.accessId) {
        return reply.status(403).send({ error: "forbidden" });
      }

      // Wenn fertig und Download via Query-Param ?download=1: zum
      // Presigned URL umleiten. Sonst nur Status zurückgeben.
      const wantsDownload =
        (req.query as { download?: string } | undefined)?.download === "1";

      if (zip.status === "ready" && zip.storageKey && wantsDownload) {
        const url = await presignGet({
          key: zip.storageKey,
          responseContentDisposition: `attachment; filename="lumio-${zip.id.slice(
            0,
            8
          )}.zip"`,
        });
        // Audit
        await prisma.downloadLog
          .create({
            data: {
              galleryId: visitor.galleryId,
              kind: "zip",
              ipAddress: req.ip,
              userAgent: req.headers["user-agent"]?.slice(0, 500) ?? null,
              bytes: zip.sizeBytes,
            },
          })
          .catch(() => {});
        return reply.redirect(url);
      }

      // Lazy notify: erster Poll, der "ready" sieht und noch nicht
      // notifiziert wurde, löst die Mail aus. Idempotent über DB-Flag.
      if (zip.status === "ready") {
        void notifyZipReadyOnce({ zipDownloadId: zip.id });
      }

      return {
        id: zip.id,
        status: zip.status,
        fileCount: zip.fileCount,
        sizeBytes: zip.sizeBytes ? Number(zip.sizeBytes) : null,
        errorMessage: zip.errorMessage,
        expiresAt: zip.expiresAt,
      };
    }
  );

  // -------------------------------------------------------------------------
  // Studio: ZIP der ganzen Galerie (für Backup/Lieferung)
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/galleries/:id/download/zip",
    async (req, reply) => {
      const s = req.requireAuth();
      const gallery = await prisma.gallery.findFirst({
        where: {
          id: req.params.id,
          tenantId: req.tenantId,
          ownerId: s.user.id,
        },
        select: { id: true, tenantId: true },
      });
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const zipDownload = await requestZipDownload({
        tenantId: gallery.tenantId,
        galleryId: gallery.id,
        accessId: null,
        fileIds: null,
        label: "studio_all",
      });
      return reply.status(202).send({
        id: zipDownload.id,
        status: zipDownload.status,
      });
    }
  );

  app.get<{ Params: { id: string; zipId: string } }>(
    "/galleries/:id/download/zip/:zipId",
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

      const zip = await prisma.zipDownload.findFirst({
        where: { id: req.params.zipId, galleryId: gallery.id },
      });
      if (!zip) return reply.status(404).send({ error: "not_found" });

      const wantsDownload =
        (req.query as { download?: string } | undefined)?.download === "1";
      if (zip.status === "ready" && zip.storageKey && wantsDownload) {
        const url = await presignGet({
          key: zip.storageKey,
          responseContentDisposition: `attachment; filename="lumio-${zip.id.slice(
            0,
            8
          )}.zip"`,
        });
        return reply.redirect(url);
      }
      return {
        id: zip.id,
        status: zip.status,
        fileCount: zip.fileCount,
        sizeBytes: zip.sizeBytes ? Number(zip.sizeBytes) : null,
        errorMessage: zip.errorMessage,
        expiresAt: zip.expiresAt,
      };
    }
  );
}
