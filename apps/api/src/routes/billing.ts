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
import { prisma } from "../db.js";
import { config } from "../config.js";
import { getTenantUsage } from "../services/usage.js";
import { PLANS, STORAGE_ADDON, type PlanSlug } from "../services/plans.js";
import { getStripe, isStripeEnabled } from "../services/stripe-client.js";
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
    return {
      planSlug: sub.plan.slug,
      status: sub.status,
      billingInterval: sub.billingInterval,
      currentPeriodStart: sub.currentPeriodStart?.toISOString() ?? null,
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
      storageAddonGib: sub.storageAddonGib,
      hasStripeId: Boolean(sub.stripeSubscriptionId),
    };
  });

  // -------------------------------------------------------------------------
  // POST /billing/subscription   (Sprint 2 — Checkout-Session-Create kommt
  //                                im nächsten Foundation-Commit)
  // -------------------------------------------------------------------------
  app.post("/billing/subscription", async (_req, reply) => {
    return reply.status(501).send({
      error: "not_implemented",
      message: "Subscription-Erstellung kommt im nächsten Sprint-2-Commit.",
    });
  });

  // -------------------------------------------------------------------------
  // POST /billing/portal   (Sprint 2 — kommt nächste Session)
  // -------------------------------------------------------------------------
  app.post("/billing/portal", async (_req, reply) => {
    return reply.status(501).send({
      error: "not_implemented",
      message: "Stripe Customer-Portal kommt im nächsten Sprint-2-Commit.",
    });
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
