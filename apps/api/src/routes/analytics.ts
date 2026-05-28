/**
 * Lumio API — Analytics-Routes (Advanced Analytics)
 *
 * Feature-Flag-gated: 'advanced_analytics' muss aktiv sein. Wenn nicht:
 * alle Routes liefern 404 (komplett unsichtbar).
 *
 * Basic-Stats pro Galerie gibt's separat unter /galleries/:id/stats —
 * das laeuft fuer alle Tenants. Was hier in /analytics passiert ist die
 * Tenant-Level-Aggregation und Engagement-Funnel-Analyse — die teurere
 * Sicht, die nur Pro-Plaene haben.
 *
 * Endpoints:
 *   GET /analytics/overview
 *     Tenant-Dashboard: Total-Counts ueber alle Galerien + Trends
 *
 *   GET /analytics/galleries/:id/funnel
 *     Engagement-Funnel fuer eine Galerie: Visits → Engaged → Converted
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

import { prisma } from "../db.js";
import { isFeatureEnabled } from "../services/feature-flags.js";

const DAYS_DEFAULT = 30;
const DAYS_MAX = 365;

export async function registerAnalyticsRoutes(app: FastifyInstance) {
  // Pre-Handler: Feature-Flag-Check. Wenn nicht aktiv → 404 fuer alle
  // /analytics/*-Routes. Damit ist der gesamte Endpunkt-Surface unsichtbar
  // ohne Plan.
  async function requireFeature(
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<boolean> {
    req.requireAuth();
    const enabled = await isFeatureEnabled(req.tenantId!, "advanced_analytics");
    if (!enabled) {
      reply.status(404).send({ error: "not_found" });
      return false;
    }
    return true;
  }

  // ============================================================================
  // GET /analytics/overview
  // ============================================================================
  // Tenant-weite Aggregation. Pragmatisch in einem Roundtrip, mehrere
  // Queries parallel via Promise.all.
  app.get<{ Querystring: { days?: string } }>(
    "/analytics/overview",
    async (req, reply) => {
      if (!(await requireFeature(req, reply))) return;
      const days = Math.min(
        DAYS_MAX,
        Math.max(1, parseInt(req.query.days ?? String(DAYS_DEFAULT), 10) || DAYS_DEFAULT)
      );
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const tenantId = req.tenantId!;

      const [
        totalGalleries,
        totalFiles,
        visitsTotal,
        likesTotal,
        commentsTotal,
        finalizedTotal,
        printOrdersTotal,
        dailyVisits,
        dailyLikes,
        topByVisits,
        topByLikes,
        printRevenue,
      ] = await Promise.all([
        // Statische Counts (nicht zeitbeschraenkt)
        prisma.gallery.count({ where: { tenantId } }),
        prisma.file.count({
          where: { gallery: { tenantId } },
        }),

        // Visits = share.unlock-Events
        prisma.event.count({
          where: {
            tenantId,
            action: "share.unlock",
            targetType: "gallery",
            createdAt: { gte: since },
          },
        }),

        // Likes
        prisma.selection.count({
          where: {
            liked: true,
            file: { gallery: { tenantId } },
            createdAt: { gte: since },
          },
        }),

        // Comments
        prisma.comment.count({
          where: {
            file: { gallery: { tenantId } },
            createdAt: { gte: since },
          },
        }),

        // Finalized Selections (Engagement-Konversion 'Auswahl fertig')
        prisma.galleryAccess.count({
          where: {
            gallery: { tenantId },
            finalizedAt: { gte: since },
          },
        }),

        // Print-Shop-Orders (nur wenn Feature aktiv — sonst Tabelle leer)
        prisma.printOrder.count({
          where: {
            tenantId,
            createdAt: { gte: since },
            status: { in: ["paid", "in_production", "shipped", "delivered"] },
          },
        }),

        // Daily-Visits-Chart (Zeitserie)
        prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
          SELECT DATE_TRUNC('day', "createdAt") AS day, COUNT(*)::bigint AS count
          FROM events
          WHERE "tenantId" = ${tenantId}::uuid
            AND action = 'share.unlock'
            AND "targetType" = 'gallery'
            AND "createdAt" >= ${since}
          GROUP BY day
          ORDER BY day ASC
        `,

        // Daily-Likes-Chart
        prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
          SELECT DATE_TRUNC('day', s."createdAt") AS day, COUNT(*)::bigint AS count
          FROM selections s
          JOIN files f ON f.id = s."fileId"
          JOIN galleries g ON g.id = f."galleryId"
          WHERE g."tenantId" = ${tenantId}::uuid
            AND s.liked = true
            AND s."createdAt" >= ${since}
          GROUP BY day
          ORDER BY day ASC
        `,

        // Top 5 Galerien nach Visits
        prisma.$queryRaw<
          Array<{ galleryId: string; title: string; slug: string; visits: bigint }>
        >`
          SELECT g.id AS "galleryId", g.title, g.slug, COUNT(e.id)::bigint AS visits
          FROM galleries g
          LEFT JOIN events e
            ON e."targetId" = g.id
            AND e.action = 'share.unlock'
            AND e."targetType" = 'gallery'
            AND e."createdAt" >= ${since}
          WHERE g."tenantId" = ${tenantId}::uuid
          GROUP BY g.id, g.title, g.slug
          ORDER BY visits DESC NULLS LAST
          LIMIT 5
        `,

        // Top 5 Galerien nach Likes
        prisma.$queryRaw<
          Array<{ galleryId: string; title: string; slug: string; likes: bigint }>
        >`
          SELECT g.id AS "galleryId", g.title, g.slug, COUNT(s.id)::bigint AS likes
          FROM galleries g
          LEFT JOIN files f ON f."galleryId" = g.id
          LEFT JOIN selections s
            ON s."fileId" = f.id AND s.liked = true
            AND s."createdAt" >= ${since}
          WHERE g."tenantId" = ${tenantId}::uuid
          GROUP BY g.id, g.title, g.slug
          ORDER BY likes DESC NULLS LAST
          LIMIT 5
        `,

        // Print-Shop-Revenue (Brutto-Total von paid+ Orders)
        prisma.printOrder.aggregate({
          where: {
            tenantId,
            createdAt: { gte: since },
            status: { in: ["paid", "in_production", "shipped", "delivered"] },
          },
          _sum: { totalCents: true },
        }),
      ]);

      // Storage-Trend: kumulative Summe der File-sizeBytes ueber Zeit.
      // Wir bucketten in Wochen damit das Chart bei langen Zeitraeumen
      // nicht 365 Punkte hat.
      const bucketDays = days > 90 ? 7 : 1;
      const storageTrendRaw = await prisma.$queryRawUnsafe<
        Array<{ day: Date; bytes: bigint }>
      >(`
        SELECT DATE_TRUNC('${bucketDays > 1 ? "week" : "day"}', "createdAt") AS day,
               SUM("sizeBytes")::bigint AS bytes
        FROM files
        JOIN galleries ON galleries.id = files."galleryId"
        WHERE galleries."tenantId" = $1::uuid
          AND files."createdAt" >= $2
        GROUP BY day
        ORDER BY day ASC
      `, tenantId, since);
      // Kumulieren
      let cumulative = 0;
      const storageTrend = storageTrendRaw.map((row) => {
        cumulative += Number(row.bytes);
        return { day: row.day, bytesAdded: Number(row.bytes), cumulative };
      });

      return {
        range: { days, since: since.toISOString() },
        totals: {
          galleries: totalGalleries,
          files: totalFiles,
          visits: visitsTotal,
          likes: likesTotal,
          comments: commentsTotal,
          finalizedSelections: finalizedTotal,
          printOrders: printOrdersTotal,
          printRevenueCents: Number(printRevenue._sum.totalCents ?? 0n),
        },
        trends: {
          dailyVisits: dailyVisits.map((d) => ({
            day: d.day,
            count: Number(d.count),
          })),
          dailyLikes: dailyLikes.map((d) => ({
            day: d.day,
            count: Number(d.count),
          })),
          storage: storageTrend,
        },
        top: {
          byVisits: topByVisits.map((r) => ({
            galleryId: r.galleryId,
            title: r.title,
            slug: r.slug,
            visits: Number(r.visits),
          })),
          byLikes: topByLikes.map((r) => ({
            galleryId: r.galleryId,
            title: r.title,
            slug: r.slug,
            likes: Number(r.likes),
          })),
        },
      };
    }
  );

  // ============================================================================
  // GET /analytics/galleries/:id/funnel
  // ============================================================================
  // Engagement-Funnel pro Galerie:
  //   1. Visitors    — eindeutige share.unlock-Events (per actorId,
  //                     Anonymous = 1 pro NULL)
  //   2. Engaged     — Visitors die mind. 1 Like/Pick/Comment hatten
  //   3. Finalized   — Visitors die ihre Auswahl finalisiert haben
  //   4. Converted   — Visitors die eine Print-Order ausgeloest haben
  //                     (wenn Print-Shop aktiv ist; sonst weggelassen)
  app.get<{ Params: { id: string }; Querystring: { days?: string } }>(
    "/analytics/galleries/:id/funnel",
    async (req, reply) => {
      if (!(await requireFeature(req, reply))) return;
      const days = Math.min(
        DAYS_MAX,
        Math.max(1, parseInt(req.query.days ?? String(DAYS_DEFAULT), 10) || DAYS_DEFAULT)
      );
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const tenantId = req.tenantId!;

      const gallery = await prisma.gallery.findFirst({
        where: { id: req.params.id, tenantId },
        select: { id: true },
      });
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const galleryId = gallery.id;

      const [visitorRows, engagedRows, finalizedCount, printOrdersCount] =
        await Promise.all([
          // Eindeutige Visitors via DISTINCT actorId aus share.unlock
          prisma.$queryRaw<Array<{ visitors: bigint }>>`
            SELECT COUNT(DISTINCT COALESCE("actorId"::text, "ipAddress")) AS visitors
            FROM events
            WHERE "tenantId" = ${tenantId}::uuid
              AND action = 'share.unlock'
              AND "targetType" = 'gallery'
              AND "targetId" = ${galleryId}::uuid
              AND "createdAt" >= ${since}
          `,

          // Engaged = die einen Eintrag in selections oder comments haben
          prisma.$queryRaw<Array<{ engaged: bigint }>>`
            SELECT COUNT(DISTINCT engaged_actor) AS engaged
            FROM (
              SELECT s."accessId" AS engaged_actor
              FROM selections s
              JOIN files f ON f.id = s."fileId"
              WHERE f."galleryId" = ${galleryId}::uuid
                AND s."createdAt" >= ${since}
                AND (s.liked = true OR s.status = 'pick')
              UNION
              SELECT c."accessId" AS engaged_actor
              FROM comments c
              JOIN files f ON f.id = c."fileId"
              WHERE f."galleryId" = ${galleryId}::uuid
                AND c."createdAt" >= ${since}
            ) sub
            WHERE engaged_actor IS NOT NULL
          `,

          prisma.galleryAccess.count({
            where: {
              galleryId,
              finalizedAt: { gte: since },
            },
          }),

          prisma.printOrder.count({
            where: {
              galleryId,
              createdAt: { gte: since },
              status: { in: ["paid", "in_production", "shipped", "delivered"] },
            },
          }),
        ]);

      const visitors = Number(visitorRows[0]?.visitors ?? 0n);
      const engaged = Number(engagedRows[0]?.engaged ?? 0n);

      return {
        range: { days, since: since.toISOString() },
        steps: [
          { key: "visitors", label: "Besucher", count: visitors },
          {
            key: "engaged",
            label: "Engagiert (Like/Pick/Kommentar)",
            count: engaged,
          },
          {
            key: "finalized",
            label: "Auswahl finalisiert",
            count: finalizedCount,
          },
          {
            key: "converted",
            label: "Bestellung aufgegeben",
            count: printOrdersCount,
          },
        ],
      };
    }
  );
}
