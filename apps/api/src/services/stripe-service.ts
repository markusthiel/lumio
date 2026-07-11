/**
 * Lumio API — Stripe Service (Foundation)
 *
 * Wrapper um die Stripe-API mit Lumio-Domain-Logik. Hier sind die
 * Operations, die sowohl vom Studio-Endpoint (Checkout-Init,
 * Portal-Link) als auch vom Webhook-Worker (Subscription-Updates)
 * gebraucht werden.
 *
 * Konventionen:
 *   - Functions sind side-effecting auf Stripe + DB.
 *   - Customer-IDs werden lifetime-stabil auf tenants.stripeCustomerId
 *     gehalten. Wenn ein Tenant Cancel → später wieder Subscribe macht,
 *     bleibt's derselbe Stripe-Customer (Karten + Adresse + Tax-IDs
 *     bleiben in Stripe gespeichert).
 *   - Tenant-Owner-User wird als customer.email verwendet. Wenn der
 *     Owner-User später wechselt, müssen wir den Customer in Stripe
 *     manuell updaten (Subscription bleibt aber am alten Tenant).
 */
import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { getStripe } from "./stripe-client.js";
import type Stripe from "stripe";

/** Sicherstellen dass ein Tenant einen Stripe-Customer hat. Wenn ja
 * → bestehende ID zurückgeben. Wenn nein → neuen Customer in Stripe
 * anlegen und tenants.stripeCustomerId persisten.
 *
 * Wichtig: idempotent. Beim ersten Sign-up wird der Customer angelegt;
 * spätere Calls geben dieselbe ID zurück ohne Stripe-API-Aufruf. */
export async function ensureStripeCustomer(
  tenantId: string
): Promise<string> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      slug: true,
      stripeCustomerId: true,
      users: {
        where: { role: "owner" },
        select: { email: true, name: true },
        take: 1,
      },
    },
  });
  if (!tenant) throw new Error(`Tenant ${tenantId} not found`);
  if (tenant.stripeCustomerId) return tenant.stripeCustomerId;

  const owner = tenant.users[0];
  if (!owner) {
    throw new Error(
      `Tenant ${tenantId} has no owner user — kann keinen Stripe-Customer ohne E-Mail anlegen.`
    );
  }

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: owner.email,
    name: tenant.name,
    metadata: {
      lumio_tenant_id: tenant.id,
      lumio_tenant_slug: tenant.slug,
    },
    // Tax-Adress-Erfassung enabled — Stripe bekommt das Land aus
    // der Karte oder fragt im Checkout-Flow nach.
    tax: { validate_location: "deferred" },
  });

  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { stripeCustomerId: customer.id },
  });

  return customer.id;
}

/** Stripe-Customer-ID → Lumio-Tenant-ID auflösen. Wird vom Webhook-
 * Worker gebraucht: Webhook kommt mit customer.id, wir müssen den
 * Tenant finden. */
export async function findTenantByStripeCustomerId(
  customerId: string
): Promise<{ id: string } | null> {
  return prisma.tenant.findUnique({
    where: { stripeCustomerId: customerId },
    select: { id: true },
  });
}

/** Stripe-Subscription-Object → DB-Update.
 *
 * Wird sowohl vom Webhook-Worker aufgerufen (customer.subscription.created
 * oder .updated) als auch beim Initial-Checkout-Complete. Idempotent:
 * doppelte Aufrufe mit gleichem State sind no-op. */
