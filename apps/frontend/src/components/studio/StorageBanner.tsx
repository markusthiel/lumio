"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";

/**
 * Storage-Banner — wird am oberen Rand der Studio-Main-Area gerendert,
 * aber NUR wenn der Tenant nahe am Storage-Limit ist (>80%) ODER ein
 * Trial bald endet ODER das Konto im Read-only-Modus ist. In allen
 * anderen Fällen rendert die Component nichts.
 *
 * Lädt usage einmalig beim Mount. Wir refreshen NICHT periodisch —
 * der Banner ist eine Erinnerung, kein Live-Counter. Bei Bedarf hilft
 * ein Page-Reload (oder der User schaut auf der /studio/billing-Seite
 * den exakten Stand).
 */
export function StorageBanner() {
  const t = useT();
  const [state, setState] = useState<{
    kind: "warning" | "danger" | "readonly" | "trial";
    title: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const u = await api.getBillingUsage();
        if (cancelled) return;

        if (u.readOnlySince) {
          setState({
            kind: "readonly",
            title: t("storageBanner.readonlyTitle"),
            message: t("storageBanner.readonlyMsg"),
          });
          return;
        }

        const usedBytes = BigInt(u.storage.usedBytes);
        const limitBytes = BigInt(u.storage.limitBytes);
        const pct =
          Number((usedBytes * 1000n) / (limitBytes || 1n)) / 10;

        if (pct >= 95) {
          setState({
            kind: "danger",
            title: t("storageBanner.dangerTitle"),
            message: t("storageBanner.dangerMsg", { pct: pct.toFixed(0) }),
          });
          return;
        }
        if (pct >= 80) {
          setState({
            kind: "warning",
            title: t("storageBanner.warnTitle"),
            message: t("storageBanner.warnMsg", { pct: pct.toFixed(0) }),
          });
          return;
        }

        // Trial: zeigen wenn weniger als 3 Tage übrig
        if (u.trialEndsAt) {
          const days =
            (new Date(u.trialEndsAt).getTime() - Date.now()) /
            (1000 * 60 * 60 * 24);
          if (days <= 3 && days >= 0) {
            setState({
              kind: "trial",
              title: t("storageBanner.trialTitle"),
              message: t(Math.ceil(days) === 1 ? "storageBanner.trialMsgSg" : "storageBanner.trialMsgPl", { n: Math.ceil(days) }),
            });
            return;
          }
        }

        // Aktive Galerien fast am Limit (>=90% wenn nicht unlimited)
        if (
          u.plan.activeGalleries !== null &&
          u.galleries.active / u.plan.activeGalleries >= 0.9
        ) {
          setState({
            kind: "warning",
            title: t("storageBanner.galleryTitle"),
            message: t("storageBanner.galleryMsg", { active: u.galleries.active, limit: u.plan.activeGalleries }),
          });
          return;
        }

        setState(null);
      } catch {
        // Wenn /billing/usage nicht erreichbar (z.B. BILLING_ENABLED=false
        // bei Self-Hosted) zeigen wir gar nichts. Das ist gewollt — keine
        // Banner wenn's kein Billing-Konzept gibt.
        if (!cancelled) setState(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state) return null;

  const cls = {
    warning:
      "border-semantic-warning/30 bg-semantic-warning/10 text-semantic-warning",
    danger:
      "border-semantic-danger/30 bg-semantic-danger/10 text-semantic-danger",
    readonly:
      "border-semantic-danger/30 bg-semantic-danger/10 text-semantic-danger",
    trial: "border-accent/30 bg-accent/10 text-accent",
  }[state.kind];

  return (
    <div className={`border-b ${cls} px-6 py-2.5`}>
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-3 text-ui-sm">
        <div>
          <span className="font-medium">{state.title}</span>
          <span className="text-ink-secondary ml-2">{state.message}</span>
        </div>
        <Link
          href="/studio/billing"
          className="px-3 py-1 rounded-md bg-current/15 hover:bg-current/25 text-ui-xs font-medium whitespace-nowrap transition-colors duration-motion"
        >
          {t("storageBanner.cta")}
        </Link>
      </div>
    </div>
  );
}
