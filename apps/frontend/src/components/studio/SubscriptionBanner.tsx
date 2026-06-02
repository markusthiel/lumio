"use client";

/**
 * Lumio Studio — SubscriptionBanner
 *
 * Zeigt einen Status-Banner oben in der Studio-Shell wenn die
 * Subscription Aufmerksamkeit braucht:
 *   - Trial-Tag 1–7: nichts zeigen (cleaner UX, User soll arbeiten)
 *   - Trial-Tag 8–13: dezent erinnern ("Trial endet in X Tagen")
 *   - Trial-Tag 14: warnen + "Karte hinterlegen"-Button
 *   - readOnlySince != null: roter Block mit "Plan abonnieren"-Button
 *   - past_due: gelb mit Hinweis auf Stripe-Portal
 *
 * Klicks auf "Plan abonnieren" / "Karte hinterlegen" rufen
 * api.startSubscription(plan='studio') und redirecten zur Stripe-
 * Checkout-URL. "Verwalten" ruft api.startBillingPortal().
 *
 * Caching: wir holen die Subscription einmal beim Mount. Updates kommen
 * NICHT live (kein WS-Event für Billing-Changes). User muss die Page
 * reloaden — wir invalidieren auch nichts beim Click, sondern verlassen
 * uns auf den Stripe-Redirect-Roundtrip.
 */
import { useCallback, useEffect, useState } from "react";
import { api, type BillingSubscriptionInfo } from "@/lib/api";
import { useT } from "@/lib/i18n";

export function SubscriptionBanner() {
  const t = useT();
  const [sub, setSub] = useState<BillingSubscriptionInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Billing ist optional (Self-Host ohne Stripe). Wenn der Endpoint
    // 404/503 wirft: stillschweigend skippen, kein Banner.
    api
      .getBillingSubscription()
      .then(setSub)
      .catch(() => undefined);
  }, []);

  const goToCheckout = useCallback(async () => {
    if (!sub) return;
    setBusy(true);
    try {
      const result = await api.startSubscription({
        plan: (sub.planSlug === "trial" ? "studio" : sub.planSlug) as
          | "solo"
          | "studio"
          | "pro",
        interval: sub.billingInterval === "yearly" ? "yearly" : "monthly",
      });
      if ("checkoutUrl" in result) {
        window.location.href = result.checkoutUrl;
      } else {
        // upgraded === true — Page reloaden damit Banner verschwindet
        window.location.reload();
      }
    } catch (err) {
      console.error("startSubscription failed", err);
      setBusy(false);
    }
  }, [sub]);

  const goToPortal = useCallback(async () => {
    setBusy(true);
    try {
      const { portalUrl } = await api.startBillingPortal(
        window.location.pathname
      );
      window.location.href = portalUrl;
    } catch (err) {
      console.error("startBillingPortal failed", err);
      setBusy(false);
    }
  }, []);

  if (!sub) return null;

  // 1) Read-only — Plan reaktivieren, hart-rot
  if (sub.readOnlySince) {
    const daysToSuspension = Math.max(0, 30 - (sub.readOnlySince ? Math.floor((Date.now() - new Date(sub.readOnlySince).getTime()) / 86400000) : 0));
    return (
      <div className="bg-semantic-danger/15 border-b border-semantic-danger/40 px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3 flex-wrap">
          <div className="text-ui-sm text-ink-primary">
            <strong className="font-medium">{t("subBanner.readonlyTitle")}</strong>{" "}
            {t("subBanner.readonlyBody", { n: daysToSuspension })}
          </div>
          <button
            onClick={goToCheckout}
            disabled={busy}
            className="text-ui-sm px-3 h-8 rounded bg-semantic-danger text-surface-canvas font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {t("subBanner.subscribe")}
          </button>
        </div>
      </div>
    );
  }

  // 2) past_due — Zahlung gescheitert
  if (sub.status === "past_due" || sub.status === "unpaid") {
    return (
      <div className="bg-semantic-warning/15 border-b border-semantic-warning/40 px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3 flex-wrap">
          <div className="text-ui-sm text-ink-primary">
            <strong className="font-medium">{t("subBanner.pastDueTitle")}</strong>{" "}
            {t("subBanner.pastDueBody")}
          </div>
          <button
            onClick={goToPortal}
            disabled={busy}
            className="text-ui-sm px-3 h-8 rounded bg-semantic-warning text-surface-canvas font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {t("subBanner.manageCard")}
          </button>
        </div>
      </div>
    );
  }

  // 3) Trial-Phase — abgestufte Banner-Stufen
  if (sub.status === "trialing" && sub.trialDaysRemaining !== null) {
    // Tag 1–7: kein Banner. User soll arbeiten ohne genervt zu werden.
    if (sub.trialDaysRemaining > 7) return null;

    // User-dismissible für Tag 8–13
    if (dismissed && sub.trialDaysRemaining > 1) return null;

    // Wenn schon Karte hinterlegt (hasStripeId): nur als Info, kein CTA
    const hasCard = sub.hasStripeId;
    const tone =
      sub.trialDaysRemaining <= 1
        ? "danger"
        : sub.trialDaysRemaining <= 3
        ? "warning"
        : "info";
    const colorClasses = {
      danger:
        "bg-semantic-danger/15 border-semantic-danger/40 text-ink-primary",
      warning:
        "bg-semantic-warning/15 border-semantic-warning/40 text-ink-primary",
      info: "bg-accent/10 border-accent/30 text-ink-primary",
    }[tone];

    return (
      <div className={`border-b px-4 py-2.5 ${colorClasses}`}>
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3 flex-wrap">
          <div className="text-ui-sm">
            {sub.trialDaysRemaining === 0 ? (
              <>
                <strong className="font-medium">{t("subBanner.trialTodayTitle")}</strong>{" "}
                {hasCard
                  ? t("subBanner.trialTodayCard")
                  : t("subBanner.trialTodayNoCard")}
              </>
            ) : (
              <>
                <strong className="font-medium">
                  {t(sub.trialDaysRemaining === 1 ? "subBanner.trialDaysSg" : "subBanner.trialDaysPl", { n: sub.trialDaysRemaining })}
                </strong>{" "}
                {hasCard
                  ? t("subBanner.trialFirstBill", { date: new Date(sub.trialEndsAt!).toLocaleDateString("de-DE") })
                  : t("subBanner.trialNoCard")}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!hasCard && (
              <button
                onClick={goToCheckout}
                disabled={busy}
                className="text-ui-sm px-3 h-8 rounded bg-accent text-accent-contrast font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {t("subBanner.depositCard")}
              </button>
            )}
            {sub.trialDaysRemaining > 1 && (
              <button
                onClick={() => setDismissed(true)}
                className="text-ui-sm text-ink-tertiary hover:text-ink-secondary px-2"
                aria-label={t("subBanner.dismiss")}
              >
                ×
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
