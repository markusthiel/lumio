/**
 * Lumio API — Billing Routes
 *
 * Nur aktiv, wenn BILLING_ENABLED=true (typisch im Hosted Mode mit DEPLOYMENT_MODE=multi).
 * Integriert sich via Stripe.
 *
 * Routen:
 *   GET    /billing/plans              — verfügbare Pläne (öffentlich)
 *   GET    /billing/subscription       — aktuelle Subscription (Tenant-Owner)
 *   POST   /billing/subscription       — Plan abonnieren → Stripe-Checkout-Session
 *   POST   /billing/subscription/cancel
 *   POST   /billing/portal             — Stripe-Customer-Portal-Link
 *   GET    /billing/usage              — Storage-/Bandwidth-Stand des Tenants
 *   POST   /billing/webhook            — Stripe-Webhook-Empfänger (ohne Auth, Signatur-Check)
 */
import type { FastifyInstance } from "fastify";

export async function registerBillingRoutes(app: FastifyInstance) {
  app.get("/billing/plans", async () => {
    // TODO: aus DB lesen, isActive=true, sortOrder
    return { plans: [] };
  });

  app.get("/billing/subscription", async (_req, reply) => {
    // TODO: Auth → tenant.subscription mit plan
    return reply.status(501).send({ error: "not_implemented" });
  });

  app.post("/billing/subscription", async (_req, reply) => {
    // TODO:
    //   1. Body: { planSlug, interval: 'monthly'|'yearly' }
    //   2. Stripe-Customer anlegen oder finden
    //   3. Checkout-Session erzeugen, success_url + cancel_url
    //   4. URL zurückgeben
    return reply.status(501).send({ error: "not_implemented" });
  });

  app.post("/billing/webhook", async (_req, reply) => {
    // TODO:
    //   1. raw body parsen (Stripe braucht raw für Signaturprüfung)
    //   2. stripe.webhooks.constructEvent(body, sig, secret)
    //   3. Events: checkout.session.completed, invoice.paid, customer.subscription.updated, customer.subscription.deleted
    //   4. BillingSubscription updaten, Tenant-Limits anpassen
    return reply.status(501).send({ error: "not_implemented" });
  });

  app.get("/billing/usage", async (_req, reply) => {
    // TODO: tenant.subscription mit Live-Berechnung der storageBytesUsed
    return reply.status(501).send({ error: "not_implemented" });
  });
}
