/**
 * Lumio API — Plugin-API
 *
 * Plugin-freundliche Endpoints, die mit `Authorization: Bearer <token>`
 * statt Cookies arbeiten. Technisch funktioniert auch jeder andere
 * Studio-Endpoint per Bearer-Token, aber diese Routen liefern eine
 * stabilere, vereinfachte Form, damit das Lightroom-Plugin sich nicht
 * ändern muss, wenn wir die Studio-API erweitern.
 *
 *   GET /plugin/version
 *     → { ok: true, apiVersion: "1" }   — Healthcheck + Versionspin
 *
 *   GET /plugin/galleries
 *     → { galleries: [{id, slug, title, mode, fileCount}] }
 *
 *   GET /plugin/galleries/:id/selection
 *     → { gallery, files: [{filename, sha256?, picked, liked, color, rating}] }
 *
 * Datenformat orientiert sich am späteren Lua-Plugin: file.filename ist der
 * ORIGINAL-Dateiname, an dem das Plugin lokale Lightroom-Catalog-Einträge
 * matcht. sha256 ist optional — wird bei Upload nicht erfasst (zu teuer
 * im Browser bei großen Files), aber das Plugin kann ohne klarkommen.
 */
import type { FastifyInstance } from "fastify";

import { prisma } from "../db.js";

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
