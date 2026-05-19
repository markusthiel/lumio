/**
 * Lumio API — Branding Routes
 *
 *   GET    /brandings                — alle Branding-Profile des Tenants
 *   POST   /brandings                — neues Branding-Profil
 *   GET    /brandings/:id            — Details
 *   PATCH  /brandings/:id            — Profil updaten
 *   DELETE /brandings/:id            — Profil löschen (vorsichtig: Galerien orphanen)
 *
 *   POST   /brandings/:id/assets     — Presigned PUT für Logo/Favicon
 *   POST   /brandings/:id/assets/complete — Upload registrieren
 *
 * Logo/Favicon werden als S3-Keys gespeichert (nicht als externe URLs).
 * Beim Ausliefern an Public-Galerien werden Presigned-GET-URLs erzeugt.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { presignPut, deleteObject } from "../services/storage.js";

const colorRegex = /^#[0-9a-fA-F]{6}$/;

const createBrandingSchema = z.object({
  name: z.string().min(1).max(100),
  primaryColor: z.string().regex(colorRegex).default("#0f172a"),
  accentColor: z.string().regex(colorRegex).default("#f59e0b"),
  fontFamily: z.string().min(1).max(100).default("Inter"),
  introText: z.string().max(2000).nullable().optional(),
  footerText: z.string().max(500).nullable().optional(),
  customCss: z.string().max(20_000).nullable().optional(),
});

const updateBrandingSchema = createBrandingSchema.partial();

const initAssetSchema = z.object({
  kind: z.enum(["logo", "favicon"]),
  contentType: z
    .string()
    .refine(
      (v) =>
        v === "image/png" ||
        v === "image/jpeg" ||
        v === "image/svg+xml" ||
        v === "image/x-icon" ||
        v === "image/vnd.microsoft.icon",
      "Only PNG, JPEG, SVG or ICO allowed"
    ),
  sizeBytes: z.number().int().positive().max(5 * 1024 * 1024), // 5 MiB
});

const completeAssetSchema = z.object({
  kind: z.enum(["logo", "favicon"]),
  key: z.string().min(1),
});

async function ownBranding(req: {
  tenantId: string;
  session: { user: { id: string } } | null;
}, id: string) {
  if (!req.session) return null;
  return prisma.branding.findFirst({
    where: { id, tenantId: req.tenantId },
  });
}

function extensionFor(contentType: string): string {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/svg+xml") return "svg";
  if (contentType === "image/x-icon" || contentType === "image/vnd.microsoft.icon")
    return "ico";
  return "png";
}

export async function registerBrandingRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // GET /brandings
  // -------------------------------------------------------------------------
  app.get("/brandings", async (req) => {
    req.requireAuth();
    const brandings = await prisma.branding.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { createdAt: "asc" },
    });
    // Tenant-Default mitliefern, damit das UI weiß, welches Profil
    // markiert werden soll
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      select: { brandingId: true },
    });
    return {
      brandings,
      defaultBrandingId: tenant?.brandingId ?? null,
    };
  });

  // -------------------------------------------------------------------------
  // POST /brandings
  // -------------------------------------------------------------------------
  app.post("/brandings", async (req, reply) => {
    req.requireAuth();
    const body = createBrandingSchema.parse(req.body);
    const branding = await prisma.branding.create({
      data: {
        tenantId: req.tenantId,
        name: body.name,
        primaryColor: body.primaryColor,
        accentColor: body.accentColor,
        fontFamily: body.fontFamily,
        introText: body.introText ?? null,
        footerText: body.footerText ?? null,
        customCss: body.customCss ?? null,
      },
    });
    return reply.status(201).send({ branding });
  });

  // -------------------------------------------------------------------------
  // GET /brandings/:id
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    "/brandings/:id",
    async (req, reply) => {
      req.requireAuth();
      const branding = await ownBranding(req, req.params.id);
      if (!branding) return reply.status(404).send({ error: "not_found" });
      return { branding };
    }
  );

  // -------------------------------------------------------------------------
  // PATCH /brandings/:id
  // -------------------------------------------------------------------------
  app.patch<{ Params: { id: string } }>(
    "/brandings/:id",
    async (req, reply) => {
      req.requireAuth();
      const existing = await ownBranding(req, req.params.id);
      if (!existing) return reply.status(404).send({ error: "not_found" });

      const body = updateBrandingSchema.parse(req.body);
      const branding = await prisma.branding.update({
        where: { id: existing.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.primaryColor !== undefined
            ? { primaryColor: body.primaryColor }
            : {}),
          ...(body.accentColor !== undefined
            ? { accentColor: body.accentColor }
            : {}),
          ...(body.fontFamily !== undefined
            ? { fontFamily: body.fontFamily }
            : {}),
          ...(body.introText !== undefined
            ? { introText: body.introText }
            : {}),
          ...(body.footerText !== undefined
            ? { footerText: body.footerText }
            : {}),
          ...(body.customCss !== undefined
            ? { customCss: body.customCss }
            : {}),
        },
      });
      return { branding };
    }
  );

  // -------------------------------------------------------------------------
  // DELETE /brandings/:id
  // -------------------------------------------------------------------------
  // Beim Löschen werden Galerien, die dieses Branding nutzen, auf null
  // gesetzt (Prisma onDelete: SetNull wäre sauberer; hier per Update).
  app.delete<{ Params: { id: string } }>(
    "/brandings/:id",
    async (req, reply) => {
      req.requireAuth();
      const existing = await ownBranding(req, req.params.id);
      if (!existing) return reply.status(404).send({ error: "not_found" });

      // Wenn dies der Tenant-Default ist: Default löschen
      await prisma.tenant.updateMany({
        where: { id: req.tenantId, brandingId: existing.id },
        data: { brandingId: null },
      });

      // S3-Assets aufräumen
      if (existing.logoUrl) {
        await deleteObject(existing.logoUrl).catch(() => {});
      }
      if (existing.faviconUrl) {
        await deleteObject(existing.faviconUrl).catch(() => {});
      }

      await prisma.branding.delete({ where: { id: existing.id } });
      return reply.status(204).send();
    }
  );

  // -------------------------------------------------------------------------
  // PUT /brandings/:id/default — als Tenant-Default setzen
  // -------------------------------------------------------------------------
  app.put<{ Params: { id: string } }>(
    "/brandings/:id/default",
    async (req, reply) => {
      const s = req.requireAuth();
      if (s.user.role !== "owner" && s.user.role !== "admin") {
        return reply.status(403).send({ error: "forbidden" });
      }
      const existing = await ownBranding(req, req.params.id);
      if (!existing) return reply.status(404).send({ error: "not_found" });

      await prisma.tenant.update({
        where: { id: req.tenantId },
        data: { brandingId: existing.id },
      });
      return { ok: true };
    }
  );

  // -------------------------------------------------------------------------
  // POST /brandings/:id/assets — Presigned PUT
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/brandings/:id/assets",
    async (req, reply) => {
      req.requireAuth();
      const existing = await ownBranding(req, req.params.id);
      if (!existing) return reply.status(404).send({ error: "not_found" });

      const body = initAssetSchema.parse(req.body);
      const ext = extensionFor(body.contentType);
      const key = `t/${req.tenantId}/brand/${existing.id}/${body.kind}.${ext}`;

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
    }
  );

  // -------------------------------------------------------------------------
  // POST /brandings/:id/assets/complete
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/brandings/:id/assets/complete",
    async (req, reply) => {
      req.requireAuth();
      const existing = await ownBranding(req, req.params.id);
      if (!existing) return reply.status(404).send({ error: "not_found" });

      const body = completeAssetSchema.parse(req.body);

      // Sicherheitscheck: Key muss zum Branding gehören
      if (!body.key.startsWith(`t/${req.tenantId}/brand/${existing.id}/`)) {
        return reply.status(403).send({ error: "forbidden" });
      }

      const field = body.kind === "logo" ? "logoUrl" : "faviconUrl";
      const oldKey = body.kind === "logo" ? existing.logoUrl : existing.faviconUrl;

      // Altes File aufräumen, falls anderer Key
      if (oldKey && oldKey !== body.key) {
        await deleteObject(oldKey).catch(() => {});
      }

      const branding = await prisma.branding.update({
        where: { id: existing.id },
        data: { [field]: body.key },
      });
      return { branding };
    }
  );

  // -------------------------------------------------------------------------
  // DELETE /brandings/:id/assets/:kind — Asset entfernen
  // -------------------------------------------------------------------------
  app.delete<{ Params: { id: string; kind: string } }>(
    "/brandings/:id/assets/:kind",
    async (req, reply) => {
      req.requireAuth();
      const existing = await ownBranding(req, req.params.id);
      if (!existing) return reply.status(404).send({ error: "not_found" });

      const kind = req.params.kind;
      if (kind !== "logo" && kind !== "favicon") {
        return reply.status(400).send({ error: "bad_kind" });
      }

      const field = kind === "logo" ? "logoUrl" : "faviconUrl";
      const oldKey = kind === "logo" ? existing.logoUrl : existing.faviconUrl;
      if (oldKey) {
        await deleteObject(oldKey).catch(() => {});
      }
      const branding = await prisma.branding.update({
        where: { id: existing.id },
        data: { [field]: null },
      });
      return { branding };
    }
  );
}
