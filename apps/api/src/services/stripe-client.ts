/**
 * Lumio API — Stripe Client Singleton
 *
 * Eine Instanz pro Prozess, lazily initialisiert. Wenn STRIPE_SECRET_KEY
 * nicht gesetzt ist (z.B. lokale Entwicklung ohne Billing), wirft der
 * Getter — Code der Stripe braucht, muss den Aufruf entweder hinter
 * config.BILLING_ENABLED gaten oder eine sinnvolle Fehler-Meldung
 * geben.
 *
 * Pinned API-Version: damit Stripe nicht in der Mitte eines Releases
 * Breaking-Changes durchschiebt. Wenn wir auf eine neuere Version
 * upgraden wollen, ist das ein bewusster Commit (auch wegen typings).
 */
import Stripe from "stripe";
import { config } from "../config.js";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  if (!config.STRIPE_SECRET_KEY) {
    throw new Error(
      "Stripe is not configured. Set STRIPE_SECRET_KEY in the environment."
    );
  }
  _stripe = new Stripe(config.STRIPE_SECRET_KEY, {
    // Eine pinned API-Version: gleiche Antwortformate über alle
    // Lumio-Deployments hinweg, unabhängig vom Stripe-Default.
    apiVersion: "2025-08-27.basil",
    appInfo: {
      name: "Lumio",
      version: "0.2",
      url: "https://lumio-cloud.de",
    },
    typescript: true,
  });
  return _stripe;
}

/** Helper: Stripe ist aktiv konfiguriert (Key vorhanden + Billing
 *  enabled). Routen können das prüfen bevor sie loslegen. */
export function isStripeEnabled(): boolean {
  return Boolean(config.BILLING_ENABLED && config.STRIPE_SECRET_KEY);
}
