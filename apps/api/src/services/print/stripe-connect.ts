/**
 * Lumio API — Stripe-Connect-Service
 *
 * Wickelt das Connect-Express-Onboarding fuer Tenants ab. Ablauf:
 *
 *   1. Tenant klickt "Stripe-Connect einrichten" im Studio.
 *   2. Backend: createConnectAccount() legt einen Express-Account
 *      bei Stripe an und speichert die accountId in TenantStripeConnect.
 *   3. Backend: createAccountLink() generiert einen kurzlebigen
 *      Onboarding-Link bei Stripe. Frontend leitet auf den Link um.
 *   4. Tenant fuellt das Stripe-hosted Onboarding-Formular aus (KYC,
 *      IBAN, Steuernummer, etc.).
 *   5. Stripe redirected zurueck zu return_url (Lumio).
 *   6. Frontend ruft refresh() auf, was den aktuellen Status von
 *      Stripe synced (chargesEnabled, payoutsEnabled, detailsSubmitted).
 *
 * Stripe-Connect-Account-Lifecycle:
 *   - Onboarding kann mehrfach passieren (Tenant kann zurueckkommen
 *     und fehlende Angaben ergaenzen). Wir reuse die existierende
 *     accountId statt einen neuen Account anzulegen.
 *   - Sobald chargesEnabled UND payoutsEnabled true sind, kann der
 *     Tenant Print-Bestellungen mit Online-Bezahlung empfangen.
 *
 * Voraussetzung: in deinem Stripe-Dashboard muss Connect aktiviert sein
 * (Dashboard → Connect → Get started). Plus optional: Branding,
 * Onboarding-Texte.
 */
import { prisma } from "../../db.js";
import { config } from "../../config.js";
import { logger } from "../../logger.js";
import Stripe from "stripe";

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (_stripe) return _stripe;
  if (!config.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY not configured");
  }
  _stripe = new Stripe(config.STRIPE_SECRET_KEY, {
    apiVersion: "2025-01-27.acacia" as Stripe.LatestApiVersion,
  });
  return _stripe;
}

export interface ConnectStatus {
  configured: boolean;
  stripeConnectedAccountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  /** true wenn der Tenant Print-Bestellungen online empfangen kann */
  ready: boolean;
  onboardedAt: string | null;
}

/** Aktueller Connect-Status fuer einen Tenant (aus lokaler DB). */
export async function getConnectStatus(
  tenantId: string
): Promise<ConnectStatus> {
  const row = await prisma.tenantStripeConnect.findUnique({
    where: { tenantId },
  });
  if (!row) {
    return {
      configured: false,
      stripeConnectedAccountId: null,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      ready: false,
      onboardedAt: null,
    };
  }
  return {
    configured: true,
    stripeConnectedAccountId: row.stripeConnectedAccountId,
    chargesEnabled: row.chargesEnabled,
    payoutsEnabled: row.payoutsEnabled,
    detailsSubmitted: row.detailsSubmitted,
    ready: row.chargesEnabled && row.payoutsEnabled,
    onboardedAt: row.onboardedAt ? row.onboardedAt.toISOString() : null,
  };
}

/** Erstellt (oder gibt zurueck) den Connect-Account des Tenants und
 *  einen Onboarding-Link den der Tenant aufrufen soll. */
