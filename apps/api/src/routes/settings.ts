/**
 * Lumio API — Tenant Settings Routes
 *
 *   GET   /settings                      — aktuelle Tenant-Settings
 *   PATCH /settings                      — Settings updaten (Text-Watermark)
 *   POST  /settings/watermark-image      — Presigned-URL für Bild-Upload
 *   POST  /settings/watermark-image/complete — Upload abschließen
 *   DELETE /settings/watermark-image     — Bild-Watermark entfernen
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import {
  presignPut,
  deleteObject,
} from "../services/storage.js";

const updateSettingsSchema = z.object({
  watermarkText: z.string().max(200).nullable().optional(),
});

const initWatermarkUploadSchema = z.object({
  contentType: z.string().refine(
    (v) => v === "image/png" || v === "image/jpeg",
    "Only PNG or JPEG allowed"
  ),
  sizeBytes: z.number().int().positive().max(20 * 1024 * 1024), // 20 MiB
});

export async function registerSettingsRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // GET /settings
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // PATCH /settings
  // -------------------------------------------------------------------------
  app.patch("/settings", async (req, reply) => {
    const s = req.requireAuth();
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

  // -------------------------------------------------------------------------
  // POST /settings/watermark-image — Presigned URL für Upload anfordern
  // -------------------------------------------------------------------------
  app.post("/settings/watermark-image", async (req, reply) => {
    const s = req.requireAuth();
    if (s.user.role !== "owner" && s.user.role !== "admin") {
      return reply.status(403).send({ error: "forbidden" });
    }
    const body = initWatermarkUploadSchema.parse(req.body);

    // Deterministischer Key — überschreibt das bestehende, falls vorhanden.
    // Extension passend zum ContentType (sonst stimmt Content-Type beim
    // späteren GET nicht).
    const ext = body.contentType === "image/jpeg" ? "jpg" : "png";
    const key = `t/${req.tenantId}/watermark.${ext}`;

    const uploadUrl = await presignPut({
      key,
      contentType: body.contentType,
      contentLength: body.sizeBytes,
    });

    return {
      key,
      uploadUrl,
      headers: { "Content-Type": body.contentType },
    };
  });

  // -------------------------------------------------------------------------
  // POST /settings/watermark-image/complete
  // -------------------------------------------------------------------------
  app.post<{ Body: { key: string } }>(
    "/settings/watermark-image/complete",
    async (req, reply) => {
      const s = req.requireAuth();
      if (s.user.role !== "owner" && s.user.role !== "admin") {
        return reply.status(403).send({ error: "forbidden" });
      }
      const key = req.body?.key;
      if (typeof key !== "string") {
        return reply.status(400).send({ error: "bad_request" });
      }

      // Sicherheitscheck: der Key muss zum aktuellen Tenant gehören
      if (!key.startsWith(`t/${req.tenantId}/watermark.`)) {
        return reply.status(403).send({ error: "forbidden" });
      }

      // Wenn bereits ein anderer Watermark-Key existiert, alten löschen
      const tenant = await prisma.tenant.findUnique({
        where: { id: req.tenantId },
        select: { watermarkImageKey: true },
      });
      if (tenant?.watermarkImageKey && tenant.watermarkImageKey !== key) {
        await deleteObject(tenant.watermarkImageKey).catch(() => {});
      }

      await prisma.tenant.update({
        where: { id: req.tenantId },
        data: { watermarkImageKey: key },
      });
      return { ok: true, key };
    }
  );

  // -------------------------------------------------------------------------
  // DELETE /settings/watermark-image
  // -------------------------------------------------------------------------
  app.delete("/settings/watermark-image", async (req, reply) => {
    const s = req.requireAuth();
    if (s.user.role !== "owner" && s.user.role !== "admin") {
      return reply.status(403).send({ error: "forbidden" });
    }
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      select: { watermarkImageKey: true },
    });
    if (tenant?.watermarkImageKey) {
      await deleteObject(tenant.watermarkImageKey).catch(() => {});
    }
    await prisma.tenant.update({
      where: { id: req.tenantId },
      data: { watermarkImageKey: null },
    });
    return { ok: true };
  });
}
