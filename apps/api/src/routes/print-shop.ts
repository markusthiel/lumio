/**
 * Lumio API — Studio-Print-Shop-Routes
 *
 * Verwaltungs-Endpoints fuer den Print-Shop aus Sicht des Studios.
 * ALLE Routes pruefen erst:
 *   1. Eingeloggter User mit role=owner|admin
 *   2. Feature-Flag 'print_shop' aktiv fuer den Tenant
 *
 * Wenn Feature-Flag aus: 404, als waere der ganze Endpunkt nicht
 * existent. Das ist konsequent und schwer zu unterscheiden von einem
 * 'gibt's nicht'-Fall — gewollt.
 *
 * Endpoints:
 *   GET    /print-shop/config           — Tenant-Settings + Connect-Status
 *   PUT    /print-shop/config           — Tenant-Settings updaten
 *   POST   /print-shop/stripe-connect   — Onboarding starten
 *   POST   /print-shop/stripe-connect/refresh — Status sync mit Stripe
 *   DELETE /print-shop/stripe-connect   — Disconnect
 *   GET    /print-shop/providers/available — Provider die der Tenant nutzen kann
 *   GET    /print-shop/providers        — Vom Tenant aktivierte Provider
 *   PUT    /print-shop/providers/:key   — Provider aktivieren/updaten
 *   DELETE /print-shop/providers/:key   — Provider entfernen
 *   GET    /print-shop/products         — Produktkatalog
 *   POST   /print-shop/products         — Produkt anlegen
 *   GET    /print-shop/products/:id     — Detail
 *   PUT    /print-shop/products/:id     — Updaten
 *   DELETE /print-shop/products/:id     — Loeschen
 *   POST   /print-shop/products/:id/variants — Variante hinzufuegen
 *   PUT    /print-shop/variants/:id     — Variante updaten
 *   DELETE /print-shop/variants/:id     — Variante loeschen
 *   GET    /print-shop/shipping-methods — Versandmethoden
 *   POST   /print-shop/shipping-methods — anlegen
 *   PUT    /print-shop/shipping-methods/:id
 *   DELETE /print-shop/shipping-methods/:id
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { config } from "../config.js";
import { isFeatureEnabled } from "../services/feature-flags.js";
import {
  getTenantPrintConfig,
  upsertTenantPrintConfig,
  listAvailableProvidersForTenant,
  listTenantProviders,
  setTenantProvider,
  deleteTenantProvider,
} from "../services/print/shop.js";
import {
  startOnboarding,
  syncConnectAccount,
  disconnectAccount,
  getConnectStatus,
} from "../services/print/stripe-connect.js";
import { transitionOrder } from "../services/print/orders.js";
import { logEvent } from "../services/audit.js";

/** Guard: User muss eingeloggt sein und role owner|admin haben.
 *  Plus: Feature-Flag print_shop muss aktiv sein. */
async function guard(req: FastifyRequest, reply: FastifyReply): Promise<{
  tenantId: string;
  userId: string;
  userEmail: string;
} | null> {
  if (!req.session) {
    reply.status(401).send({ error: "unauthenticated" });
    return null;
  }
  const { user } = req.session;
  if (user.role !== "owner" && user.role !== "admin") {
    reply.status(403).send({ error: "forbidden" });
    return null;
  }
  if (!(await isFeatureEnabled(user.tenantId, "print_shop"))) {
    reply.status(404).send({ error: "not_found" });
    return null;
  }
  return {
    tenantId: user.tenantId,
    userId: user.id,
    userEmail: user.email,
  };
}

