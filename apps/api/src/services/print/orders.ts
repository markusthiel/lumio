/**
 * Lumio API — Print-Order-Service
 *
 * Pricing, Order-Creation, State-Machine. Aufgerufen aus:
 *   - Public-Routes (Endkunden-Checkout)
 *   - Studio-Routes (Status-Updates vom Fotograf)
 *   - Webhook-Handler (payment_intent.succeeded → status='paid')
 */
import { prisma } from "../../db.js";
import { logger } from "../../logger.js";
import { sendMail } from "../mail.js";
import {
  tmplPrintOrderConfirmGuest,
  tmplPrintOrderNotifyStudio,
  tmplPrintOrderShippedGuest,
} from "../mail-print.js";
import { config } from "../../config.js";
import { studioNotifyEnabled } from "../notifications.js";

// Order-Number: LP-YYYYMMDD-XXXX, mit XXXX = 4 hex random.
// Kurz genug zum telefonieren, lang genug fuer Eindeutigkeit.
import { randomBytes } from "node:crypto";
function generateOrderNumber(): string {
  const now = new Date();
  const yyyymmdd = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
  const rand = randomBytes(2).toString("hex").toUpperCase();
  return `LP-${yyyymmdd}-${rand}`;
}

// =============================================================================
// Pricing
// =============================================================================
export interface CartItemInput {
  variantId: string;
  quantity: number;
  crop?: { x: number; y: number; width: number; height: number } | null;
  fileId: string;
}

export interface PricingResult {
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  applicationFeeCents: number;
  currency: string;
  vatBps: number;
  vatHandling: "inclusive" | "exclusive";
  /** Pro-Item-Aufschluesselung fuer Reporting / Order-Storage */
  items: Array<{
    variantId: string;
    fileId: string;
    quantity: number;
    unitPriceCents: number;
    totalPriceCents: number;
    crop: CartItemInput["crop"] | null;
  }>;
}

export async function priceCart(opts: {
  tenantId: string;
  galleryId: string;
  items: CartItemInput[];
  shippingMethodId: string | null;
}): Promise<PricingResult> {
  if (opts.items.length === 0) {
    throw new Error("Cart leer");
  }

  // Tenant-Config holen (VAT, Currency, Fee-Override)
  const cfg = await prisma.tenantPrintShopConfig.findUnique({
    where: { tenantId: opts.tenantId },
  });
  if (!cfg || !cfg.enabled) {
    throw new Error("Print-Shop nicht aktiv");
  }

  // Plan-Fee-Default holen
  const sub = await prisma.billingSubscription.findFirst({
    where: { tenantId: opts.tenantId, status: { in: ["active", "trialing"] } },
    include: { plan: true },
    orderBy: { createdAt: "desc" },
  });
  const planFeeBps = sub?.plan?.printApplicationFeeBps ?? 0;
  const effectiveFeeBps = cfg.applicationFeeBpsOverride ?? planFeeBps;

  // Variants laden + Ownership verifizieren
  const variantIds = opts.items.map((i) => i.variantId);
  const variants = await prisma.printProductVariant.findMany({
    where: {
      id: { in: variantIds },
      enabled: true,
      printProduct: { tenantId: opts.tenantId, enabled: true },
    },
    include: { printProduct: { select: { vatBpsOverride: true } } },
  });
  const variantMap = new Map(variants.map((v) => [v.id, v]));
  if (variantMap.size !== new Set(variantIds).size) {
    throw new Error("Eine Variante ist nicht (mehr) verfuegbar");
  }

  // Files verifizieren — muessen in der Galerie liegen + tenant-owned
  const fileIds = opts.items.map((i) => i.fileId);
  const files = await prisma.file.findMany({
    where: {
      id: { in: fileIds },
      galleryId: opts.galleryId,
    },
    select: { id: true },
  });
  if (files.length !== new Set(fileIds).size) {
    throw new Error("Ein Bild ist nicht in dieser Galerie verfuegbar");
  }

  // Shipping
  let shippingCents = 0;
  if (opts.shippingMethodId) {
    const sm = await prisma.shippingMethod.findFirst({
      where: {
        id: opts.shippingMethodId,
        tenantId: opts.tenantId,
        enabled: true,
      },
    });
    if (!sm) throw new Error("Versandmethode unbekannt");
    shippingCents = sm.priceCents;
  }

  // Subtotal pro Item
  const pricedItems = opts.items.map((i) => {
    const v = variantMap.get(i.variantId)!;
    const unit = v.priceCents;
    const lineTotal = unit * i.quantity;
    return {
      variantId: i.variantId,
      fileId: i.fileId,
      quantity: i.quantity,
      unitPriceCents: unit,
      totalPriceCents: lineTotal,
      crop: i.crop ?? null,
    };
  });
  const subtotalCents = pricedItems.reduce((s, i) => s + i.totalPriceCents, 0);

  // Tax: vereinfacht — gemeinsamer VAT-Bps (Mischsteuern muessten pro Variante
  // gerechnet werden; sparen wir uns aktuell, default genuegt)
  const vatBps = cfg.defaultVatBps;
  let taxCents: number;
  let totalCents: number;
  if (cfg.vatHandling === "inclusive") {
    // Preise sind Brutto; Steuer aus Brutto rausgerechnet
    const grossWithShipping = subtotalCents + shippingCents;
    taxCents = Math.round(
      (grossWithShipping * vatBps) / (10000 + vatBps)
    );
    totalCents = grossWithShipping;
  } else {
    // Preise sind Netto, Steuer kommt drauf
    taxCents = Math.round(((subtotalCents + shippingCents) * vatBps) / 10000);
    totalCents = subtotalCents + shippingCents + taxCents;
  }

  const applicationFeeCents = Math.round(
    (totalCents * effectiveFeeBps) / 10000
  );

  return {
    subtotalCents,
    shippingCents,
    taxCents,
    totalCents,
    applicationFeeCents,
    currency: cfg.currency,
    vatBps,
    vatHandling: cfg.vatHandling as "inclusive" | "exclusive",
    items: pricedItems,
  };
}