export async function startOnboarding(opts: {
  tenantId: string;
  tenantName: string;
  ownerEmail: string;
  returnUrl: string;
  refreshUrl: string;
}): Promise<{ onboardingUrl: string; stripeAccountId: string }> {
  const stripe = getStripe();

  // 1. Existierenden Account holen oder neuen anlegen
  let row = await prisma.tenantStripeConnect.findUnique({
    where: { tenantId: opts.tenantId },
  });

  let stripeAccountId = row?.stripeConnectedAccountId;
  if (!stripeAccountId) {
    const account = await stripe.accounts.create({
      type: "express",
      email: opts.ownerEmail,
      business_profile: {
        name: opts.tenantName,
        // mcc 7333 = Direct Marketing/Photo Studios (Stripe-Pflicht)
        mcc: "7333",
      },
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      // Service-Agreement default 'full' — der Tenant ist selbst
      // Vertragspartner. Wir sind nur die Software dazwischen.
      metadata: {
        lumio_tenant_id: opts.tenantId,
      },
    });
    stripeAccountId = account.id;
    row = await prisma.tenantStripeConnect.create({
      data: {
        tenantId: opts.tenantId,
        stripeConnectedAccountId: stripeAccountId,
      },
    });
    logger.info(
      { tenantId: opts.tenantId, stripeAccountId },
      "stripe-connect: account created"
    );
  }

  // 2. Onboarding-Link generieren (kurzlebig, ~5 Minuten gueltig bei
  //    Stripe). Bei Erfolg landet der User auf return_url. Bei Abbruch/
  //    Refresh auf refresh_url (oft dieselbe URL wie return).
  const link = await stripe.accountLinks.create({
    account: stripeAccountId,
    return_url: opts.returnUrl,
    refresh_url: opts.refreshUrl,
    type: "account_onboarding",
  });

  return {
    onboardingUrl: link.url,
    stripeAccountId,
  };
}

/** Synchronisiert den lokalen Status mit Stripe (z.B. nach
 *  Onboarding-Return). Auch idempotent — kann jederzeit aufgerufen
 *  werden, z.B. vom Webhook-Handler. */
export async function syncConnectAccount(tenantId: string): Promise<ConnectStatus> {
  const stripe = getStripe();
  const row = await prisma.tenantStripeConnect.findUnique({
    where: { tenantId },
  });
  if (!row) {
    return getConnectStatus(tenantId);
  }

  try {
    const account = await stripe.accounts.retrieve(row.stripeConnectedAccountId);
    const detailsSubmitted = account.details_submitted ?? false;
    const chargesEnabled = account.charges_enabled ?? false;
    const payoutsEnabled = account.payouts_enabled ?? false;
    const justOnboarded =
      !row.detailsSubmitted && detailsSubmitted;

    await prisma.tenantStripeConnect.update({
      where: { tenantId },
      data: {
        detailsSubmitted,
        chargesEnabled,
        payoutsEnabled,
        onboardedAt: justOnboarded ? new Date() : row.onboardedAt,
        lastWebhookSyncAt: new Date(),
      },
    });
  } catch (err) {
    logger.warn(
      { err, tenantId, stripeAccountId: row.stripeConnectedAccountId },
      "stripe-connect: sync failed"
    );
  }

  return getConnectStatus(tenantId);
}

/** Disconnect: loescht den Connect-Account bei Stripe und unseren
 *  DB-Eintrag. Tenant kann ohnehin nur via stripe_connect ODER
 *  offline_invoice bestellen — disconnect schaltet stripe_connect aus.
 *  Wenn Bestellungen im stripe_connect-Modus pending sind, wird der
 *  Disconnect verweigert. */
export async function disconnectAccount(tenantId: string): Promise<{ ok: boolean; reason?: string }> {
  const row = await prisma.tenantStripeConnect.findUnique({
    where: { tenantId },
  });
  if (!row) return { ok: true };

  // Pruefen ob aktive stripe_connect-Bestellungen existieren
  const activeOrders = await prisma.printOrder.count({
    where: {
      tenantId,
      paymentMode: "stripe_connect",
      status: { in: ["pending_payment", "paid", "in_production", "shipped"] },
    },
  });
  if (activeOrders > 0) {
    return {
      ok: false,
      reason: `Es gibt noch ${activeOrders} aktive Online-Bestellungen. Bitte erst abschliessen.`,
    };
  }

  try {
    const stripe = getStripe();
    await stripe.accounts.del(row.stripeConnectedAccountId);
  } catch (err) {
    // Falls Stripe den Account schon weg hat (z.B. manuell geloescht):
    // wir loeschen trotzdem unseren DB-Eintrag.
    logger.warn(
      { err, stripeAccountId: row.stripeConnectedAccountId },
      "stripe-connect: account.del failed, proceeding with local cleanup"
    );
  }

  await prisma.tenantStripeConnect.delete({ where: { tenantId } });
  return { ok: true };
}
