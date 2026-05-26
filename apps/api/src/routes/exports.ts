/**
 * Lumio API — Export Routes (Studio + Public)
 *
 * Studio-Routes (auth via session):
 *   POST   /exports/galleries/:galleryId  Single-Gallery-Export
 *   POST   /exports/tenant                 Alle Galerien des Tenants
 *   GET    /exports                        Liste der Exports
 *   GET    /exports/:id                    Detail mit Items + Download-URLs
 *   DELETE /exports/:id                    Manuell löschen
 *
 * Public-Routes (auth via Token):
 *   GET    /e/:token                       Token-Lookup, liefert Export-Detail
 *   GET    /e/:token/items/:itemId/download  Signed-URL für ZIP-Download
 */
import type { FastifyInstance } from "fastify";

import { prisma } from "../db.js";
import { createExport } from "../services/export-service.js";
import { presignGet } from "../services/storage.js";
import { logEvent } from "../services/audit.js";


export async function registerTenantExportRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // Studio: POST /exports/galleries/:galleryId — eine Galerie exportieren
  // -------------------------------------------------------------------------
  app.post<{ Params: { galleryId: string } }>(
    "/exports/galleries/:galleryId",
    async (req, reply) => {
      const s = req.requireAuth();
      const g = await prisma.gallery.findFirst({
        where: { id: req.params.galleryId, tenantId: req.tenantId },
        select: { id: true, title: true },
      });
      if (!g) return reply.status(404).send({ error: "not_found" });

      const result = await createExport({
        tenantId: req.tenantId,
        source: "studio",
        galleryIds: [g.id],
        triggeredByUserId: s.user.id,
      });

      await logEvent({
        tenantId: req.tenantId,
        actorType: "user",
        actorId: s.user.id,
        action: "export.create",
        targetType: "tenant_export",
        targetId: result.exportId,
        payload: { source: "studio", galleryIds: [g.id] },
        ipAddress: req.ip,
      });

      return reply.status(201).send({
        exportId: result.exportId,
        itemCount: result.itemCount,
      });
    }
  );

  // -------------------------------------------------------------------------
  // Studio: POST /exports/tenant — alle Galerien des Tenants exportieren
  // -------------------------------------------------------------------------
  app.post("/exports/tenant", async (req, reply) => {
    const s = req.requireAuth();
    try {
      const result = await createExport({
        tenantId: req.tenantId,
        source: "studio_all",
        galleryIds: null,
        triggeredByUserId: s.user.id,
      });
      await logEvent({
        tenantId: req.tenantId,
        actorType: "user",
        actorId: s.user.id,
        action: "export.create",
        targetType: "tenant_export",
        targetId: result.exportId,
        payload: { source: "studio_all" },
        ipAddress: req.ip,
      });
      return reply.status(201).send({
        exportId: result.exportId,
        itemCount: result.itemCount,
      });
    } catch (err) {
      if (err instanceof Error && err.message === "no_galleries_to_export") {
        return reply.status(400).send({
          error: "no_galleries",
          message: "Keine Galerien zum Exportieren.",
        });
      }
      throw err;
    }
  });

  // -------------------------------------------------------------------------
  // Studio: GET /exports — Liste
  // -------------------------------------------------------------------------
  app.get("/exports", async (req) => {
    req.requireAuth();
    const exports = await prisma.tenantExport.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        _count: { select: { items: true } },
      },
    });
    return {
      exports: exports.map((e) => ({
        id: e.id,
        source: e.source,
        status: e.status,
        itemCount: e._count.items,
        expiresAt: e.expiresAt,
        createdAt: e.createdAt,
      })),
    };
  });

  // -------------------------------------------------------------------------
  // Studio: GET /exports/:id — Detail mit Item-Status + Download-URLs
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    "/exports/:id",
    async (req, reply) => {
      req.requireAuth();
      const exp = await prisma.tenantExport.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
        include: {
          items: { orderBy: { createdAt: "asc" } },
        },
      });
      if (!exp) return reply.status(404).send({ error: "not_found" });

      // Download-URLs nur für ready-Items signieren. Andere haben
      // noch keine storageKey.
      const items = await Promise.all(
        exp.items.map(async (it) => {
          let downloadUrl: string | null = null;
          if (it.status === "ready" && it.storageKey) {
            downloadUrl = await presignGet({
              key: it.storageKey,
              // 1h reicht — User soll im UI klicken und runterladen,
              // nicht Bookmark setzen. Längere Links sind Sicherheits-
              // risiko (geleakte URL = freier Zugriff).
              ttlSeconds: 3600,
              responseContentDisposition: `attachment; filename="${sanitizeFilenameForHeader(it.gallerySlug)}.zip"`,
            });
          }
          return {
            id: it.id,
            galleryId: it.galleryId,
            gallerySlug: it.gallerySlug,
            galleryName: it.galleryName,
            status: it.status,
            sizeBytes: it.sizeBytes ? Number(it.sizeBytes) : null,
            fileCount: it.fileCount,
            errorMessage: it.errorMessage,
            downloadUrl,
            createdAt: it.createdAt,
            updatedAt: it.updatedAt,
          };
        })
      );

      return {
        export: {
          id: exp.id,
          source: exp.source,
          status: exp.status,
          expiresAt: exp.expiresAt,
          createdAt: exp.createdAt,
          items,
        },
      };
    }
  );

  // -------------------------------------------------------------------------
  // Studio: DELETE /exports/:id — manuell löschen
  // -------------------------------------------------------------------------
  // Loescht DB-Rows. S3-Files werden NICHT direkt geloescht — der
  // 30-Tage-Cleanup räumt eh nach Ablauf. Wenn ein User absichtlich
  // delete'en will (z.B. um Speicherplatz freizugeben), könnte man
  // einen Worker-Job triggern; das ist aktuell nicht implementiert.
  app.delete<{ Params: { id: string } }>(
    "/exports/:id",
    async (req, reply) => {
      const s = req.requireAuth();
      const exp = await prisma.tenantExport.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
      });
      if (!exp) return reply.status(404).send({ error: "not_found" });
      await prisma.tenantExport.delete({ where: { id: exp.id } });
      await logEvent({
        tenantId: req.tenantId,
        actorType: "user",
        actorId: s.user.id,
        action: "export.delete",
        targetType: "tenant_export",
        targetId: exp.id,
        ipAddress: req.ip,
      });
      return reply.status(204).send();
    }
  );

  // -------------------------------------------------------------------------
  // Public: GET /e/:token — Token-Lookup, Export-Detail liefern
  // -------------------------------------------------------------------------
  // Kein Login erforderlich. Token ist 32-Byte-Random — Brute-Force-
  // sicher genug, dass wir keine Rate-Limits brauchen.
  app.get<{ Params: { token: string } }>(
    "/e/:token",
    async (req, reply) => {
      const tok = await prisma.exportToken.findUnique({
        where: { token: req.params.token },
        include: {
          export: {
            include: {
              items: { orderBy: { createdAt: "asc" } },
              tenant: { select: { id: true, name: true, slug: true } },
            },
          },
        },
      });
      if (!tok) return reply.status(404).send({ error: "not_found" });
      if (tok.expiresAt < new Date()) {
        return reply.status(410).send({ error: "expired" });
      }

      // Access-Tracking — nicht-blockierend, der Update muss nicht
      // synchron laufen. Best-effort; bei DB-Fehler ignorieren.
      void prisma.exportToken
        .update({
          where: { id: tok.id },
          data: {
            accessCount: { increment: 1 },
            firstAccessAt: tok.firstAccessAt ?? new Date(),
          },
        })
        .catch(() => {});

      // Items zurückliefern OHNE Download-URLs — Token-Download geht
      // über separaten Endpoint (siehe unten), der bei jedem Klick
      // frisch signiert.
      return {
        tenant: tok.export.tenant,
        export: {
          id: tok.export.id,
          status: tok.export.status,
          expiresAt: tok.export.expiresAt,
          createdAt: tok.export.createdAt,
          items: tok.export.items.map((it) => ({
            id: it.id,
            gallerySlug: it.gallerySlug,
            galleryName: it.galleryName,
            status: it.status,
            sizeBytes: it.sizeBytes ? Number(it.sizeBytes) : null,
            fileCount: it.fileCount,
            errorMessage: it.errorMessage,
          })),
        },
      };
    }
  );

  // -------------------------------------------------------------------------
  // Public: GET /e/:token/items/:itemId/download
  // -------------------------------------------------------------------------
  // 302-Redirect auf eine frisch signierte S3-URL. Direktes Streaming
  // durch die API wäre Bandbreitenverschwendung — wir lassen den Browser
  // direkt von S3 ziehen.
  app.get<{ Params: { token: string; itemId: string } }>(
    "/e/:token/items/:itemId/download",
    async (req, reply) => {
      const tok = await prisma.exportToken.findUnique({
        where: { token: req.params.token },
        include: { export: true },
      });
      if (!tok) return reply.status(404).send({ error: "not_found" });
      if (tok.expiresAt < new Date()) {
        return reply.status(410).send({ error: "expired" });
      }
      const item = await prisma.tenantExportItem.findFirst({
        where: { id: req.params.itemId, exportId: tok.exportId },
      });
      if (!item) return reply.status(404).send({ error: "not_found" });
      if (item.status !== "ready" || !item.storageKey) {
        return reply.status(409).send({ error: "not_ready" });
      }
      const url = await presignGet({
        key: item.storageKey,
        ttlSeconds: 600,
        responseContentDisposition: `attachment; filename="${sanitizeFilenameForHeader(item.gallerySlug)}.zip"`,
      });
      return reply.redirect(url, 302);
    }
  );
}

/** Sanitisiert einen Filename für den Content-Disposition-Header.
 *  Quotes + Control-Chars raus, Rest unverändert. */
function sanitizeFilenameForHeader(name: string): string {
  return name.replace(/["\\\r\n\t]/g, "_").slice(0, 100);
}