// =============================================================================
// Order-Creation
// =============================================================================
export interface CheckoutInput {
  tenantId: string;
  galleryId: string;
  items: CartItemInput[];
  shippingMethodId: string;
  guestEmail: string;
  guestName: string;
  shippingAddress: Record<string, unknown>;
  billingAddress?: Record<string, unknown> | null;
  paymentMode: "stripe_connect" | "offline_invoice";
  guestNote?: string | null;
}

/** Erstellt eine Order im Status 'pending_payment' (stripe_connect)
 *  oder 'paid' (offline_invoice, da kein Online-Payment nötig). */
export async function createOrder(input: CheckoutInput): Promise<{
  orderId: string;
  orderNumber: string;
  totals: PricingResult;
}> {
  const totals = await priceCart({
    tenantId: input.tenantId,
    galleryId: input.galleryId,
    items: input.items,
    shippingMethodId: input.shippingMethodId,
  });

  // Provider-Resolve: erste Variante reicht — alle Items eines Carts
  // muessen denselben Provider haben (sonst splitten wir spaeter).
  const firstVariant = await prisma.printProductVariant.findUnique({
    where: { id: input.items[0].variantId },
    include: { printProduct: { select: { providerKey: true } } },
  });
  if (!firstVariant) throw new Error("Variante nicht gefunden");
  const providerKey = firstVariant.printProduct.providerKey;

  const orderNumber = generateOrderNumber();
  const initialStatus =
    input.paymentMode === "offline_invoice" ? "paid" : "pending_payment";

  const order = await prisma.printOrder.create({
    data: {
      orderNumber,
      tenantId: input.tenantId,
      galleryId: input.galleryId,
      guestEmail: input.guestEmail.toLowerCase().trim(),
      guestName: input.guestName.trim(),
      shippingAddress: input.shippingAddress as never,
      billingAddress: (input.billingAddress ?? null) as never,
      paymentMode: input.paymentMode,
      subtotalCents: totals.subtotalCents,
      shippingCents: totals.shippingCents,
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
      applicationFeeCents: totals.applicationFeeCents,
      currency: totals.currency,
      status: initialStatus,
      providerKey,
      shippingMethodId: input.shippingMethodId,
      guestNote: input.guestNote ?? null,
      paidAt: input.paymentMode === "offline_invoice" ? new Date() : null,
      items: {
        create: totals.items.map((i) => ({
          printProductVariantId: i.variantId,
          fileId: i.fileId,
          crop: (i.crop ?? null) as never,
          quantity: i.quantity,
          unitPriceCents: i.unitPriceCents,
          totalPriceCents: i.totalPriceCents,
        })),
      },
      events: {
        create: {
          eventType: "created",
          actor: "guest",
          data: { paymentMode: input.paymentMode } as never,
        },
      },
    },
  });

  // Bei offline_invoice direkt Mails feuern (Endkunde + Studio).
  // Plus: 'mails_sent_paid'-Marker setzen damit der print-mail-sweeper
  // diese Order NICHT nochmal versucht (er sucht paid-Orders ohne
  // Marker). Bei stripe_connect kommt das erst nach
  // payment_intent.succeeded + Sweeper.
  if (input.paymentMode === "offline_invoice") {
    void sendOrderMails(order.id, "paid").catch((err) =>
      logger.warn({ err, orderId: order.id }, "print.order.mail_failed")
    );
    await prisma.printOrderEvent.create({
      data: {
        printOrderId: order.id,
        eventType: "mails_sent_paid",
        actor: "system",
        data: { trigger: "offline_invoice_inline" } as never,
      },
    });
  }

  return {
    orderId: order.id,
    orderNumber,
    totals,
  };
}