export async function registerPrintShopRoutes(app: FastifyInstance) {
  // ============================================================================
  // CONFIG
  // ============================================================================

  app.get("/print-shop/config", async (req, reply) => {
    const ctx = await guard(req, reply);
    if (!ctx) return;
    const config_ = await getTenantPrintConfig(ctx.tenantId);
    const connect = await getConnectStatus(ctx.tenantId);
    return { config: config_, stripeConnect: connect };
  });

  const configSchema = z.object({
    enabled: z.boolean().optional(),
    studioDisplayName: z.string().min(1).max(200).nullable().optional(),
    supportEmail: z.string().email().nullable().optional(),
    vatHandling: z.enum(["inclusive", "exclusive"]).optional(),
    defaultVatBps: z.number().int().min(0).max(2500).optional(),
    currency: z.string().length(3).optional(),
    termsUrl: z.string().url().nullable().optional(),
    privacyUrl: z.string().url().nullable().optional(),
  });
  app.put("/print-shop/config", async (req, reply) => {
    const ctx = await guard(req, reply);
    if (!ctx) return;
    const body = configSchema.parse(req.body);
    await upsertTenantPrintConfig(ctx.tenantId, body);
    await logEvent({
      tenantId: ctx.tenantId,
      actorType: "user",
      actorId: ctx.userId,
      action: "print_shop.config.update",
      payload: body,
      ipAddress: req.ip,
    });
    return { ok: true };
  });

  // ============================================================================
  // STRIPE-CONNECT
  // ============================================================================

  app.post("/print-shop/stripe-connect", async (req, reply) => {
    const ctx = await guard(req, reply);
    if (!ctx) return;
    const tenant = await prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { name: true, displayName: true },
    });
    if (!tenant) return reply.status(404).send({ error: "tenant_not_found" });

    const returnUrl = `${config.PUBLIC_URL.replace(/\/+$/, "")}/studio/print-shop/settings?stripe_return=1`;
    const result = await startOnboarding({
      tenantId: ctx.tenantId,
      tenantName: tenant.displayName ?? tenant.name,
      ownerEmail: ctx.userEmail,
      returnUrl,
      refreshUrl: returnUrl,
    });

    await logEvent({
      tenantId: ctx.tenantId,
      actorType: "user",
      actorId: ctx.userId,
      action: "print_shop.stripe_connect.onboarding_started",
      payload: { stripeAccountId: result.stripeAccountId },
      ipAddress: req.ip,
    });

    return { onboardingUrl: result.onboardingUrl };
  });

  app.post("/print-shop/stripe-connect/refresh", async (req, reply) => {
    const ctx = await guard(req, reply);
    if (!ctx) return;
    const status = await syncConnectAccount(ctx.tenantId);
    return { stripeConnect: status };
  });

  app.delete("/print-shop/stripe-connect", async (req, reply) => {
    const ctx = await guard(req, reply);
    if (!ctx) return;
    const result = await disconnectAccount(ctx.tenantId);
    if (!result.ok) {
      return reply.status(409).send({
        error: "cannot_disconnect",
        message: result.reason,
      });
    }
    await logEvent({
      tenantId: ctx.tenantId,
      actorType: "user",
      actorId: ctx.userId,
      action: "print_shop.stripe_connect.disconnected",
      ipAddress: req.ip,
    });
    return { ok: true };
  });

  // ============================================================================
  // PROVIDERS
  // ============================================================================

  app.get("/print-shop/providers/available", async (req, reply) => {
    const ctx = await guard(req, reply);
    if (!ctx) return;
    const list = await listAvailableProvidersForTenant();
    return {
      providers: list
        .filter(({ globallyEnabled }) => globallyEnabled)
        .map(({ def }) => ({
          key: def.key,
          label: def.label,
          tagline: def.tagline,
          market: def.market,
          stage: def.stage,
          categories: def.categories,
          websiteUrl: def.websiteUrl,
          apiKeyHelpUrl: def.apiKeyHelpUrl,
          credentialFields: def.credentialFields,
        })),
    };
  });

  app.get("/print-shop/providers", async (req, reply) => {
    const ctx = await guard(req, reply);
    if (!ctx) return;
    const list = await listTenantProviders(ctx.tenantId);
    return { providers: list };
  });

  const providerPutSchema = z.object({
    enabled: z.boolean().optional(),
    displayName: z.string().max(200).nullable().optional(),
    credentials: z.record(z.string(), z.string()).optional(),
    isDefault: z.boolean().optional(),
  });
  app.put<{ Params: { key: string } }>(
    "/print-shop/providers/:key",
    async (req, reply) => {
      const ctx = await guard(req, reply);
      if (!ctx) return;
      const body = providerPutSchema.parse(req.body);
      try {
        await setTenantProvider({
          tenantId: ctx.tenantId,
          providerKey: req.params.key,
          ...body,
        });
        await logEvent({
          tenantId: ctx.tenantId,
          actorType: "user",
          actorId: ctx.userId,
          action: "print_shop.provider.upsert",
          targetType: "print_provider",
          targetId: req.params.key,
          payload: {
            enabled: body.enabled,
            isDefault: body.isDefault,
            // Credentials NICHT loggen
            credentialsProvided: body.credentials !== undefined,
          },
          ipAddress: req.ip,
        });
        return { ok: true };
      } catch (err) {
        return reply.status(400).send({
          error: "provider_setup_failed",
          message: err instanceof Error ? err.message : "Fehler",
        });
      }
    }
  );

  app.delete<{ Params: { key: string } }>(
    "/print-shop/providers/:key",
    async (req, reply) => {
      const ctx = await guard(req, reply);
      if (!ctx) return;
      try {
        await deleteTenantProvider(ctx.tenantId, req.params.key);
        await logEvent({
          tenantId: ctx.tenantId,
          actorType: "user",
          actorId: ctx.userId,
          action: "print_shop.provider.delete",
          targetType: "print_provider",
          targetId: req.params.key,
          ipAddress: req.ip,
        });
        return { ok: true };
      } catch (err) {
        return reply.status(409).send({
          error: "cannot_delete",
          message: err instanceof Error ? err.message : "Fehler",
        });
      }
    }
  );

  // ============================================================================
  // PRODUCTS
  // ============================================================================

  app.get("/print-shop/products", async (req, reply) => {
    const ctx = await guard(req, reply);
    if (!ctx) return;
    const products = await prisma.printProduct.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      include: {
        variants: { orderBy: [{ displayOrder: "asc" }, { name: "asc" }] },
      },
    });
    return { products };
  });

  const productCreateSchema = z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
    providerKey: z.string().min(1),
    providerProductRef: z.string().max(200).nullable().optional(),
    category: z
      .enum([
        "print",
        "canvas",
        "photobook",
        "frame",
        "metal_print",
        "poster",
      ])
      .default("print"),
    vatBpsOverride: z.number().int().min(0).max(2500).nullable().optional(),
    displayOrder: z.number().int().default(0),
    enabled: z.boolean().default(true),
  });
  app.post("/print-shop/products", async (req, reply) => {
    const ctx = await guard(req, reply);
    if (!ctx) return;
    const body = productCreateSchema.parse(req.body);

    // Provider muss vom Tenant aktiviert sein
    const providerOk = await prisma.tenantPrintProvider.findUnique({
      where: {
        tenantId_providerKey: {
          tenantId: ctx.tenantId,
          providerKey: body.providerKey,
        },
      },
    });
    if (!providerOk && body.providerKey !== "manual_self_print") {
      return reply.status(400).send({
        error: "provider_not_active",
        message: "Diesen Provider hast du nicht aktiviert.",
      });
    }

    const product = await prisma.printProduct.create({
      data: {
        tenantId: ctx.tenantId,
        ...body,
      },
    });
    return { product };
  });

  const productUpdateSchema = productCreateSchema.partial();
  app.put<{ Params: { id: string } }>(
    "/print-shop/products/:id",
    async (req, reply) => {
      const ctx = await guard(req, reply);
      if (!ctx) return;
      const body = productUpdateSchema.parse(req.body);
      const existing = await prisma.printProduct.findFirst({
        where: { id: req.params.id, tenantId: ctx.tenantId },
      });
      if (!existing) return reply.status(404).send({ error: "not_found" });
      const product = await prisma.printProduct.update({
        where: { id: req.params.id },
        data: body,
      });
      return { product };
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/print-shop/products/:id",
    async (req, reply) => {
      const ctx = await guard(req, reply);
      if (!ctx) return;
      const existing = await prisma.printProduct.findFirst({
        where: { id: req.params.id, tenantId: ctx.tenantId },
      });
      if (!existing) return reply.status(404).send({ error: "not_found" });
      // Check ob noch Order-Items darauf zeigen via Variants
      const used = await prisma.printOrderItem.count({
        where: { printProductVariant: { printProductId: req.params.id } },
      });
      if (used > 0) {
        return reply.status(409).send({
          error: "in_use",
          message:
            "Es gibt noch Bestellungen mit Varianten dieses Produkts. Deaktiviere stattdessen (enabled=false).",
        });
      }
      await prisma.printProduct.delete({ where: { id: req.params.id } });
      return { ok: true };
    }
  );

  // ============================================================================
  // VARIANTS
  // ============================================================================

  const variantCreateSchema = z.object({
    name: z.string().min(1).max(200),
    widthMm: z.number().int().min(1).max(10000),
    heightMm: z.number().int().min(1).max(10000),
    aspectRatio: z.number().positive().nullable().optional(),
    finishType: z.string().max(50).nullable().optional(),
    providerVariantRef: z.string().max(200).nullable().optional(),
    priceCents: z.number().int().min(0),
    costCents: z.number().int().min(0).nullable().optional(),
    displayOrder: z.number().int().default(0),
    enabled: z.boolean().default(true),
  });
  app.post<{ Params: { id: string } }>(
    "/print-shop/products/:id/variants",
    async (req, reply) => {
      const ctx = await guard(req, reply);
      if (!ctx) return;
      const body = variantCreateSchema.parse(req.body);
      // Product-Ownership pruefen
      const product = await prisma.printProduct.findFirst({
        where: { id: req.params.id, tenantId: ctx.tenantId },
        select: { id: true },
      });
      if (!product) return reply.status(404).send({ error: "not_found" });
      const variant = await prisma.printProductVariant.create({
        data: {
          printProductId: req.params.id,
          ...body,
        },
      });
      return { variant };
    }
  );

  const variantUpdateSchema = variantCreateSchema.partial();
  app.put<{ Params: { id: string } }>(
    "/print-shop/variants/:id",
    async (req, reply) => {
      const ctx = await guard(req, reply);
      if (!ctx) return;
      const body = variantUpdateSchema.parse(req.body);
      // Variant-Ownership pruefen via Product
      const variant = await prisma.printProductVariant.findFirst({
        where: {
          id: req.params.id,
          printProduct: { tenantId: ctx.tenantId },
        },
        select: { id: true },
      });
      if (!variant) return reply.status(404).send({ error: "not_found" });
      const updated = await prisma.printProductVariant.update({
        where: { id: req.params.id },
        data: body,
      });
      return { variant: updated };
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/print-shop/variants/:id",
    async (req, reply) => {
      const ctx = await guard(req, reply);
      if (!ctx) return;
      const variant = await prisma.printProductVariant.findFirst({
        where: {
          id: req.params.id,
          printProduct: { tenantId: ctx.tenantId },
        },
        select: { id: true },
      });
      if (!variant) return reply.status(404).send({ error: "not_found" });
      const used = await prisma.printOrderItem.count({
        where: { printProductVariantId: req.params.id },
      });
      if (used > 0) {
        return reply.status(409).send({
          error: "in_use",
          message: "Es gibt Bestellungen mit dieser Variante. Deaktiviere stattdessen.",
        });
      }
      await prisma.printProductVariant.delete({ where: { id: req.params.id } });
      return { ok: true };
    }
  );

  // ============================================================================
  // SHIPPING METHODS
  // ============================================================================

  app.get("/print-shop/shipping-methods", async (req, reply) => {
    const ctx = await guard(req, reply);
    if (!ctx) return;
    const methods = await prisma.shippingMethod.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    });
    return { methods };
  });

  const shippingCreateSchema = z.object({
    providerKey: z.string().min(1),
    name: z.string().min(1).max(200),
    priceCents: z.number().int().min(0),
    estimatedDaysMin: z.number().int().min(0).nullable().optional(),
    estimatedDaysMax: z.number().int().min(0).nullable().optional(),
    countries: z.array(z.string().length(2).toUpperCase()).default([]),
    providerShippingRef: z.string().max(200).nullable().optional(),
    enabled: z.boolean().default(true),
    displayOrder: z.number().int().default(0),
  });
  app.post("/print-shop/shipping-methods", async (req, reply) => {
    const ctx = await guard(req, reply);
    if (!ctx) return;
    const body = shippingCreateSchema.parse(req.body);
    const method = await prisma.shippingMethod.create({
      data: {
        tenantId: ctx.tenantId,
        ...body,
      },
    });
    return { method };
  });

  const shippingUpdateSchema = shippingCreateSchema.partial();
  app.put<{ Params: { id: string } }>(
    "/print-shop/shipping-methods/:id",
    async (req, reply) => {
      const ctx = await guard(req, reply);
      if (!ctx) return;
      const body = shippingUpdateSchema.parse(req.body);
      const existing = await prisma.shippingMethod.findFirst({
        where: { id: req.params.id, tenantId: ctx.tenantId },
      });
      if (!existing) return reply.status(404).send({ error: "not_found" });
      const method = await prisma.shippingMethod.update({
        where: { id: req.params.id },
        data: body,
      });
      return { method };
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/print-shop/shipping-methods/:id",
    async (req, reply) => {
      const ctx = await guard(req, reply);
      if (!ctx) return;
      const existing = await prisma.shippingMethod.findFirst({
        where: { id: req.params.id, tenantId: ctx.tenantId },
      });
      if (!existing) return reply.status(404).send({ error: "not_found" });
      const used = await prisma.printOrder.count({
        where: { shippingMethodId: req.params.id },
      });
      if (used > 0) {
        return reply.status(409).send({
          error: "in_use",
          message: "Es gibt Bestellungen mit dieser Versandmethode. Deaktiviere stattdessen.",
        });
      }
      await prisma.shippingMethod.delete({ where: { id: req.params.id } });
      return { ok: true };
    }
  );

  // ============================================================================
  // ORDERS (Studio-Sicht)
  // ============================================================================

  // GET /print-shop/orders?status=&limit=&cursor=
  app.get<{
    Querystring: { status?: string; limit?: string; cursor?: string };
  }>("/print-shop/orders", async (req, reply) => {
    const ctx = await guard(req, reply);
    if (!ctx) return;
    const limit = Math.min(parseInt(req.query.limit ?? "30", 10) || 30, 100);
    const where: Record<string, unknown> = { tenantId: ctx.tenantId };
    if (req.query.status) where.status = req.query.status;

    const orders = await prisma.printOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(req.query.cursor
        ? { skip: 1, cursor: { id: req.query.cursor } }
        : {}),
      select: {
        id: true,
        orderNumber: true,
        guestName: true,
        guestEmail: true,
        totalCents: true,
        currency: true,
        status: true,
        paymentMode: true,
        providerKey: true,
        createdAt: true,
        paidAt: true,
        shippedAt: true,
        deliveredAt: true,
      },
    });
    const hasMore = orders.length > limit;
    const list = hasMore ? orders.slice(0, limit) : orders;
    return {
      orders: list,
      nextCursor: hasMore ? list[list.length - 1].id : null,
    };
  });

  // GET /print-shop/orders/:id
  app.get<{ Params: { id: string } }>(
    "/print-shop/orders/:id",
    async (req, reply) => {
      const ctx = await guard(req, reply);
      if (!ctx) return;
      const order = await prisma.printOrder.findFirst({
        where: { id: req.params.id, tenantId: ctx.tenantId },
        include: {
          items: {
            include: {
              printProductVariant: {
                include: { printProduct: { select: { name: true } } },
              },
              file: {
                select: { id: true, originalFilename: true, sha256: true },
              },
            },
          },
          shippingMethod: { select: { name: true, priceCents: true } },
          events: { orderBy: { createdAt: "asc" } },
          gallery: { select: { id: true, slug: true, title: true } },
        },
      });
      if (!order) return reply.status(404).send({ error: "not_found" });
      return { order };
    }
  );

  // POST /print-shop/orders/:id/transitions
  // Body: { type, trackingNumber?, trackingCarrier?, trackingUrl?, reason? }
  const transitionSchema = z.object({
    type: z.enum([
      "mark_paid",
      "mark_in_production",
      "mark_shipped",
      "mark_delivered",
      "cancel",
      "refund",
    ]),
    trackingNumber: z.string().max(200).optional(),
    trackingCarrier: z.string().max(100).optional(),
    trackingUrl: z.string().url().optional(),
    reason: z.string().max(500).optional(),
  });
  app.post<{ Params: { id: string } }>(
    "/print-shop/orders/:id/transitions",
    async (req, reply) => {
      const ctx = await guard(req, reply);
      if (!ctx) return;
      const body = transitionSchema.parse(req.body);
      const order = await prisma.printOrder.findFirst({
        where: { id: req.params.id, tenantId: ctx.tenantId },
        select: { id: true },
      });
      if (!order) return reply.status(404).send({ error: "not_found" });
      try {
        await transitionOrder(req.params.id, {
          type: body.type,
          actor: "studio",
          actorUserId: ctx.userId,
          ...(body.type === "mark_shipped"
            ? {
                trackingNumber: body.trackingNumber,
                trackingCarrier: body.trackingCarrier,
                trackingUrl: body.trackingUrl,
              }
            : {}),
          ...(body.type === "cancel" || body.type === "refund"
            ? { reason: body.reason }
            : {}),
        });
        await logEvent({
          tenantId: ctx.tenantId,
          actorType: "user",
          actorId: ctx.userId,
          action: `print_shop.order.${body.type}`,
          targetType: "print_order",
          targetId: req.params.id,
          payload: body as Record<string, unknown>,
          ipAddress: req.ip,
        });
        return { ok: true };
      } catch (err) {
        return reply.status(400).send({
          error: "transition_failed",
          message: err instanceof Error ? err.message : "Fehler",
        });
      }
    }
  );

  // POST /print-shop/orders/:id/note
  app.post<{ Params: { id: string } }>(
    "/print-shop/orders/:id/note",
    async (req, reply) => {
      const ctx = await guard(req, reply);
      if (!ctx) return;
      const body = z.object({ note: z.string().max(2000) }).parse(req.body);
      const order = await prisma.printOrder.findFirst({
        where: { id: req.params.id, tenantId: ctx.tenantId },
        select: { id: true },
      });
      if (!order) return reply.status(404).send({ error: "not_found" });
      await prisma.printOrder.update({
        where: { id: req.params.id },
        data: {
          studioNote: body.note,
          events: {
            create: {
              eventType: "note_added",
              actor: "studio",
              actorUserId: ctx.userId,
              data: { note: body.note } as never,
            },
          },
        },
      });
      return { ok: true };
    }
  );
}
