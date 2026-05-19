/**
 * Lumio API — Gallery Templates Routes
 *
 *   GET    /templates           — Liste aller Templates des Tenants
 *   POST   /templates           — neues Template anlegen
 *   GET    /templates/:id       — Details
 *   PATCH  /templates/:id       — Template ändern
 *   DELETE /templates/:id       — Template löschen
 *
 * Anwendung beim Galerie-Anlegen: POST /galleries akzeptiert einen
 * optionalen templateId-Parameter (siehe routes/galleries.ts).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";

const templateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).nullable().optional(),
  mode: z.enum(["collaboration", "presentation"]).default("collaboration"),
  downloadEnabled: z.boolean().default(true),
  watermarkEnabled: z.boolean().default(false),
  commentsEnabled: z.boolean().default(true),
  ratingsEnabled: z.boolean().default(true),
  defaultExpiryDays: z.number().int().min(1).max(3650).nullable().optional(),
  defaultDescription: z.string().max(2000).nullable().optional(),
  brandingId: z.string().uuid().nullable().optional(),
});

const updateTemplateSchema = templateSchema.partial();

async function ownTemplate(req: {
  tenantId: string;
  session: { user: { id: string } } | null;
}, id: string) {
  if (!req.session) return null;
  return prisma.galleryTemplate.findFirst({
    where: { id, tenantId: req.tenantId },
  });
}

/**
 * Prüft, ob brandingId — falls gesetzt — dem aktuellen Tenant gehört.
 * Verhindert, dass jemand fremde Branding-UUIDs reinmogelt.
 */
async function validateBrandingId(
  tenantId: string,
  brandingId: string | null | undefined
): Promise<boolean> {
  if (!brandingId) return true;
  const b = await prisma.branding.findFirst({
    where: { id: brandingId, tenantId },
    select: { id: true },
  });
  return !!b;
}

export async function registerTemplateRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // GET /templates
  // -------------------------------------------------------------------------
  app.get("/templates", async (req) => {
    req.requireAuth();
    const templates = await prisma.galleryTemplate.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { createdAt: "asc" },
    });
    return { templates };
  });

  // -------------------------------------------------------------------------
  // POST /templates
  // -------------------------------------------------------------------------
  app.post("/templates", async (req, reply) => {
    req.requireAuth();
    const body = templateSchema.parse(req.body);
    if (!(await validateBrandingId(req.tenantId, body.brandingId))) {
      return reply.status(400).send({ error: "bad_branding" });
    }
    const template = await prisma.galleryTemplate.create({
      data: {
        tenantId: req.tenantId,
        name: body.name,
        description: body.description ?? null,
        mode: body.mode,
        downloadEnabled: body.downloadEnabled,
        watermarkEnabled: body.watermarkEnabled,
        commentsEnabled: body.commentsEnabled,
        ratingsEnabled: body.ratingsEnabled,
        defaultExpiryDays: body.defaultExpiryDays ?? null,
        defaultDescription: body.defaultDescription ?? null,
        brandingId: body.brandingId ?? null,
      },
    });
    return reply.status(201).send({ template });
  });

  // -------------------------------------------------------------------------
  // GET /templates/:id
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    "/templates/:id",
    async (req, reply) => {
      req.requireAuth();
      const template = await ownTemplate(req, req.params.id);
      if (!template) return reply.status(404).send({ error: "not_found" });
      return { template };
    }
  );

  // -------------------------------------------------------------------------
  // PATCH /templates/:id
  // -------------------------------------------------------------------------
  app.patch<{ Params: { id: string } }>(
    "/templates/:id",
    async (req, reply) => {
      req.requireAuth();
      const existing = await ownTemplate(req, req.params.id);
      if (!existing) return reply.status(404).send({ error: "not_found" });

      const body = updateTemplateSchema.parse(req.body);
      if (
        body.brandingId !== undefined &&
        !(await validateBrandingId(req.tenantId, body.brandingId))
      ) {
        return reply.status(400).send({ error: "bad_branding" });
      }

      const template = await prisma.galleryTemplate.update({
        where: { id: existing.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined
            ? { description: body.description }
            : {}),
          ...(body.mode !== undefined ? { mode: body.mode } : {}),
          ...(body.downloadEnabled !== undefined
            ? { downloadEnabled: body.downloadEnabled }
            : {}),
          ...(body.watermarkEnabled !== undefined
            ? { watermarkEnabled: body.watermarkEnabled }
            : {}),
          ...(body.commentsEnabled !== undefined
            ? { commentsEnabled: body.commentsEnabled }
            : {}),
          ...(body.ratingsEnabled !== undefined
            ? { ratingsEnabled: body.ratingsEnabled }
            : {}),
          ...(body.defaultExpiryDays !== undefined
            ? { defaultExpiryDays: body.defaultExpiryDays }
            : {}),
          ...(body.defaultDescription !== undefined
            ? { defaultDescription: body.defaultDescription }
            : {}),
          ...(body.brandingId !== undefined
            ? { brandingId: body.brandingId }
            : {}),
        },
      });
      return { template };
    }
  );

  // -------------------------------------------------------------------------
  // DELETE /templates/:id
  // -------------------------------------------------------------------------
  app.delete<{ Params: { id: string } }>(
    "/templates/:id",
    async (req, reply) => {
      req.requireAuth();
      const existing = await ownTemplate(req, req.params.id);
      if (!existing) return reply.status(404).send({ error: "not_found" });
      await prisma.galleryTemplate.delete({ where: { id: existing.id } });
      return reply.status(204).send();
    }
  );
}