export async function syncSubscriptionFromStripe(
  tenantId: string,
  sub: Stripe.Subscription
): Promise<void> {
  // Items aufdröseln: ein Subscription kann mehrere Items haben
  // (z.B. Plan + Storage-Pack). Wir matchen via Price-ID auf die
  // billing_plans-Tabelle.
  const planItem = sub.items.data.find((item) =>
    item.price.lookup_key?.startsWith("plan_")
  );
  const storageAddonItem = sub.items.data.find((item) =>
    item.price.lookup_key?.startsWith("storage_pack_")
  );

  if (!planItem) {
    throw new Error(
      `Subscription ${sub.id} hat kein Plan-Item — lookup_keys: ${sub.items.data.map((i) => i.price.lookup_key).join(", ")}`
    );
  }

  // Plan in DB nachschlagen via Stripe-Price-ID
  const plan = await prisma.billingPlan.findFirst({
    where: {
      OR: [
        { stripePriceIdMonthly: planItem.price.id },
        { stripePriceIdYearly: planItem.price.id },
      ],
    },
  });
  if (!plan) {
    throw new Error(
      `Plan für Stripe-Price ${planItem.price.id} nicht in DB gefunden — Bootstrap-Script gelaufen?`
    );
  }

  // Storage-Pack-Quantity (kann 0 sein wenn keiner gekauft)
  const storageAddonGib =
    storageAddonItem && storageAddonItem.quantity
      ? storageAddonItem.quantity * 50 // 50 GiB pro Pack
      : 0;

  const billingInterval =
    planItem.price.id === plan.stripePriceIdYearly ? "yearly" : "monthly";

  // Stripe API 2025-08-27+: current_period_start/end leben auf den
  // Subscription-Items, nicht mehr auf der Subscription selbst.
  // Wir lesen primär vom Item, fallback auf die Sub.
  type WithPeriod = {
    current_period_start?: number;
    current_period_end?: number;
  };
  const planItemAny = planItem as WithPeriod;
  const subAny = sub as Stripe.Subscription & WithPeriod;
  const periodStartTs =
    planItemAny.current_period_start ??
    subAny.current_period_start ??
    sub.start_date ??
    null;
  const periodEndTs =
    planItemAny.current_period_end ??
    subAny.current_period_end ??
    sub.trial_end ??
    null;
  if (!periodStartTs || !periodEndTs) {
    throw new Error(
      `Subscription ${sub.id} hat keine current_period_*-Werte — ` +
        `Sub-Keys: ${Object.keys(sub).slice(0, 20).join(",")}, ` +
        `Item-Keys: ${Object.keys(planItem).slice(0, 20).join(",")}`
    );
  }
  const currentPeriodStart = new Date(periodStartTs * 1000);
  const currentPeriodEnd = new Date(periodEndTs * 1000);

  await prisma.billingSubscription.upsert({
    where: { tenantId },
    update: {
      planId: plan.id,
      status: sub.status,
      billingInterval,
      // Sobald ein echtes Stripe-Abo synchronisiert wird, ist es kein
      // manuell zugewiesenes Gratis-Abo mehr — comped zurücksetzen, damit
      // der jetzt zahlende Tenant wieder in die MRR zählt. (Greift z.B.
      // wenn ein comped-Partner über sein Studio einen Plan bucht.)
      comped: false,
      stripeSubscriptionId: sub.id,
      stripePlanItemId: planItem.id,
      stripeStorageAddonItemId: storageAddonItem?.id ?? null,
      storageAddonGib,
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
      // readOnlySince beim Recovery zurücksetzen
      ...(sub.status === "active" || sub.status === "trialing"
        ? { readOnlySince: null }
        : {}),
    },
    create: {
      tenantId,
      planId: plan.id,
      status: sub.status,
      billingInterval,
      stripeSubscriptionId: sub.id,
      stripePlanItemId: planItem.id,
      stripeStorageAddonItemId: storageAddonItem?.id ?? null,
      storageAddonGib,
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    },
  });

  // Reaktivierung aus dem Archiv: wenn wieder ein aktives/trial-Abo
  // besteht, Archiv-Flags leeren und Renditions neu erzeugen. No-op,
  // wenn der Tenant nie archiviert war.
  if (sub.status === "active" || sub.status === "trialing") {
    try {
      const { clearArchiveOnReactivation } = await import(
        "./billing-archive.js"
      );
      await clearArchiveOnReactivation(tenantId);
    } catch (err) {
      logger.warn(
        { err, tenantId },
        "stripe: clearArchiveOnReactivation failed (non-fatal)"
      );
    }
  }
}

