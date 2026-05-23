/**
 * Lumio API — Billing Routes
 *
 * Sprint 1: read-only Endpoints für Usage + Plan-Informationen.
 * Sprint 2: Stripe-Integration für Checkout, Subscription-Updates,
 *           Webhooks etc. — die TODO-Stubs hier bleiben für Sprint 2.
 *
 * Routen:
 *   GET    /billing/plans              — verfügbare Pläne (öffentlich)
 *   GET    /billing/usage              — aktueller Verbrauch + Limits (Auth)
 *   GET    /billing/subscription       — aktuelle Subscription (Auth)
 *
 * Sprint 2 ergänzt:
 *   POST   /billing/subscription       — Plan abonnieren → Stripe-Checkout
 *   POST   /billing/subscription/cancel
 *   POST   /billing/portal             — Stripe-Customer-Portal-Link
 *   POST   /billing/webhook            — Stripe-Webhook-Empfänger
 */
import type { FastifyInstance } from "fastify";
import type Stripe from "stripe";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { getTenantUsage } from "../services/usage.js";
import { PLANS, STORAGE_ADDON, type PlanSlug } from "../services/plans.js";
import { getStripe, isStripeEnabled } from "../services/stripe-client.js";
import { ensureStripeCustomer } from "../services/stripe-service.js";
import { enqueue, Queues } from "../services/queue.js";

