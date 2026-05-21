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
import { prisma } from "../db.js";
import { getTenantUsage } from "../services/usage.js";
import { PLANS, STORAGE_ADDON, type PlanSlug } from "../services/plans.js";

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
  // POST /billing/subscription   (Sprint 2)
  // -------------------------------------------------------------------------
  app.post("/billing/subscription", async (_req, reply) => {
    return reply.status(501).send({
      error: "not_implemented",
      message: "Subscription-Erstellung kommt in Sprint 2 mit Stripe.",
    });
  });

  // -------------------------------------------------------------------------
  // POST /billing/portal   (Sprint 2)
  // -------------------------------------------------------------------------
  app.post("/billing/portal", async (_req, reply) => {
    return reply.status(501).send({
      error: "not_implemented",
      message: "Stripe Customer-Portal kommt in Sprint 2.",
    });
  });

  // -------------------------------------------------------------------------
  // POST /billing/webhook   (Sprint 2)
  // -------------------------------------------------------------------------
  app.post("/billing/webhook", async (_req, reply) => {
    return reply.status(501).send({
      error: "not_implemented",
      message: "Webhook-Handling kommt in Sprint 2.",
    });
  });
}
