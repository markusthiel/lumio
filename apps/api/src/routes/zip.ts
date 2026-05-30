/**
 * Lumio API — ZIP Download Routes
 *
 * Kunden-seitig:
 *   POST /g/:slug/download/zip            — ZIP der ganzen Galerie anfordern
 *   POST /g/:slug/download/selection      — ZIP der eigenen Auswahl (Likes
 *                                            + Picks aus Collaboration-Mode)
 *   POST /g/:slug/download/picked         — ZIP einer ad-hoc-Auswahl, IDs
 *                                            kommen vom Client (Warenkorb-
 *                                            Modus, funktioniert in jedem
 *                                            Galerie-Mode)
 *   GET  /g/:slug/download/zip/:zipId     — Status pollen oder zum Download-URL redirecten
 *
 * Studio-seitig:
 *   POST /galleries/:id/download/zip      — ZIP der ganzen Galerie anfordern
 *   GET  /galleries/:id/download/zip/:zipId
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { presignGet } from "../services/storage.js";
import { requestZipDownload } from "../services/zip.js";
import { notifyZipReadyOnce } from "../services/notifier.js";
import { loadVisitor } from "./galleries.js";
import { galleryAccessWhere } from "../lib/gallery-access.js";

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
  // POST /g/:slug/download/picked  — ad-hoc-Warenkorb-Download
  // -------------------------------------------------------------------------
  // Funktioniert in allen Galerie-Modes (auch presentation). Im Gegensatz
  // zu /selection wird die Auswahl NICHT in der Selection-Tabelle
  // gespeichert — der Client hält sie in localStorage und schickt die
  // File-IDs frisch mit jedem Download-Request. Das ist saubere
  // Trennung: Likes/Picks aus dem Collaboration-Mode sind
  // "Photograph-Feedback", picked-Downloads sind ein Customer-
  // Warenkorb ohne Persistenz im Backend.
  app.post<{
    Params: { slug: string };
    Querystring: { variant?: string };
    Body: unknown;
  }>(
    "/g/:slug/download/picked",
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

      const variant: "original" | "web" =
        req.query.variant === "web" ? "web" : "original";
      if (variant === "original" && !gallery.downloadOriginalsEnabled) {
        return reply
          .status(403)
          .send({ error: "originals_disabled" });
      }

      // File-IDs aus Body. Max 500 — eine ZIP-Anfrage mit 500 Files
      // ist schon ein 5-10-GB-Job, mehr macht beim Streamen über
      // HTTP keinen Spaß mehr.
      const bodySchema = z.object({
        fileIds: z.array(z.string().uuid()).min(1).max(500),
      });
      const body = bodySchema.safeParse(req.body);
      if (!body.success) {
        return reply
          .status(400)
          .send({ error: "invalid_body", issues: body.error.flatten() });
      }

      // Permission-Check: alle IDs müssen zu DIESER Galerie gehören
      // und ready sein. Wer fremde File-IDs einschmuggelt landet hier
      // — und kriegt sie einfach nicht. Wir filtern statt zu
      // rejecten, weil der Client zwischen "stale localStorage mit
      // gelöschtem File" und "Angriff" nicht unterscheiden kann.
      const valid = await prisma.file.findMany({
        where: {
          id: { in: body.data.fileIds },
          galleryId: gallery.id,
          status: "ready",
        },
        select: { id: true },
      });
      const validIds = valid.map((f) => f.id);
      if (validIds.length === 0) {
        return reply
          .status(400)
          .send({ error: "no_valid_files", message: "Keine gültigen Files in der Auswahl." });
      }

      // Label aus den ersten File-IDs hashen — dedupliziert dieselbe
      // Auswahl, sodass derselbe Customer beim erneuten Klick keine
      // neue ZIP baut. requestZipDownload macht das schon via
      // fileIdsHash; das Label ist nur für Anzeige in der DB.
      // accessId kann null sein (presentation-Mode ohne Token) —
      // dann ist der Cache-Hit pro Galerie+IDs+Variant, was bei
      // Sharing-Cache-Effekten genau richtig ist.
      const zipDownload = await requestZipDownload({
        tenantId: gallery.tenantId,
        galleryId: gallery.id,
        accessId: visitor.accessId ?? null,
        fileIds: validIds,
        label: `picked${variant === "web" ? "_web" : ""}`,
        variant,
      });

      return reply.status(202).send({
        id: zipDownload.id,
        status: zipDownload.status,
        fileCount: validIds.length,
        // Wenn der Client weniger Files zurückkriegt als er geschickt
        // hat, kann er die Auswahl im localStorage gerade bereinigen.
        requested: body.data.fileIds.length,
      });
    }
  );

  // -------------------------------------------------------------------------
  // POST /g/:slug/download/by-tags — Customer-side Tag-gefilterter ZIP
  // -------------------------------------------------------------------------
  // Pendant zum Studio-Endpoint, aber Customer-seitig: erfordert
  // unlocked Visitor + customerTagFilterEnabled an der Galerie. Sonst
  // 403 — Tags-Sichtbarkeit ist pro Galerie gegated.
  //
  // Body: { tagIds: string[] } — mind. 1, max 20.
  // Querystring: ?variant=original|web (default original)
  app.post<{
    Params: { slug: string };
    Querystring: { variant?: string };
    Body: unknown;
  }>(
    "/g/:slug/download/by-tags",
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
          customerTagFilterEnabled: true,
        },
      });
      if (!gallery || !gallery.downloadEnabled) {
        return reply.status(403).send({ error: "downloads_disabled" });
      }
      if (!gallery.customerTagFilterEnabled) {
        // Galerie hat den Tag-Filter fuer Kunden nicht aktiv. Wir geben
        // bewusst 403 zurueck (nicht 404), damit ein curiouser Aufruf
        // erkennt: 'das Feature gibt es, ist hier nur aus'.
        return reply
          .status(403)
          .send({ error: "tag_filter_disabled_for_gallery" });
      }

      const variant: "original" | "web" =
        req.query.variant === "web" ? "web" : "original";
      if (variant === "original" && !gallery.downloadOriginalsEnabled) {
        return reply
          .status(403)
          .send({ error: "originals_disabled" });
      }

      const bodySchema = z.object({
        tagIds: z.array(z.string().uuid()).min(1).max(20),
      });
      const body = bodySchema.safeParse(req.body);
      if (!body.success) {
        return reply
          .status(400)
          .send({ error: "invalid_body", issues: body.error.flatten() });
      }

      // UND-Filter: Files muessen ALLE ausgewaehlten Tags haben.
      // Identische Logik wie im Studio-Endpoint, plus zusaetzlich
      // publicVisibility=visible damit pending-Approval-Files
      // (Upload-Link-Uploads ohne Studio-Freigabe) draussen bleiben.
      const files = await prisma.file.findMany({
        where: {
          galleryId: gallery.id,
          status: "ready",
          publicVisibility: "visible",
          AND: body.data.tagIds.map((tagId) => ({
            tags: { some: { tagId } },
          })),
        },
        select: { id: true },
      });
      if (files.length === 0) {
        return reply.status(400).send({
          error: "no_files_matching_filter",
          message: "Keine Bilder passen zum Filter.",
        });
      }

      const zipDownload = await requestZipDownload({
        tenantId: gallery.tenantId,
        galleryId: gallery.id,
        accessId: visitor.accessId ?? null,
        fileIds: files.map((f) => f.id),
        // Label: 'tags_<sorted-ids>' damit der Cache pro Filter-Auswahl
        // dedupliziert (zweiter Klick auf gleichen Filter → kein
        // erneuter ZIP-Build sofern noch nicht abgelaufen)
        label: `tags_${body.data.tagIds.slice().sort().join("_")}${variant === "web" ? "_web" : ""}`,
        variant,
      });

      return reply.status(202).send({
        id: zipDownload.id,
        status: zipDownload.status,
        fileCount: files.length,
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
  // -------------------------------------------------------------------------
  // POST /galleries/:id/download/zip — Studio-seitige ZIP-Anfrage
  // -------------------------------------------------------------------------
  // Body (alles optional):
  //   variant: "original" | "web"  (default "original")
  //   tagIds:  string[]            wenn gesetzt: nur Files die ALLE diese
  //                                Tags haben (UND-Filter, analog zum
  //                                Studio-Galerie-Filter). Wenn leer oder
  //                                undefined: ganze Galerie.
  //
  // Use-Case: Studio kann ZIP einer Auswahl bauen ('alle Schwarzweiß-
  // Brautpaar-Fotos') und der Kundin per Mail-Link schicken — ohne dass
  // die Kundin selbst Tag-Filter sehen muss.
  app.post<{
    Params: { id: string };
    Body: {
      variant?: "original" | "web";
      tagIds?: string[];
    };
  }>(
    "/galleries/:id/download/zip",
    async (req, reply) => {
      const s = req.requireAuth();
      const gallery = await prisma.gallery.findFirst({
        where: {
          id: req.params.id,
          tenantId: req.tenantId,
          ...galleryAccessWhere(s),
        },
        select: { id: true, tenantId: true },
      });
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const body = req.body ?? {};
      const variant: "original" | "web" =
        body.variant === "web" ? "web" : "original";

      // Tag-Filter: wenn gegeben, Files via UND-Filter resolven. Wir
      // nehmen NUR ready-Files und ueberspringen rejected/hidden — der
      // Studio-Download soll nicht versehentlich abgelehnte Uploads
      // einpacken.
      let fileIds: string[] | null = null;
      let label = "studio_all";
      if (body.tagIds && body.tagIds.length > 0) {
        const files = await prisma.file.findMany({
          where: {
            galleryId: gallery.id,
            status: "ready",
            publicVisibility: "visible",
            AND: body.tagIds.map((tagId) => ({
              tags: { some: { tagId } },
            })),
          },
          select: { id: true },
        });
        if (files.length === 0) {
          return reply.status(400).send({
            error: "no_files_matching_filter",
            message: "Keine Dateien passen zum Tag-Filter.",
          });
        }
        fileIds = files.map((f) => f.id);
        // Label trackt im Audit was gewaehlt war — anonyme Tag-Liste
        // reicht, Tag-Namen sind nicht persistent (User kann sie spaeter
        // umbenennen, wir wollen historisches Label).
        label = `studio_tags_${body.tagIds.slice().sort().join("_")}`;
      }

      const zipDownload = await requestZipDownload({
        tenantId: gallery.tenantId,
        galleryId: gallery.id,
        accessId: null,
        fileIds,
        label,
        variant,
      });
      return reply.status(202).send({
        id: zipDownload.id,
        status: zipDownload.status,
        fileCount: fileIds?.length ?? null,
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
          ...galleryAccessWhere(s),
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

  // -------------------------------------------------------------------------
  // GET /galleries/:id/download/zip/:zipId/share-url
  // -------------------------------------------------------------------------
  // Direkt-teilbare S3-presigned URL fuer das ZIP. Use-Case: Studio baut
  // eine Tag-gefilterte ZIP und schickt der Kundin den Link per Mail —
  // ohne dass die Kundin einen Lumio-Login braucht.
  //
  // Gueltigkeit: 24h. Sollte einer der angemessenen Default sein —
  // Kundin oeffnet die Mail nicht immer sofort, aber 7 Tage waeren
  // schon Security-Risiko falls die Mail durchsickert.
  app.get<{ Params: { id: string; zipId: string } }>(
    "/galleries/:id/download/zip/:zipId/share-url",
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

      const zip = await prisma.zipDownload.findFirst({
        where: { id: req.params.zipId, galleryId: gallery.id },
      });
      if (!zip) return reply.status(404).send({ error: "not_found" });
      if (zip.status !== "ready" || !zip.storageKey) {
        return reply
          .status(409)
          .send({ error: "not_ready", status: zip.status });
      }

      const SHARE_TTL_SECONDS = 24 * 60 * 60;
      const url = await presignGet({
        key: zip.storageKey,
        responseContentDisposition: `attachment; filename="lumio-${zip.id.slice(
          0,
          8
        )}.zip"`,
        ttlSeconds: SHARE_TTL_SECONDS,
      });
      return {
        url,
        expiresAt: new Date(
          Date.now() + SHARE_TTL_SECONDS * 1000
        ).toISOString(),
        fileCount: zip.fileCount,
        sizeBytes: zip.sizeBytes ? Number(zip.sizeBytes) : null,
      };
    }
  );
}