// =============================================================================
// State-Transitions
// =============================================================================
type Transition =
  | { type: "mark_paid"; actor: "system" | "studio"; actorUserId?: string }
  | { type: "mark_in_production"; actor: "studio" | "system"; actorUserId?: string }
  | {
      type: "mark_shipped";
      actor: "studio" | "system";
      actorUserId?: string;
      trackingNumber?: string;
      trackingCarrier?: string;
      trackingUrl?: string;
    }
  | { type: "mark_delivered"; actor: "studio" | "system"; actorUserId?: string }
  | { type: "cancel"; actor: "studio" | "system" | "guest"; actorUserId?: string; reason?: string }
  | { type: "refund"; actor: "studio" | "system"; actorUserId?: string; reason?: string };

export async function transitionOrder(
  orderId: string,
  t: Transition
): Promise<void> {
  const order = await prisma.printOrder.findUnique({
    where: { id: orderId },
  });
  if (!order) throw new Error("Order nicht gefunden");

  // Erlaubte Transitions je Quellzustand
  const allowed: Record<string, Transition["type"][]> = {
    draft: ["cancel"],
    pending_payment: ["mark_paid", "cancel"],
    paid: ["mark_in_production", "cancel", "refund"],
    in_production: ["mark_shipped", "cancel", "refund"],
    shipped: ["mark_delivered", "refund"],
    delivered: ["refund"],
    cancelled: [],
    refunded: [],
  };
  const allowedHere = allowed[order.status] ?? [];
  if (!allowedHere.includes(t.type)) {
    throw new Error(
      `Transition ${t.type} aus Status ${order.status} nicht erlaubt`
    );
  }

  const now = new Date();
  const updates: Record<string, unknown> = {};
  switch (t.type) {
    case "mark_paid":
      updates.status = "paid";
      updates.paidAt = now;
      break;
    case "mark_in_production":
      updates.status = "in_production";
      updates.productionStartedAt = now;
      break;
    case "mark_shipped":
      updates.status = "shipped";
      updates.shippedAt = now;
      if (t.trackingNumber) updates.trackingNumber = t.trackingNumber;
      if (t.trackingCarrier) updates.trackingCarrier = t.trackingCarrier;
      if (t.trackingUrl) updates.trackingUrl = t.trackingUrl;
      break;
    case "mark_delivered":
      updates.status = "delivered";
      updates.deliveredAt = now;
      break;
    case "cancel":
      updates.status = "cancelled";
      updates.cancelledAt = now;
      break;
    case "refund":
      updates.status = "refunded";
      updates.refundedAt = now;
      break;
  }

  // Wenn Refund: zuerst Stripe-Refund versuchen. Lazy-Import vermeidet
  // den Stripe-Init bei Modul-Load wenn STRIPE_SECRET_KEY nicht gesetzt
  // ist (z.B. Self-Hoster ohne Stripe).
  let stripeRefund: { refunded: boolean; refundId?: string; reason?: string } | null = null;
  if (t.type === "refund" && order.paymentMode === "stripe_connect" && order.stripeChargeId) {
    try {
      const { refundStripeChargeForOrder } = await import("./payment.js");
      stripeRefund = await refundStripeChargeForOrder(orderId);
    } catch (err) {
      // Stripe-Refund-Fehler ist NICHT fatal — wir setzen den Status
      // trotzdem auf 'refunded' und packen den Fehler ins Event-Data.
      // Der Fotograf sieht das in der Order-Timeline und kann den
      // Refund manuell im Stripe-Dashboard nachholen.
      logger.warn(
        { err, orderId },
        "print.order.stripe_refund_failed_continuing_with_status_change"
      );
      stripeRefund = {
        refunded: false,
        reason: err instanceof Error ? err.message : "stripe_error",
      };
    }
  }

  await prisma.printOrder.update({
    where: { id: orderId },
    data: {
      ...updates,
      events: {
        create: {
          eventType: t.type,
          actor: t.actor,
          actorUserId: t.actorUserId ?? null,
          data: {
            ...(extractEventData(t) ?? {}),
            ...(stripeRefund ? { stripeRefund } : {}),
          } as never,
        },
      },
    },
  });

  // Mail-Trigger
  if (t.type === "mark_paid") {
    void sendOrderMails(orderId, "paid").catch((err) =>
      logger.warn({ err, orderId }, "print.order.mail_failed")
    );
  } else if (t.type === "mark_shipped") {
    void sendOrderMails(orderId, "shipped").catch((err) =>
      logger.warn({ err, orderId }, "print.order.mail_failed")
    );
  }
}

