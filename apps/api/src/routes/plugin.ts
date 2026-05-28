/**
 * Lumio API — Plugin-API
 *
 * Plugin-freundliche Endpoints, die mit `Authorization: Bearer <token>`
 * statt Cookies arbeiten. Technisch funktioniert auch jeder andere
 * Studio-Endpoint per Bearer-Token, aber diese Routen liefern eine
 * stabilere, vereinfachte Form, damit das Lightroom-Plugin sich nicht
 * ändern muss, wenn wir die Studio-API erweitern.
 *
 * Read-Side (Selection-Import → Lightroom-Katalog):
 *   GET /plugin/version
 *   GET /plugin/galleries
 *   GET /plugin/galleries/:id/selection
 *
 * Write-Side (Publish-Service: Lightroom → Lumio):
 *   POST   /plugin/galleries                      — Galerie anlegen
 *   PATCH  /plugin/galleries/:id                  — Title/Mode/Status updaten
 *   GET    /plugin/galleries/:id/files            — Was schon hochgeladen ist
 *   DELETE /plugin/galleries/:id/files/:fileId    — File loeschen (re-publish)
 *
 * Datenformat orientiert sich am Lua-Plugin: file.filename ist der
 * ORIGINAL-Dateiname, an dem das Plugin lokale Lightroom-Catalog-
 * Einträge matcht. sha256 ist optional — wird bei Upload nicht
 * erfasst (zu teuer im Browser bei großen Files), aber das Plugin
 * kann ohne klarkommen.
 *
 * Upload selbst laeuft ueber die regulaeren /uploads/init + /uploads/
 * complete Routen — die akzeptieren bereits Bearer-Token-Auth. Das
 * Lua-Plugin muss also kein eigenes Upload-Protokoll implementieren.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { generateGallerySlug } from "../services/ids.js";
import { logEvent } from "../services/audit.js";
import { deleteObject } from "../services/storage.js";
import { invalidateZipCacheForGallery } from "../services/zip-cache.js";

const API_VERSION = "1";

export async function registerPluginRoutes(app: FastifyInstance) {
  app.get("/plugin/version", async (req) => {
    // Auth erforderlich, damit das Plugin den Token-Healthcheck machen kann
    req.requireAuth();
    return { ok: true, apiVersion: API_VERSION };
  });

  app.get("/plugin/galleries", async (req) => {
    const s = req.requireAuth();
    const galleries = await prisma.gallery.findMany({
      where: { tenantId: req.tenantId, ownerId: s.user.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        slug: true,
        title: true,
        mode: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { files: true } },
      },
    });
    return {
      galleries: galleries.map((g) => ({
        id: g.id,
        slug: g.slug,
        title: g.title,
        mode: g.mode,
        status: g.status,
        fileCount: g._count.files,
        createdAt: g.createdAt,
        updatedAt: g.updatedAt,
      })),
    };
  });

  // ---------------------------------------------------------------------------
  // POST /plugin/galleries — neue Galerie anlegen (vom Plugin aus)
  // ---------------------------------------------------------------------------
  // Das LR-Plugin laesst den Fotograf direkt aus Lightroom eine neue
  // Galerie erstellen, wenn er noch keine hat. Pro Publish-Collection
  // genau eine Galerie. Schluessel-Felder werden gesetzt, der Rest
  // landet auf Defaults; im Studio kann der Fotograf alles weiter
  // anpassen (Header-Customization, Branding, etc.).
  const createSchema = z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    mode: z.enum(["collaboration", "presentation"]).optional(),
  });
  app.post("/plugin/galleries", async (req, reply) => {
    const s = req.requireAuth();
    const body = createSchema.parse(req.body);
    const slug = generateGallerySlug();
    const gallery = await prisma.gallery.create({
      data: {
        tenantId: req.tenantId!,
        ownerId: s.user.id,
        slug,
        title: body.title,
        description: body.description ?? null,
        mode: body.mode ?? "collaboration",
        // Bei Plugin-Create starten wir in 'draft' — der Fotograf
        // wechselt es manuell zu 'live' wenn er fertig ist (oder im
        // Plugin via PATCH).
        status: "draft",
      },
      select: {
        id: true,
        slug: true,
        title: true,
        mode: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    await logEvent({
      tenantId: req.tenantId!,
      actorType: "user",
      actorId: s.user.id,
      action: "gallery.created",
      targetType: "gallery",
      targetId: gallery.id,
      payload: { source: "plugin", title: body.title },
      ipAddress: req.ip,
    });
    return reply.status(201).send({ gallery: { ...gallery, fileCount: 0 } });
  });

  // ---------------------------------------------------------------------------
  // PATCH /plugin/galleries/:id — Title/Mode/Status updaten
  // ---------------------------------------------------------------------------
  // Plugin kann nach Upload den Status auf 'live' schalten, oder die
  // Description-Felder befuellen. Alles andere (Branding, Hero, etc.)
  // bleibt dem Studio-UI vorbehalten — Plugin haelt sich an die
  // wichtigsten Felder.
  const patchSchema = z.object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    mode: z.enum(["collaboration", "presentation"]).optional(),
    status: z.enum(["draft", "live", "archived"]).optional(),
  });
  app.patch<{ Params: { id: string } }>(
    "/plugin/galleries/:id",
    async (req, reply) => {
      const s = req.requireAuth();
      const body = patchSchema.parse(req.body);
      const existing = await prisma.gallery.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId, ownerId: s.user.id },
        select: { id: true },
      });
      if (!existing) return reply.status(404).send({ error: "not_found" });
      const updated = await prisma.gallery.update({
        where: { id: existing.id },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.description !== undefined
            ? { description: body.description }
            : {}),
          ...(body.mode !== undefined ? { mode: body.mode } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
        },
        select: {
          id: true,
          slug: true,
          title: true,
          mode: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { files: true } },
        },
      });
      return {
        gallery: {
          id: updated.id,
          slug: updated.slug,
          title: updated.title,
          mode: updated.mode,
          status: updated.status,
          fileCount: updated._count.files,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        },
      };
    }
  );

  // ---------------------------------------------------------------------------
  // GET /plugin/galleries/:id/files — was schon hochgeladen ist
  // ---------------------------------------------------------------------------
  // Damit das Plugin Sync-Logic machen kann: 'welche meiner LR-Photos
  // sind schon in der Lumio-Galerie?'. Match-Schluessel: SHA-256 (wenn
  // im Plugin ermittelbar) ODER Filename. Beide werden ausgeliefert.
  app.get<{ Params: { id: string } }>(
    "/plugin/galleries/:id/files",
    async (req, reply) => {
      const s = req.requireAuth();
      const gallery = await prisma.gallery.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId, ownerId: s.user.id },
        select: { id: true },
      });
      if (!gallery) return reply.status(404).send({ error: "not_found" });
      const files = await prisma.file.findMany({
        where: { galleryId: gallery.id },
        orderBy: { sortIndex: "asc" },
        select: {
          id: true,
          originalFilename: true,
          sha256: true,
          sizeBytes: true,
          mimeType: true,
          kind: true,
          status: true,
          width: true,
          height: true,
          createdAt: true,
        },
      });
      return {
        files: files.map((f) => ({
          id: f.id,
          filename: f.originalFilename,
          sha256: f.sha256,
          sizeBytes: Number(f.sizeBytes),
          mimeType: f.mimeType,
          kind: f.kind,
          status: f.status,
          width: f.width,
          height: f.height,
          createdAt: f.createdAt,
        })),
      };
    }
  );

  // ---------------------------------------------------------------------------
  // DELETE /plugin/galleries/:id/files/:fileId — File entfernen
  // ---------------------------------------------------------------------------
  // Re-Publish-Workflow: das Plugin entfernt zuerst das alte File und
  // legt dann das neue an. Alternative waere Update-in-place, aber das
  // bricht bei Filename-Aenderungen und macht Watermark-/Rendition-
  // Refresh ungueltig. Delete + Recreate ist sauberer.
  app.delete<{ Params: { id: string; fileId: string } }>(
    "/plugin/galleries/:id/files/:fileId",
    async (req, reply) => {
      const s = req.requireAuth();
      const gallery = await prisma.gallery.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId, ownerId: s.user.id },
        select: { id: true },
      });
      if (!gallery) return reply.status(404).send({ error: "not_found" });
      const file = await prisma.file.findFirst({
        where: { id: req.params.fileId, galleryId: gallery.id },
        include: { renditions: { select: { storageKey: true } } },
      });
      if (!file) return reply.status(404).send({ error: "not_found" });

      // S3-Cleanup: Original + alle Renditions. Tolerant — wenn ein
      // Object nicht existiert (z.B. weil Upload nicht durchlief),
      // weitermachen, der DB-Delete ist wichtiger.
      const keysToDelete = [file.storageKey, ...file.renditions.map((r) => r.storageKey)];
      await Promise.allSettled(keysToDelete.map((key) => deleteObject(key)));

      await prisma.file.delete({ where: { id: file.id } });
      await invalidateZipCacheForGallery(gallery.id);
      await logEvent({
        tenantId: req.tenantId!,
        actorType: "user",
        actorId: s.user.id,
        action: "file.deleted",
        targetType: "file",
        targetId: file.id,
        payload: { source: "plugin", galleryId: gallery.id },
        ipAddress: req.ip,
      });
      return reply.status(204).send();
    }
  );

  // ---------------------------------------------------------------------------
  // GET /plugin/galleries/:id/selection (Read-Side — unveraendert)
  // ---------------------------------------------------------------------------

  app.get<{ Params: { id: string } }>(
    "/plugin/galleries/:id/selection",
    async (req, reply) => {
      const s = req.requireAuth();
      const gallery = await prisma.gallery.findFirst({
        where: {
          id: req.params.id,
          tenantId: req.tenantId,
          ownerId: s.user.id,
        },
        select: { id: true, slug: true, title: true, mode: true },
      });
      if (!gallery) {
        return reply.status(404).send({ error: "not_found" });
      }

      // Alle Files mit aggregierten Selection-Werten. Wir bilden für jeden
      // File die "beste" Auswahl aus ALLEN Access-Tokens:
      //   liked       = ein beliebiger Access hat liked=true
      //   picked      = ein beliebiger Access hat status='pick'
      //   color       = häufigste Color-Wahl (oder null)
      //   rating      = maximale Sterne-Bewertung (oder null)
      //
      // Damit kann das Plugin dem Lightroom-Katalog für jedes Bild eine
      // sinnvolle Entscheidung geben, auch wenn 3 Kunden uneins waren.
      const files = await prisma.file.findMany({
        where: { galleryId: gallery.id, status: "ready" },
        orderBy: { sortIndex: "asc" },
        select: {
          id: true,
          originalFilename: true,
          kind: true,
          sizeBytes: true,
          selections: {
            select: {
              status: true,
              liked: true,
              color: true,
              rating: true,
            },
          },
        },
      });

      const items = files.map((f) => {
        const sels = f.selections;
        const picked = sels.some((s) => s.status === "pick");
        const liked = sels.some((s) => s.liked === true);
        // Farben: zählen, häufigste gewinnt
        const colorCounts: Record<string, number> = {};
        for (const s of sels) {
          if (s.color) colorCounts[s.color] = (colorCounts[s.color] ?? 0) + 1;
        }
        const color =
          Object.entries(colorCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
        const rating =
          sels.reduce<number | null>(
            (acc, s) =>
              s.rating !== null && (acc === null || s.rating > acc)
                ? s.rating
                : acc,
            null
          ) ?? null;
        return {
          fileId: f.id,
          filename: f.originalFilename,
          kind: f.kind,
          sizeBytes: Number(f.sizeBytes),
          picked,
          liked,
          color,
          rating,
        };
      });

      return {
        gallery: {
          id: gallery.id,
          slug: gallery.slug,
          title: gallery.title,
          mode: gallery.mode,
        },
        files: items,
      };
    }
  );
}