/** Kündigt die Stripe-Subscription eines Tenants sofort (nicht period-
 * end). Wird beim Archive-Endpoint aufgerufen — Tenant soll nicht
 * weiter abgerechnet werden sobald er stillgelegt ist.
 *
 * Defensiv:
 *  - Wenn der Tenant keine Subscription hat (BillingSubscription-Row
 *    fehlt oder stripeSubscriptionId ist null): no-op, kein Fehler.
 *  - Wenn die Stripe-API antwortet 404 (Subscription gibt's nicht
 *    mehr, z.B. schon manuell im Dashboard gekündigt): no-op, wir
 *    loggen die Info aber werfen nicht.
 *  - Bei anderen Stripe-Fehlern: weiter werfen, Aufrufer entscheidet
 *    wie damit umgegangen wird (Archive selbst sollte nicht failen,
 *    Subscription-Cancel ist Best-Effort).
 *
 * Cancel-Strategie: prorate=false. Tenant hat schon bezahlt, also
 * keine Refunds — wir wollen einfach den Vertrag sofort beenden.
 * Falls ein anteiliger Refund gewünscht ist, macht der Super-Admin
 * das manuell im Stripe-Dashboard.
 */
export async function cancelSubscriptionImmediately(
  tenantId: string
): Promise<{ canceled: boolean; reason: string }> {
  const sub = await prisma.billingSubscription.findUnique({
    where: { tenantId },
    select: { stripeSubscriptionId: true },
  });
  if (!sub?.stripeSubscriptionId) {
    return { canceled: false, reason: "no_subscription" };
  }
  const stripe = getStripe();
  try {
    await stripe.subscriptions.cancel(sub.stripeSubscriptionId, {
      prorate: false,
    });
    // DB-Update lassen wir bewusst aus — der Stripe-Webhook
    // (customer.subscription.deleted) wird gleich danach unsere
    // BillingSubscription.status auf 'canceled' setzen. Doppelte
    // Updates wären überflüssig. Sollte der Webhook ausfallen, wird
    // beim Hard-Delete eh die ganze BillingSubscription via Cascade
    // entfernt.
    return { canceled: true, reason: "ok" };
  } catch (err) {
    const stripeErr = err as { statusCode?: number; code?: string };
    if (stripeErr.statusCode === 404) {
      // Subscription existiert in Stripe nicht mehr — z.B. manuell
      // im Dashboard storniert. Kein Fehler, einfach loggen.
      return { canceled: false, reason: "not_found_in_stripe" };
    }
    throw err;
  }
}

/**
 * Löscht einen Stripe-Customer komplett (inkl. aller seiner Subscriptions,
 * die Stripe dabei automatisch kündigt). Nur für Test-/Trial-Aufräumen
 * gedacht — bei echten zahlenden Kunden behält man den Customer für die
 * Buchhaltung. Best-Effort: meldet das Ergebnis statt zu werfen.
 */
export async function deleteStripeCustomer(
  customerId: string | null | undefined
): Promise<{ deleted: boolean; reason: string }> {
  if (!customerId) return { deleted: false, reason: "no_customer" };
  const stripe = getStripe();
  try {
    await stripe.customers.del(customerId);
    return { deleted: true, reason: "ok" };
  } catch (err) {
    const e = err as { statusCode?: number };
    if (e.statusCode === 404) {
      return { deleted: false, reason: "not_found_in_stripe" };
    }
    return {
      deleted: false,
      reason: err instanceof Error ? err.message : "stripe_error",
    };
  }
}

/**
 * Trial-Ende einer Subscription nach vorne verschieben.
 *
 * Use-Case: Owner braucht ein paar Tage mehr Zeit zum Evaluieren.
 * Aktualisiert sowohl Stripe (damit dort weiterhin kein Geld eingezogen
 * wird) als auch unsere DB (damit das Studio die richtigen Limits zeigt).
 *
 * Stripe-API: subscriptions.update mit trial_end. Wenn Subscription
 * aktuell nicht in trialing-Status ist, schlaegt Stripe das ab — wir
 * checken das im Service und geben einen klaren Fehler zurueck.
 */
export async function extendTrial(
  tenantId: string,
  extraDays: number
): Promise<
  | { ok: true; newTrialEnd: Date }
  | { ok: false; reason: "no_subscription" | "not_trialing" | "stripe_error"; message?: string }