function extractEventData(t: Transition): Record<string, unknown> | null {
  if (t.type === "mark_shipped") {
    return {
      trackingNumber: t.trackingNumber ?? null,
      trackingCarrier: t.trackingCarrier ?? null,
      trackingUrl: t.trackingUrl ?? null,
    };
  }
  if (t.type === "cancel" || t.type === "refund") {
    return { reason: t.reason ?? null };
  }
  return null;
}

// =============================================================================
// Mail-Versand bei Lifecycle-Events
// =============================================================================
/**
 * Versendet Endkunden- und Studio-Mails fuer einen Order-Lifecycle-
 * Event. Wird intern von createOrder() und transitionOrder() aufgerufen.
 * Plus extern vom print-mail-sweeper fuer Webhook-getriggerte paid-
 * Transitions (Stripe).
 */
export async function sendOrderMails(
  orderId: string,
  trigger: "paid" | "shipped"
): Promise<void> {
  const order = await prisma.printOrder.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { printProductVariant: true, file: true } },
      tenant: { select: { displayName: true, name: true } },
      shippingMethod: true,
    },
  });
  if (!order) return;

  const cfg = await prisma.tenantPrintShopConfig.findUnique({
    where: { tenantId: order.tenantId },
  });

  // Owner-E-Mail holen: erster aktiver Owner-User des Tenants.
  // (Tenant-Modell hat keinen direkten ownerEmail-Field — Owner sind
  // User mit role=owner.)
  const owner = await prisma.user.findFirst({
    where: { tenantId: order.tenantId, role: "owner", status: "active" },
    select: { email: true },
    orderBy: { createdAt: "asc" },
  });
  const ownerEmail = owner?.email ?? null;

  const studioName =
    cfg?.studioDisplayName ??
    order.tenant.displayName ??
    order.tenant.name;
  const supportEmail = cfg?.supportEmail ?? ownerEmail ?? "";

  // Adapter fuer OrderLike-Mail-Templates: file hat originalFilename
  const orderForMail = {
    ...order,
    items: order.items.map((i) => ({
      ...i,
      file: { id: i.file.id, filename: i.file.originalFilename },
    })),
  };

  if (trigger === "paid") {
    // Endkunde: Bestaetigung
    await sendMail({
      to: order.guestEmail,
      ...tmplPrintOrderConfirmGuest({
        studioName,
        supportEmail,
        order: orderForMail,
      }),
    });
    // Studio: Eingang
    if (ownerEmail && (await studioNotifyEnabled(order.tenantId, "print_order"))) {
      await sendMail({
        to: ownerEmail,
        ...tmplPrintOrderNotifyStudio({
          studioName,
          order: orderForMail,
          baseUrl: config.PUBLIC_URL,
        }),
      });
    }
  } else if (trigger === "shipped") {
    await sendMail({
      to: order.guestEmail,
      ...tmplPrintOrderShippedGuest({
        studioName,
        supportEmail,
        order: orderForMail,
      }),
    });
  }
}