export async function registerBillingRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // GET /billing/plans
  // -------------------------------------------------------------------------
  // Listet die buchbaren Pläne — wird für die Pricing-Seite und den
  // Sign-Up-Flow genutzt. Öffentlich, keine Auth nötig.
  app.get("/billing/plans", async () => {
    const slugs: PlanSlug[] = ["solo", "studio", "pro"];
    return {
      plans: slugs.map((slug) => ({
        slug,
        ...PLANS[slug],
        // Infinity ist nicht JSON-serialisierbar — als null ausliefern,
        // Frontend interpretiert null als "unbegrenzt".
        activeGalleries:
          PLANS[slug].activeGalleries === Number.POSITIVE_INFINITY
            ? null
            : PLANS[slug].activeGalleries,
        customDomains:
          PLANS[slug].customDomains === Number.POSITIVE_INFINITY
            ? null
            : PLANS[slug].customDomains,
      })),
      storageAddon: STORAGE_ADDON,
    };
  });

  // -------------------------------------------------------------------------
  // GET /billing/usage
  // -------------------------------------------------------------------------
  app.get("/billing/usage", async (req, reply) => {
    const s = req.requireAuth();
    void s;
    if (!req.tenantId) {
      return reply.status(401).send({ error: "tenant_unknown" });
    }
    const usage = await getTenantUsage(req.tenantId);
    return {
      plan: {
        slug: usage.planSlug,
        ...usage.plan,
        activeGalleries:
          usage.plan.activeGalleries === Number.POSITIVE_INFINITY
            ? null
            : usage.plan.activeGalleries,
        customDomains:
          usage.plan.customDomains === Number.POSITIVE_INFINITY
            ? null
            : usage.plan.customDomains,
      },
      subscriptionStatus: usage.subscriptionStatus,
      storageAddonGib: usage.storageAddonGib,
      storage: {
        usedBytes: usage.storageBytesUsed.toString(),
        limitBytes: usage.storageLimitBytes.toString(),
        breakdown: {
          originalsBytes: usage.storageBreakdown.originalsBytes.toString(),
          renditionsBytes: usage.storageBreakdown.renditionsBytes.toString(),
        },
      },
      galleries: {
        active: usage.activeGalleries,
        total: usage.totalGalleries,
      },
      customDomains: usage.customDomainsUsed,
      brandings: usage.brandingsUsed,
      teamMembers: usage.teamMembers,
      trialEndsAt: usage.trialEndsAt?.toISOString() ?? null,
      readOnlySince: usage.readOnlySince?.toISOString() ?? null,
    };
  });

  // -------------------------------------------------------------------------
  // GET /billing/subscription
  // -------------------------------------------------------------------------
  app.get("/billing/subscription", async (req, reply) => {
    const s = req.requireAuth();
    void s;
    if (!req.tenantId) {
      return reply.status(401).send({ error: "tenant_unknown" });
    }
    const sub = await prisma.billingSubscription.findUnique({
      where: { tenantId: req.tenantId },
      include: { plan: true },
    });
    if (!sub) {
      return reply.status(404).send({ error: "no_subscription" });
    }
    // Trial-Restlaufzeit in Tagen, gerundet. Wenn schon vorbei: 0.
    let trialDaysRemaining: number | null = null;
    if (sub.trialEndsAt) {
      const msLeft = sub.trialEndsAt.getTime() - Date.now();
      trialDaysRemaining = Math.max(0, Math.ceil(msLeft / 86400000));
    }
    // Tage seit Read-only — UI kann damit den 30-Tage-Countdown zur
    // Suspension zeigen ("noch 12 Tage bis zur Archivierung").
    let readOnlyDays: number | null = null;
    if (sub.readOnlySince) {
      readOnlyDays = Math.floor(
        (Date.now() - sub.readOnlySince.getTime()) / 86400000
      );
    }
    return {
      planSlug: sub.plan.slug,
      planName: sub.plan.name,
      status: sub.status,
      billingInterval: sub.billingInterval,
      currentPeriodStart: sub.currentPeriodStart?.toISOString() ?? null,
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
      trialDaysRemaining,
      readOnlySince: sub.readOnlySince?.toISOString() ?? null,
      readOnlyDays,
      storageAddonGib: sub.storageAddonGib,
      hasStripeId: Boolean(sub.stripeSubscriptionId),
      // Plan-Limits für UI-Anzeige (Storage-Bar, Galerie-Counter)
      limits: {
        storageGib: sub.plan.storageGib,
        galleriesMax: sub.plan.galleriesMax,
        customDomain: sub.plan.customDomain,
        watermarking: sub.plan.watermarking,
        priceMonthlyCents: sub.plan.priceMonthlyCents,
        priceYearlyCents: sub.plan.priceYearlyCents,
        currency: sub.plan.currency,
      },
    };
  });

  // -------------------------------------------------------------------------
  // POST /billing/subscription
  // -------------------------------------------------------------------------
  // Plan-Upgrade oder erstmaliges Abonnement nach Trial. Tenant muss
  // eingeloggt sein, gibt seinen Wunsch-Plan an, kriegt eine Stripe-
  // Checkout-URL zurück. Bei bestehender Subscription = Upgrade-Flow
  // (Stripe rechnet Proration automatisch).
  //
  // Body: { plan: "solo"|"studio"|"pro", interval: "monthly"|"yearly" }
  app.post("/billing/subscription", async (req, reply) => {
    const s = req.requireAuth();
    if (!req.tenantId) {
      return reply.status(400).send({ error: "no_tenant" });
    }
    if (!isStripeEnabled()) {
      return reply.status(503).send({ error: "billing_disabled" });
    }

    const body = z
      .object({
        plan: z.enum(["solo", "studio", "pro"]),
        interval: z.enum(["monthly", "yearly"]).default("monthly"),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({
        error: "invalid_input",
        issues: body.error.issues,
      });
    }

    const plan = await prisma.billingPlan.findUnique({
      where: { slug: body.data.plan },
    });
    if (!plan) {
      return reply.status(500).send({ error: "plan_not_configured" });
    }
    const priceId =
      body.data.interval === "yearly"
        ? plan.stripePriceIdYearly
        : plan.stripePriceIdMonthly;
    if (!priceId) {
      return reply.status(500).send({ error: "price_not_configured" });
    }

    // Stripe-Customer sicherstellen (idempotent — bei bestehendem
    // Tenant fast immer schon angelegt vom Sign-up)
    const customerId = await ensureStripeCustomer(req.tenantId);

    // Bestehende Subscription? → Update-Flow direkt, KEINE Checkout-
    // Session. Stripe rechnet Proration automatisch.
    const existing = await prisma.billingSubscription.findUnique({
      where: { tenantId: req.tenantId },
      select: {
        stripeSubscriptionId: true,
        stripePlanItemId: true,
        status: true,
      },
    });

    if (
      existing?.stripeSubscriptionId &&
      existing?.stripePlanItemId &&
      ["active", "trialing", "past_due"].includes(existing.status)
    ) {
      // Direct Item-Update — Stripe lässt es proraten + die nächste
      // Invoice spiegelt die Differenz. Webhook updated dann unsere DB.
      const stripe = getStripe();
      await stripe.subscriptions.update(existing.stripeSubscriptionId, {
        items: [
          {
            id: existing.stripePlanItemId,
            price: priceId,
          },
        ],
        proration_behavior: "create_prorations",
      });

      app.log.info(
        {
          tenantId: req.tenantId,
          userId: s.user.id,
          newPlan: body.data.plan,
          newInterval: body.data.interval,
        },
        "billing.plan_changed_in_place"
      );
      return {
        upgraded: true,
        message: "Plan-Wechsel sofort wirksam. Rechnung folgt anteilig.",
      };
    }

    // Sonst: neue Checkout-Session (für nicht-aktive oder gar nicht
    // existente Subscription). Trial gibt's bei manuellem Upgrade
    // nicht mehr.
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      // Siehe signup.ts: notwendig damit Stripe Tax die im Checkout
      // eingegebene Adresse für die MwSt-Berechnung verwenden kann.
      customer_update: {
        address: "auto",
        name: "auto",
      },
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        metadata: { lumio_tenant_id: req.tenantId },
      },
      payment_method_collection: "always",
      automatic_tax: { enabled: true },
      tax_id_collection: { enabled: true },
      billing_address_collection: "required",
      allow_promotion_codes: true,
      success_url: `${config.STRIPE_RETURN_URL_BASE}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.STRIPE_RETURN_URL_BASE}/billing`,
      metadata: {
        lumio_tenant_id: req.tenantId,
      },
    });

    return { checkoutUrl: session.url, sessionId: session.id };
  });

  // -------------------------------------------------------------------------
  // POST /billing/portal
  // -------------------------------------------------------------------------
  // Customer Portal — Stripe-hostet alles: Karte ändern, Rechnungen
  // ansehen, Plan wechseln, kündigen. Wir generieren nur den Link mit
  // return_url zurück ins Studio.
  app.post("/billing/portal", async (req, reply) => {
    req.requireAuth();
    if (!req.tenantId) {
      return reply.status(400).send({ error: "no_tenant" });
    }
    if (!isStripeEnabled()) {
      return reply.status(503).send({ error: "billing_disabled" });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      select: { stripeCustomerId: true },
    });
    if (!tenant?.stripeCustomerId) {
      return reply.status(409).send({
        error: "no_stripe_customer",
        message: "Noch keine Stripe-Verknüpfung. Bitte Plan abonnieren.",
      });
    }

    const stripe = getStripe();
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: tenant.stripeCustomerId,
      return_url: `${config.STRIPE_RETURN_URL_BASE}/studio/settings`,
    });
    return { portalUrl: portalSession.url };
  });

  // -------------------------------------------------------------------------
  // POST /billing/webhook
  // -------------------------------------------------------------------------
  // Stripe schickt hier Events: subscription.created/updated/deleted,
  // invoice.paid, invoice.payment_failed, checkout.session.completed.
  //
  // Verarbeitung:
  //   1. Signatur prüfen (constructEvent mit raw body)
  //   2. Dedup-Check via stripe_webhook_events.stripeEventId (unique)
  //   3. Event in DB persisten mit status='received'
  //   4. Job in Redis-Stream legen (stripe-Worker arbeitet asynchron)
  //   5. Sofort 200 OK an Stripe (Webhook-Health bleibt grün)
  //
  // Wichtig: KEINE business-logic hier inline. Wenn diese Route lange
  // braucht oder failed, geht Stripe in den Retry-Backoff und unsere
  // Webhook-Delivery-Reputation sinkt. Alles aufwendige macht der Worker.
  app.post("/billing/webhook", async (req, reply) => {
    if (!isStripeEnabled()) {
      return reply.status(503).send({ error: "stripe_disabled" });
    }
    if (!config.STRIPE_WEBHOOK_SECRET) {
      app.log.error("billing.webhook.no_secret_configured");
      return reply.status(503).send({ error: "webhook_secret_missing" });
    }

    // Stripe braucht raw Body für die Signatur-Validierung. Fastify
    // hat den schon JSON-geparst (default), aber wir registrieren
    // eine eigene RawBody-Variante via app.addContentTypeParser
    // (siehe server.ts setup). Hier prüfen wir dass rawBody da ist.
    const sig = req.headers["stripe-signature"];
    const rawBody = (req as { rawBody?: Buffer | string }).rawBody;
    if (!sig || typeof sig !== "string" || !rawBody) {
      app.log.warn(
        { hasSig: !!sig, hasBody: !!rawBody },
        "billing.webhook.invalid_signature_or_body"
      );
      return reply.status(400).send({ error: "bad_request" });
    }

    let event: Stripe.Event;
    try {
      event = getStripe().webhooks.constructEvent(
        rawBody,
        sig,
        config.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      app.log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "billing.webhook.signature_verification_failed"
      );
      return reply.status(400).send({ error: "invalid_signature" });
    }

    // Dedup via unique-Constraint auf stripeEventId. Bei Doppel-
    // Receive (Stripe sendet manche Events zweimal) wirft das
    // INSERT, wir fangen und antworten mit 200 OK — der erste
    // Receive hat den Event schon enqueued.
    try {
      await prisma.stripeWebhookEvent.create({
        data: {
          stripeEventId: event.id,
          type: event.type,
          payload: event as unknown as Prisma.InputJsonValue,
          status: "received",
        },
      });
    } catch (err) {
      // Prisma P2002 = unique violation
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        err.code === "P2002"
      ) {
        app.log.info(
          { eventId: event.id, type: event.type },
          "billing.webhook.duplicate_received"
        );
        return reply.status(200).send({ duplicate: true });
      }
      throw err;
    }

    // Job in Redis-Stream legen. Stripe-Worker arbeitet das ab.
    // Wenn enqueue scheitert (Redis weg), bleibt der DB-Row mit
    // status='received' stehen — ein Reconciler-Job könnte solche
    // hängenden Events später nachholen (Roadmap).
    try {
      await enqueue(Queues.STRIPE_WEBHOOK, {
        type: "stripe_webhook",
        eventId: event.id,
      });
    } catch (err) {
      app.log.error(
        { err, eventId: event.id },
        "billing.webhook.enqueue_failed"
      );
      // Trotzdem 200 zurückgeben — Stripe würde sonst retryen, was
      // den DB-Row nur dupliziert (nein, der unique-key fängt das,
      // aber unnötiger Traffic). Reconciler kommt später.
    }

    return reply.status(200).send({ received: true });
  });
}
