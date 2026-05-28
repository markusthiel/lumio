/**
 * Lumio API — Print-Shop Public-Routes (Endkunden)
 *
 * Routes die Endkunden aus der Galerie aufrufen koennen, ohne User-
 * Session. Authorization via Visitor-Cookie der Galerie (loadVisitor).
 *
 * Endpoints:
 *   GET  /g/:slug/print-shop/catalog      — Produkte + Versand + Settings
 *   POST /g/:slug/print-shop/price        — Preise berechnen (Vorschau)
 *   POST /g/:slug/print-shop/checkout     — Order anlegen + PaymentIntent
 *   GET  /g/:slug/print-shop/order/:n     — Bestellungs-Bestaetigung
 *
 * Sichtbarkeit: alle Routes pruefen
 *   - Galerie existiert + live + nicht expired
 *   - Visitor-Cookie gueltig
 *   - Tenant hat Feature-Flag print_shop
 *   - TenantPrintShopConfig.enabled = true
 *   - Gallery.printShopEnabled !== false (null = uebernehmen)
 * Wenn irgendetwas davon FALSE: 404.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { config } from "../config.js";
import { isFeatureEnabled } from "../services/feature-flags.js";
import { loadVisitor } from "./galleries.js";
import { createOrder, priceCart } from "../services/print/orders.js";
import { createPaymentIntentForOrder } from "../services/print/payment.js";
import { getPrintProvider } from "../services/print/providers.js";

/** Prueft Sichtbarkeit + liefert tenantId/galleryId zurueck. */
async function resolveGalleryForPrintShop(slug: string): Promise<{
  tenantId: string;
  galleryId: string;
  galleryTitle: string;
} | null> {
  const gallery = await prisma.gallery.findUnique({
    where: { slug },
    select: {
      id: true,
      title: true,
      tenantId: true,
      status: true,
      expiresAt: true,
      printShopEnabled: true,
    },
  });
  if (!gallery || gallery.status !== "live") return null;
  if (gallery.expiresAt && gallery.expiresAt < new Date()) return null;
  if (gallery.printShopEnabled === false) return null;

  if (!(await isFeatureEnabled(gallery.tenantId, "print_shop"))) return null;
  const cfg = await prisma.tenantPrintShopConfig.findUnique({
    where: { tenantId: gallery.tenantId },
    select: { enabled: true },
  });
  if (!cfg?.enabled) return null;

  return {
    tenantId: gallery.tenantId,
    galleryId: gallery.id,
    galleryTitle: gallery.title,
  };
}

