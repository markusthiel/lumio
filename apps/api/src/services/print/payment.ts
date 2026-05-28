/**
 * Lumio API — Print-Payment-Service
 *
 * Erstellt Stripe-PaymentIntents fuer Print-Bestellungen im Connect-
 * Modell. Geld geht direkt an den Connected Account des Fotografen,
 * Lumio bekommt einen application_fee_amount-Anteil.
 *
 * Endkunden-Flow:
 *   1. Frontend ruft Order-Create-Endpoint (createOrder) — Order ist
 *      'pending_payment'
 *   2. Backend erstellt PaymentIntent, gibt client_secret zurueck
 *   3. Frontend bestaetigt Payment via Stripe.js (confirmPayment)
 *   4. Stripe Webhook payment_intent.succeeded → transitionOrder
 *      mark_paid → Mails an Endkunde + Studio
 */
import Stripe from "stripe";
import { prisma } from "../../db.js";
import { config } from "../../config.js";

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

/** Erstellt einen PaymentIntent fuer eine bereits angelegte Print-Order
 *  im stripe_connect-Modus. Aktualisiert order.stripePaymentIntentId.
 *  Wirft wenn der Tenant keinen aktiven Connect-Account hat. */
export async function createPaymentIntentForOrder(
  orderId: string
): Promise<{ clientSecret: string; paymentIntentId: string }> {
  const order = await prisma.printOrder.findUnique({
    where: { id: orderId },
  });
  if (!order) throw new Error("Order nicht gefunden");
  if (order.paymentMode !== "stripe_connect") {
    throw new Error("Order ist nicht im stripe_connect-Modus");
  }
  if (order.status !== "pending_payment") {
    throw new Error(
      `Order im Status '${order.status}' — kein PaymentIntent moeglich`
    );
  }

  const connect = await prisma.tenantStripeConnect.findUnique({
    where: { tenantId: order.tenantId },
  });
  if (!connect || !connect.chargesEnabled) {
    throw new Error(
      "Tenant hat keinen aktiven Stripe-Connect-Account fuer Online-Zahlungen"
    );
  }

  // Idempotent: existiert schon ein PaymentIntent fuer diese Order?
  // (z.B. User hat Checkout neugeladen)
  if (order.stripePaymentIntentId) {
    const existing = await getStripe().paymentIntents.retrieve(
      order.stripePaymentIntentId,
      { stripeAccount: connect.stripeConnectedAccountId }
    );
    if (
      existing.status === "requires_payment_method" ||
      existing.status === "requires_confirmation" ||
      existing.status === "requires_action"
    ) {
      return {
        clientSecret: existing.client_secret!,
        paymentIntentId: existing.id,
      };
    }
    // sonst neu erstellen (alter PI ist canceled/failed)
  }

  // Direct-Charge-Modell: PaymentIntent wird AUF dem Connected Account
  // erstellt (stripeAccount-Header). application_fee_amount fliesst
  // an die Plattform (Lumio).
  const intent = await getStripe().paymentIntents.create(
    {
      amount: order.totalCents,
      currency: order.currency.toLowerCase(),
      application_fee_amount:
        order.applicationFeeCents > 0
          ? order.applicationFeeCents
          : undefined,
      automatic_payment_methods: { enabled: true },
      metadata: {
        lumio_order_id: order.id,
        lumio_order_number: order.orderNumber,
        lumio_tenant_id: order.tenantId,
      },
      receipt_email: order.guestEmail,
      description: `Bestellung ${order.orderNumber}`,
    },
    { stripeAccount: connect.stripeConnectedAccountId }
  );

  await prisma.printOrder.update({
    where: { id: orderId },
    data: { stripePaymentIntentId: intent.id },
  });

  return {
    clientSecret: intent.client_secret!,
    paymentIntentId: intent.id,
  };
}

/**
 * Erstellt einen Stripe-Refund fuer eine bereits bezahlte stripe_connect-
 * Order. Im Direct-Charge-Modell wird der Refund AUF dem Connected
 * Account erstellt (gleicher Account auf dem der Charge lebt). Die
 * application_fee_amount wird per default mitgerefunded — der Plattform-
 * Cut geht damit auch zurueck. Das ist die Konvention die wir wollen:
 * wenn der Endkunde sein Geld zurueckbekommt, soll Lumio auch nicht
 * den Cut behalten.
 *
 * Wenn die Order kein Stripe-Charge hat (paymentMode=offline_invoice
 * oder Charge fehlt), tut die Funktion nichts. Der Aufrufer ist dafuer
 * verantwortlich, dass transitionOrder('refund') trotzdem den Status
 * setzt — der Fotograf muss bei offline-Refund manuell sein Konto
 * abgleichen.
 */
export async function refundStripeChargeForOrder(
  orderId: string
): Promise<{ refunded: boolean; refundId?: string; reason?: string }> {
  const order = await prisma.printOrder.findUnique({
    where: { id: orderId },
  });
  if (!order) throw new Error("Order nicht gefunden");

  if (order.paymentMode !== "stripe_connect") {
    return { refunded: false, reason: "not_stripe_payment" };
  }
  if (!order.stripeChargeId) {
    return { refunded: false, reason: "no_charge_yet" };
  }

  const connect = await prisma.tenantStripeConnect.findUnique({
    where: { tenantId: order.tenantId },
  });
  if (!connect) {
    return { refunded: false, reason: "no_connect_account" };
  }

  try {
    const refund = await getStripe().refunds.create(
      {
        charge: order.stripeChargeId,
        // Default: refund_application_fee=true → Lumio gibt den Cut zurueck.
        // Wenn das mal nicht gewollt ist (z.B. Storno-Gebuehr behalten),
        // kann der Fotograf das manuell via Stripe-Dashboard machen.
        refund_application_fee: true,
        reverse_transfer: true,
        metadata: {
          lumio_order_id: order.id,
          lumio_order_number: order.orderNumber,
        },
      },
      { stripeAccount: connect.stripeConnectedAccountId }
    );
    return { refunded: true, refundId: refund.id };
  } catch (err) {
    // Stripe-Fehler nicht verschlucken — der Aufrufer entscheidet was
    // damit zu tun. Wir loggen aber nicht den Stack hier; das macht
    // die Route.
    throw err;
  }
}
