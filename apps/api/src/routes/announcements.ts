/**
 * Lumio API — System-Announcements
 *
 * Banner die in jedem Studio angezeigt werden. Routen:
 *
 * Public (kein Auth):
 *   GET /announcements/active        — aktive Banner, vom Studio gepollt
 *
 * Super-Admin:
 *   GET    /super/announcements      — Liste aller (aktiv + zukunft + vergangen)
 *   POST   /super/announcements      — neuen Banner anlegen
 *   PATCH  /super/announcements/:id  — Banner aendern
 *   DELETE /super/announcements/:id  — Banner loeschen
 *
 * Bewusst KEIN Tenant-Targeting im MVP — das wuerde Multi-Select-UI
 * erfordern und Filter-Logik in der Public-API. Bei Bedarf spaeter
 * ergaenzen (z.B. nur fuer bestimmte Plans).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { logEvent } from "../services/audit.js";

const severityEnum = z.enum(["info", "warning", "critical"]);

const createSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(2000),
  severity: severityEnum.default("info"),
  activeFrom: z.string().datetime().nullable().optional(),
  activeUntil: z.string().datetime().nullable().optional(),
  dismissible: z.boolean().default(true),
});

const updateSchema = createSchema.partial();

export async function registerAnnouncementRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // Public: GET /announcements/active
  // -------------------------------------------------------------------------
  // Wird vom Studio gepollt (ca. alle 5 Min). Liefert nur aktive Banner:
  // activeFrom <= now AND (activeUntil IS NULL OR activeUntil > now).
  // Keine sensiblen Daten — keine Auth-Pflicht.
  app.get("/announcements/active", async () => {
    const now = new Date();
    const rows = await prisma.systemAnnouncement.findMany({
      where: {
        AND: [
          { OR: [{ activeFrom: null }, { activeFrom: { lte: now } }] },
          { OR: [{ activeUntil: null }, { activeUntil: { gt: now } }] },
        ],
      },
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        body: true,
        severity: true,
        dismissible: true,
        activeUntil: true,
        createdAt: true,
      },
    });
    return { announcements: rows };
  });

  // -------------------------------------------------------------------------
  // Super-Admin: GET /super/announcements
  // -------------------------------------------------------------------------
  app.get("/super/announcements", async (req) => {
    req.requireSuperAdmin();
    const rows = await prisma.systemAnnouncement.findMany({
      orderBy: { createdAt: "desc" },
    });
    return { announcements: rows };
  });

  // -------------------------------------------------------------------------
  // POST /super/announcements
  // -------------------------------------------------------------------------
  app.post("/super/announcements", async (req, reply) => {
    const sa = req.requireSuperAdmin();
    const body = createSchema.parse(req.body);

    const row = await prisma.systemAnnouncement.create({
      data: {
        title: body.title,
        body: body.body,
        severity: body.severity,
        activeFrom: body.activeFrom ? new Date(body.activeFrom) : null,
        activeUntil: body.activeUntil ? new Date(body.activeUntil) : null,
        dismissible: body.dismissible,
        createdById: sa.admin.id,
        createdByEmail: sa.admin.email,
      },
    });

    await logEvent({
      tenantId: null,
      actorType: "super_admin",
      actorId: sa.admin.id,
      action: "super.announcement.create",
      targetType: "announcement",
      targetId: row.id,
      payload: {
        severity: body.severity,
        title: body.title,
      },
      ipAddress: req.ip,
    });

    return reply.status(201).send({ announcement: row });
  });

  // -------------------------------------------------------------------------
  // PATCH /super/announcements/:id
  // -------------------------------------------------------------------------
  app.patch<{ Params: { id: string } }>(
    "/super/announcements/:id",
    async (req, reply) => {
      const sa = req.requireSuperAdmin();
      const body = updateSchema.parse(req.body);

      const existing = await prisma.systemAnnouncement.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) return reply.status(404).send({ error: "not_found" });

      const row = await prisma.systemAnnouncement.update({
        where: { id: req.params.id },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.body !== undefined ? { body: body.body } : {}),
          ...(body.severity !== undefined ? { severity: body.severity } : {}),
          ...(body.activeFrom !== undefined
            ? { activeFrom: body.activeFrom ? new Date(body.activeFrom) : null }
            : {}),
          ...(body.activeUntil !== undefined
            ? {
                activeUntil: body.activeUntil
                  ? new Date(body.activeUntil)
                  : null,
              }
            : {}),
          ...(body.dismissible !== undefined
            ? { dismissible: body.dismissible }
            : {}),
        },
      });

      await logEvent({
        tenantId: null,
        actorType: "super_admin",
        actorId: sa.admin.id,
        action: "super.announcement.update",
        targetType: "announcement",
        targetId: row.id,
        payload: body,
        ipAddress: req.ip,
      });

      return { announcement: row };
    }
  );

  // -------------------------------------------------------------------------
  // DELETE /super/announcements/:id
  // -------------------------------------------------------------------------
  app.delete<{ Params: { id: string } }>(
    "/super/announcements/:id",
    async (req, reply) => {
      const sa = req.requireSuperAdmin();
      const existing = await prisma.systemAnnouncement.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) return reply.status(404).send({ error: "not_found" });

      await prisma.systemAnnouncement.delete({ where: { id: req.params.id } });

      await logEvent({
        tenantId: null,
        actorType: "super_admin",
        actorId: sa.admin.id,
        action: "super.announcement.delete",
        targetType: "announcement",
        targetId: req.params.id,
        payload: {},
        ipAddress: req.ip,
      });

      return { ok: true };
    }
  );
}