> {
  const sub = await prisma.billingSubscription.findUnique({
    where: { tenantId },
    select: {
      stripeSubscriptionId: true,
      status: true,
      trialEndsAt: true,
    },
  });
  if (!sub) return { ok: false, reason: "no_subscription" };
  if (sub.status !== "trialing") {
    return { ok: false, reason: "not_trialing" };
  }

  const base = sub.trialEndsAt ? sub.trialEndsAt.getTime() : Date.now();
  const newTrialEnd = new Date(base + extraDays * 24 * 60 * 60 * 1000);

  // Wenn keine Stripe-Sub: nur lokal updaten (Tenants ohne Stripe-Anbindung
  // — z.B. Self-Hosting oder manuell ohne Stripe angelegte Test-Tenants).
  if (!sub.stripeSubscriptionId) {
    await prisma.billingSubscription.update({
      where: { tenantId },
      data: { trialEndsAt: newTrialEnd },
    });
    return { ok: true, newTrialEnd };
  }

  const stripe = getStripe();
  try {
    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      trial_end: Math.floor(newTrialEnd.getTime() / 1000),
      // proration_behavior=none: wir wollen keine Prorationsrechnung
      // weil der Tenant noch im Trial ist
      proration_behavior: "none",
    });
    // DB-Update — wir koennten auch auf den Webhook warten, aber das
    // Frontend soll die neue Zeit sofort sehen. Webhook wird das gleiche
    // setzen, idempotent.
    await prisma.billingSubscription.update({
      where: { tenantId },
      data: { trialEndsAt: newTrialEnd },
    });
    return { ok: true, newTrialEnd };
  } catch (err) {
    const stripeErr = err as { statusCode?: number; message?: string };
    return {
      ok: false,
      reason: "stripe_error",
      message: stripeErr.message ?? "Stripe-API-Fehler",
    };
  }
}

/**
 * Trial sofort beenden → Stripe rechnet umgehend ab.
 *
 * Use-Case: Der Owner ist überzeugt und will nicht die vollen 14 Tage
 * warten — wir ziehen die erste Abbuchung auf jetzt vor. Stripe beendet
 * die Trial (trial_end=now), finalisiert die erste Rechnung und zieht
 * die hinterlegte Karte ein. Der finale Zahlungs-Ausgang kommt über die
 * Webhooks (invoice.paid → active / invoice.payment_failed → past_due);
 * wir übernehmen optimistisch den zurückgegebenen Status, der Webhook
 * korrigiert idempotent nach.
 *
 * Voraussetzung: status=trialing UND eine Stripe-Subscription mit
 * hinterlegter Karte. Ohne stripeSubscriptionId (kartenlose Trial) gibt
 * es nichts abzurechnen — dann muss der User den regulären Checkout
 * durchlaufen (der ohnehin ohne Trial sofort zahlt).
 */
export async function endTrialNow(
  tenantId: string
): Promise<
  | { ok: true; status: string }
  | {
      ok: false;
      reason:
        | "no_subscription"
        | "no_payment_method"
        | "not_trialing"
        | "stripe_error";
      message?: string;
    }
> {
  const sub = await prisma.billingSubscription.findUnique({
    where: { tenantId },
    select: { stripeSubscriptionId: true, status: true },
  });
  if (!sub) return { ok: false, reason: "no_subscription" };
  if (sub.status !== "trialing") {
    return { ok: false, reason: "not_trialing" };
  }
  // Kartenlose Trial → nichts abzurechnen. Client soll den regulären
  // Checkout öffnen (zahlt ohne Trial sofort).
  if (!sub.stripeSubscriptionId) {
    return { ok: false, reason: "no_payment_method" };
  }

  const stripe = getStripe();
  try {
    const updated = await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      trial_end: "now",
      // Keine Proration — wir starten einfach die erste reguläre Periode.
      proration_behavior: "none",
    });
    // Optimistischer Sync: trialEndsAt leeren, Status übernehmen. Der
    // Webhook (_sync_subscription / invoice.*) setzt currentPeriodEnd +
    // finalen Status idempotent nach. readOnlySince beim Übergang in
    // active/trialing zurücksetzen (Recovery), analog zum Webhook.
    await prisma.billingSubscription.update({
      where: { tenantId },
      data: {
        status: updated.status,
        trialEndsAt: null,
        cancelAtPeriodEnd: updated.cancel_at_period_end,
        ...(updated.status === "active" || updated.status === "trialing"
          ? { readOnlySince: null }
          : {}),
      },
    });
    return { ok: true, status: updated.status };
  } catch (err) {
    const stripeErr = err as { statusCode?: number; message?: string };
    return {
      ok: false,
      reason: "stripe_error",
      message: stripeErr.message ?? "Stripe-API-Fehler",
    };
  }
}