export async function registerPrintShopPublicRoutes(app: FastifyInstance) {
  // ----------------------------------------------------------------------
  // GET /g/:slug/print-shop/catalog
  // ----------------------------------------------------------------------
  // Liefert was Endkunden zum Browsen + Konfigurieren brauchen:
  //   - Print-Shop-Config (currency, vatHandling, terms/privacy URLs)
  //   - Stripe-Connect-Status (kann Endkunde online bezahlen?)
  //   - Liste aktiver Produkte mit Varianten
  //   - Liste aktiver Versandmethoden
  app.get<{ Params: { slug: string } }>(
    "/g/:slug/print-shop/catalog",
    async (req, reply) => {
      const gal = await resolveGalleryForPrintShop(req.params.slug);
      if (!gal) return reply.status(404).send({ error: "not_found" });
      const visitor = await loadVisitor(
        req as Parameters<typeof loadVisitor>[0]
      );
      if (!visitor) return reply.status(401).send({ error: "unauthorized" });

      const [cfg, connect, products, shipping] = await Promise.all([
        prisma.tenantPrintShopConfig.findUnique({
          where: { tenantId: gal.tenantId },
        }),
        prisma.tenantStripeConnect.findUnique({
          where: { tenantId: gal.tenantId },
        }),
        prisma.printProduct.findMany({
          where: { tenantId: gal.tenantId, enabled: true },
          orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
          include: {
            variants: {
              where: { enabled: true },
              orderBy: [{ displayOrder: "asc" }, { widthMm: "asc" }],
            },
          },
        }),
        prisma.shippingMethod.findMany({
          where: { tenantId: gal.tenantId, enabled: true },
          orderBy: [{ displayOrder: "asc" }, { priceCents: "asc" }],
        }),
      ]);

      // Pro Provider den Tenant-Eintrag prüfen — falls Provider in DB
      // disabled wurde, alle Produkte filtern.
      const tenantProviders = await prisma.tenantPrintProvider.findMany({
        where: { tenantId: gal.tenantId, enabled: true },
      });
      const enabledKeys = new Set(tenantProviders.map((p) => p.providerKey));
      // Self-Print ist implizit immer aktivierbar — wenn ein Produkt
      // self_print referenziert und kein Eintrag existiert, lassen wir
      // es durch sofern es Tenant-Produkte gibt.
      enabledKeys.add("manual_self_print");

      const filteredProducts = products
        .filter((p) => enabledKeys.has(p.providerKey))
        .map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          category: p.category,
          providerKey: p.providerKey,
          variants: p.variants.map((v) => ({
            id: v.id,
            name: v.name,
            widthMm: v.widthMm,
            heightMm: v.heightMm,
            aspectRatio: v.aspectRatio,
            finishType: v.finishType,
            priceCents: v.priceCents,
          })),
        }));

      return {
        gallery: { slug: req.params.slug, title: gal.galleryTitle },
        config: {
          studioDisplayName: cfg?.studioDisplayName ?? null,
          supportEmail: cfg?.supportEmail ?? null,
          vatHandling: cfg?.vatHandling ?? "inclusive",
          vatBps: cfg?.defaultVatBps ?? 1900,
          currency: cfg?.currency ?? "EUR",
          termsUrl: cfg?.termsUrl ?? null,
          privacyUrl: cfg?.privacyUrl ?? null,
        },
        payment: {
          stripeConnectReady: connect?.chargesEnabled ?? false,
          offlineAvailable: true,
          stripePublishableKey: connect?.chargesEnabled
            ? config.STRIPE_PUBLISHABLE_KEY ?? null
            : null,
          stripeAccountId: connect?.chargesEnabled
            ? connect.stripeConnectedAccountId
            : null,
        },
        products: filteredProducts,
        shipping: shipping.map((s) => ({
          id: s.id,
          name: s.name,
          priceCents: s.priceCents,
          estimatedDaysMin: s.estimatedDaysMin,
          estimatedDaysMax: s.estimatedDaysMax,
          countries: s.countries,
        })),
      };
    }
  );

  // ----------------------------------------------------------------------
  // POST /g/:slug/print-shop/price
  // ----------------------------------------------------------------------
  // Berechnet die Preise eines Carts zur Vorschau. Cart wird NICHT
  // persistiert.
  const priceSchema = z.object({
    items: z
      .array(
        z.object({
          variantId: z.string().uuid(),
          fileId: z.string().uuid(),
          quantity: z.number().int().min(1).max(99),
          crop: z
            .object({
              x: z.number().min(0).max(1),
              y: z.number().min(0).max(1),
              width: z.number().min(0).max(1),
              height: z.number().min(0).max(1),
            })
            .nullable()
            .optional(),
        })
      )
      .min(1),
    shippingMethodId: z.string().uuid().nullable(),
  });
  app.post<{ Params: { slug: string } }>(
    "/g/:slug/print-shop/price",
    async (req, reply) => {
      const gal = await resolveGalleryForPrintShop(req.params.slug);
      if (!gal) return reply.status(404).send({ error: "not_found" });
      const visitor = await loadVisitor(
        req as Parameters<typeof loadVisitor>[0]
      );
      if (!visitor) return reply.status(401).send({ error: "unauthorized" });
      const body = priceSchema.parse(req.body);
      try {
        const result = await priceCart({
          tenantId: gal.tenantId,
          galleryId: gal.galleryId,
          items: body.items.map((i) => ({
            variantId: i.variantId,
            fileId: i.fileId,
            quantity: i.quantity,
            crop: i.crop ?? null,
          })),
          shippingMethodId: body.shippingMethodId,
        });
        return result;
      } catch (err) {
        return reply.status(400).send({
          error: "price_failed",
          message: err instanceof Error ? err.message : "Fehler",
        });
      }
    }
  );

  // ----------------------------------------------------------------------
  // POST /g/:slug/print-shop/checkout
  // ----------------------------------------------------------------------
  // Erstellt eine Order. Bei stripe_connect: zusaetzlich PaymentIntent
  // erzeugen und client_secret zurueckgeben.
  const checkoutSchema = z.object({
    items: priceSchema.shape.items,
    shippingMethodId: z.string().uuid(),
    guestName: z.string().min(1).max(200),
    guestEmail: z.string().email().max(200),
    shippingAddress: z.object({
      street: z.string().min(1).max(200),
      street2: z.string().max(200).optional(),
      postalCode: z.string().min(1).max(20),
      city: z.string().min(1).max(100),
      region: z.string().max(100).optional(),
      countryCode: z.string().length(2).toUpperCase(),
      phone: z.string().max(50).optional(),
    }),
    billingAddress: z
      .object({
        street: z.string().min(1).max(200),
        street2: z.string().max(200).optional(),
        postalCode: z.string().min(1).max(20),
        city: z.string().min(1).max(100),
        region: z.string().max(100).optional(),
        countryCode: z.string().length(2).toUpperCase(),
        phone: z.string().max(50).optional(),
      })
      .nullable()
      .optional(),
    paymentMode: z.enum(["stripe_connect", "offline_invoice"]),
    guestNote: z.string().max(2000).optional(),
    /** AGB/Datenschutz-Zustimmung — Pflicht in DE */
    acceptedTerms: z.boolean(),
  });
  app.post<{ Params: { slug: string } }>(
    "/g/:slug/print-shop/checkout",
    async (req, reply) => {
      const gal = await resolveGalleryForPrintShop(req.params.slug);
      if (!gal) return reply.status(404).send({ error: "not_found" });
      const visitor = await loadVisitor(
        req as Parameters<typeof loadVisitor>[0]
      );
      if (!visitor) return reply.status(401).send({ error: "unauthorized" });
      const body = checkoutSchema.parse(req.body);

      if (!body.acceptedTerms) {
        return reply.status(400).send({
          error: "terms_required",
          message: "AGB-Zustimmung erforderlich.",
        });
      }

      // Stripe-Connect-Check fuer Online-Modus
      if (body.paymentMode === "stripe_connect") {
        const connect = await prisma.tenantStripeConnect.findUnique({
          where: { tenantId: gal.tenantId },
        });
        if (!connect?.chargesEnabled) {
          return reply.status(400).send({
            error: "online_payment_unavailable",
            message: "Online-Bezahlung ist aktuell nicht verfügbar.",
          });
        }
      }

      try {
        const created = await createOrder({
          tenantId: gal.tenantId,
          galleryId: gal.galleryId,
          items: body.items.map((i) => ({
            variantId: i.variantId,
            fileId: i.fileId,
            quantity: i.quantity,
            crop: i.crop ?? null,
          })),
          shippingMethodId: body.shippingMethodId,
          guestName: body.guestName,
          guestEmail: body.guestEmail,
          shippingAddress: body.shippingAddress,
          billingAddress: body.billingAddress ?? null,
          paymentMode: body.paymentMode,
          guestNote: body.guestNote ?? null,
        });

        if (body.paymentMode === "stripe_connect") {
          const pi = await createPaymentIntentForOrder(created.orderId);
          return {
            orderId: created.orderId,
            orderNumber: created.orderNumber,
            totals: created.totals,
            payment: {
              mode: "stripe_connect",
              clientSecret: pi.clientSecret,
              paymentIntentId: pi.paymentIntentId,
            },
          };
        }
        return {
          orderId: created.orderId,
          orderNumber: created.orderNumber,
          totals: created.totals,
          payment: { mode: "offline_invoice" },
        };
      } catch (err) {
        return reply.status(400).send({
          error: "checkout_failed",
          message: err instanceof Error ? err.message : "Fehler",
        });
      }
    }
  );

  // ----------------------------------------------------------------------
  // GET /g/:slug/print-shop/order/:orderNumber
  // ----------------------------------------------------------------------
  // Bestaetigungsseite — kann mit Order-Number aufgerufen werden.
  // Schutz: Order muss zu derselben Galerie gehoeren wie der Slug, und
  // Visitor muss freigeschaltet sein. Plus: wir liefern KEINE sensiblen
  // Daten (z.B. komplette Adresse), nur fuer die Bestaetigung Noetiges.
  app.get<{ Params: { slug: string; orderNumber: string } }>(
    "/g/:slug/print-shop/order/:orderNumber",
    async (req, reply) => {
      const gal = await resolveGalleryForPrintShop(req.params.slug);
      if (!gal) return reply.status(404).send({ error: "not_found" });
      const visitor = await loadVisitor(
        req as Parameters<typeof loadVisitor>[0]
      );
      if (!visitor) return reply.status(401).send({ error: "unauthorized" });

      const order = await prisma.printOrder.findFirst({
        where: {
          orderNumber: req.params.orderNumber,
          galleryId: gal.galleryId,
        },
        include: {
          items: {
            include: {
              printProductVariant: {
                select: {
                  name: true,
                  widthMm: true,
                  heightMm: true,
                  printProduct: { select: { name: true, category: true } },
                },
              },
            },
          },
          shippingMethod: { select: { name: true } },
        },
      });
      if (!order) return reply.status(404).send({ error: "not_found" });

      const provider = getPrintProvider(order.providerKey);

      return {
        orderNumber: order.orderNumber,
        guestName: order.guestName,
        status: order.status,
        paymentMode: order.paymentMode,
        currency: order.currency,
        totals: {
          subtotalCents: order.subtotalCents,
          shippingCents: order.shippingCents,
          taxCents: order.taxCents,
          totalCents: order.totalCents,
        },
        items: order.items.map((i) => ({
          quantity: i.quantity,
          variantName: i.printProductVariant.name,
          productName: i.printProductVariant.printProduct.name,
          widthMm: i.printProductVariant.widthMm,
          heightMm: i.printProductVariant.heightMm,
          totalPriceCents: i.totalPriceCents,
        })),
        shippingMethod: order.shippingMethod?.name ?? null,
        trackingNumber: order.trackingNumber,
        trackingCarrier: order.trackingCarrier,
        trackingUrl: order.trackingUrl,
        providerLabel: provider?.label ?? order.providerKey,
        paidAt: order.paidAt ? order.paidAt.toISOString() : null,
        shippedAt: order.shippedAt ? order.shippedAt.toISOString() : null,
        deliveredAt: order.deliveredAt
          ? order.deliveredAt.toISOString()
          : null,
      };
    }
  );
}
