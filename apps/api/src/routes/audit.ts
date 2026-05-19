/**
 * Lumio API — Audit Routes
 *
 *   GET /events  — Studio-seitige Audit-Log-Liste, paginiert, filterbar.
 *
 * Sichtbar nur für eingeloggte Studio-User. Wir liefern Events nur aus
 * dem eigenen Tenant — auch Owner sehen NICHT die Events anderer Tenants.
 *
 * Filter:
 *   galleryId?  — nur Events, die diese Galerie betreffen (targetId-Match
 *                 ODER payload.galleryId-Match — letzteres weil viele
 *                 Events das Galerie-ID nur im Payload tragen)
 *   action?     — exakter Match
 *   since?      — ISO-Datum, inclusive
 *   until?      — ISO-Datum, exclusive
 *   limit       — default 100, max 500
 *   cursor?     — opaker Cursor für nächste Seite (createdAt+id)
 *
 * Pagination per (createdAt, id) — beide DESC. Ergebnis enthält ggf.
 * nextCursor. Index `(tenantId, createdAt)` ist vorhanden.
 */
import type { FastifyInstance } from "fastify";

import { prisma } from "../db.js";

interface AuditCursor {
  c: string; // createdAt ISO
  i: string; // event id
}

function encodeCursor(cur: AuditCursor): string {
  return Buffer.from(JSON.stringify(cur), "utf8").toString("base64url");
}

function decodeCursor(raw: string): AuditCursor | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8")
    ) as Partial<AuditCursor>;
    if (!parsed.c || !parsed.i) return null;
    return { c: parsed.c, i: parsed.i };
  } catch {
    return null;
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function registerAuditRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: {
      galleryId?: string;
      action?: string;
      since?: string;
      until?: string;
      limit?: string;
      cursor?: string;
    };
  }>("/events", async (req, reply) => {
    req.requireAuth();

    const q = req.query;
    const galleryId =
      typeof q.galleryId === "string" && UUID_RE.test(q.galleryId)
        ? q.galleryId
        : undefined;
    const action =
      typeof q.action === "string" && q.action.length > 0 && q.action.length < 100
        ? q.action
        : undefined;
    const since = q.since ? new Date(q.since) : undefined;
    const until = q.until ? new Date(q.until) : undefined;
    if (
      (since && isNaN(since.getTime())) ||
      (until && isNaN(until.getTime()))
    ) {
      return reply.status(400).send({ error: "bad_date" });
    }

    const limit = Math.min(500, Math.max(1, parseInt(q.limit ?? "100", 10) || 100));
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;

    // Wir bauen das Where-Object manuell, weil galleryId zwei mögliche
    // Match-Felder hat (targetId direkt für Aktionen wie gallery.create,
    // oder payload.galleryId für Aktionen, die eine andere Resource
    // mutieren aber zur Galerie gehören wie file.delete).
    const baseWhere: import("@prisma/client").Prisma.EventWhereInput = {
      tenantId: req.tenantId,
      ...(action ? { action } : {}),
      ...(since || until
        ? {
            createdAt: {
              ...(since ? { gte: since } : {}),
              ...(until ? { lt: until } : {}),
            },
          }
        : {}),
      ...(galleryId
        ? {
            OR: [
              { targetType: "gallery", targetId: galleryId },
              { payload: { path: ["galleryId"], equals: galleryId } },
            ],
          }
        : {}),
    };

    // Cursor: alles strikt VOR (createdAt, id) der Cursor-Position.
    // Tie-Break über id, sodass identische createdAts deterministisch
    // weiter-paginiert werden.
    const where: import("@prisma/client").Prisma.EventWhereInput = cursor
      ? {
          AND: [
            baseWhere,
            {
              OR: [
                { createdAt: { lt: new Date(cursor.c) } },
                {
                  AND: [
                    { createdAt: new Date(cursor.c) },
                    { id: { lt: cursor.i } },
                  ],
                },
              ],
            },
          ],
        }
      : baseWhere;

    const rows = await prisma.event.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        actorType: true,
        actorId: true,
        action: true,
        targetType: true,
        targetId: true,
        payload: true,
        ipAddress: true,
        createdAt: true,
      },
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ c: last.createdAt.toISOString(), i: last.id })
        : null;

    return {
      events: items.map((e) => ({
        id: e.id,
        actorType: e.actorType,
        actorId: e.actorId,
        action: e.action,
        targetType: e.targetType,
        targetId: e.targetId,
        payload: e.payload,
        ipAddress: e.ipAddress,
        createdAt: e.createdAt,
      })),
      nextCursor,
    };
  });
}
