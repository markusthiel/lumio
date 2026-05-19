/**
 * Lumio API — Tenant Settings Routes
 *
 *   GET   /settings              — aktuelle Tenant-Settings
 *   PATCH /settings              — Settings updaten
 *
 * Aktuell nur Watermark-Konfig. Branding, Custom Domain etc. landen
 * später hier — die Tabelle ist schon da.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";

const updateSettingsSchema = z.object({
  watermarkText: z.string().max(200).nullable().optional(),
  // watermarkImageKey kommt später mit einem File-Upload-Endpoint;
  // hier nur lesbar, nicht direkt setzbar.
});

export async function registerSettingsRoutes(app: FastifyInstance) {
  // GET
  app.get("/settings", async (req, reply) => {
    req.requireAuth();
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      select: {
        id: true,
        slug: true,
        name: true,
        watermarkText: true,
        watermarkImageKey: true,
        customDomain: true,
      },
    });
    if (!tenant) return reply.status(404).send({ error: "not_found" });
    return { tenant };
  });

  // PATCH
  app.patch("/settings", async (req, reply) => {
    const s = req.requireAuth();
    // Nur Owner/Admin
    if (s.user.role !== "owner" && s.user.role !== "admin") {
      return reply.status(403).send({ error: "forbidden" });
    }
    const body = updateSettingsSchema.parse(req.body);
    const tenant = await prisma.tenant.update({
      where: { id: req.tenantId },
      data: {
        ...(body.watermarkText !== undefined
          ? { watermarkText: body.watermarkText }
          : {}),
      },
      select: {
        id: true,
        slug: true,
        name: true,
        watermarkText: true,
        watermarkImageKey: true,
      },
    });
    return { tenant };
  });
}
