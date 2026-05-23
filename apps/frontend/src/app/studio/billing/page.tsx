"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  api,
  type BillingUsage,
  type BillingPlan,
  type BillingSubscriptionInfo,
} from "@/lib/api";
import { PageHeader } from "@/components/studio/PageHeader";
import { Card } from "@/components/ui";

/**
 * Plan & Speicher — Studio-Seite zum aktuellen Plan, Verbrauch und
 * den Limits.
 *
 * Sprint 1: rein read-only. Zeigt die Daten an. Der Upgrade-/Downgrade-
 * Button führt heute noch nirgendwohin (Stripe-Checkout-Integration
 * kommt in Sprint 2).
 */
export default function BillingPage() {
  const [usage, setUsage] = useState<BillingUsage | null>(null);
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [sub, setSub] = useState<BillingSubscriptionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  // UI-Zustand für monatlich/jährlich-Toggle in der Plan-Auswahl.
  // Initial vom Server (existing Subscription) oder Default monthly.
  const [interval, setInterval] = useState<"monthly" | "yearly">("monthly");
  // busy-State für die Action-Buttons (Plan-Wechsel + Portal). Wir
  // disablen während Stripe-Calls laufen, sonst doppelte Checkouts.
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // Subscription-Get ist optional — wenn der Tenant noch keine hat
      // (alte Self-Host-Installation ohne Billing), bleibt sub null.
      const [u, p, s] = await Promise.all([
        api.getBillingUsage(),
        api.getBillingPlans(),
        api.getBillingSubscription().catch(() => null),
      ]);
      setUsage(u);
      setPlans(p.plans);
      setSub(s);
      if (s?.billingInterval === "yearly" || s?.billingInterval === "monthly") {
        setInterval(s.billingInterval);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }, []);

  /** Plan-Wechsel oder erstmaliges Abo. Backend entscheidet ob in-place-
   * Update (existing sub) oder Checkout-Session. */
  const handleSelectPlan = useCallback(
    async (planSlug: "solo" | "studio" | "pro") => {
      setBusyAction(`plan:${planSlug}`);
      try {
        const result = await api.startSubscription({
          plan: planSlug,
          interval,
        });
        if ("checkoutUrl" in result) {
          window.location.href = result.checkoutUrl;
        } else {
          // upgraded === true. Page reloaden um den neuen Plan zu sehen.
          window.location.reload();
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Plan-Wechsel fehlgeschlagen");
        setBusyAction(null);
      }
    },
    [interval]
  );

  const handleOpenPortal = useCallback(async () => {
    setBusyAction("portal");
    try {
      const { portalUrl } = await api.startBillingPortal();
      window.location.href = portalUrl;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Portal-Öffnen fehlgeschlagen");
      setBusyAction(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="p-6">
        <PageHeader title="Plan & Speicher" />
        <div className="text-ui-sm text-ink-tertiary">Lädt …</div>
      </div>
    );
  }

  if (err || !usage) {
    return (
      <div className="p-6">
        <PageHeader title="Plan & Speicher" />
        <Card className="p-4 border-semantic-danger/30 bg-semantic-danger/5">
          <div className="text-semantic-danger text-ui-sm">
            {err ?? "Keine Abrechnungs-Daten gefunden."}
          </div>
        </Card>
      </div>
    );
  }

  const storageUsedBytes = BigInt(usage.storage.usedBytes);
  const storageLimitBytes = BigInt(usage.storage.limitBytes);
  const storagePct =
    Number((storageUsedBytes * 1000n) / (storageLimitBytes || 1n)) / 10;
  const galleriesPct =
    usage.plan.activeGalleries === null
      ? 0
      : (usage.galleries.active / usage.plan.activeGalleries) * 100;

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <PageHeader title="Plan & Speicher" />

      {/* Aktueller Plan + Status */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-ui-xs text-ink-tertiary uppercase tracking-wide">
              Aktueller Plan
            </div>
            <div className="text-2xl font-medium text-ink-primary mt-1">
              {usage.plan.name}
            </div>
            <div className="text-ui-sm text-ink-secondary mt-1">
              {usage.plan.description}
            </div>
            <StatusBadge status={usage.subscriptionStatus} />
          </div>
          {usage.trialEndsAt && (
            <div className="text-ui-xs text-ink-tertiary text-right">
              Trial endet am
              <div className="text-ui-sm text-ink-primary font-medium">
                {new Date(usage.trialEndsAt).toLocaleDateString("de-DE")}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Read-only Warnung wenn Karenz Tag 30+ */}
      {usage.readOnlySince && (
        <Card className="p-4 border-semantic-danger/30 bg-semantic-danger/5">
          <div className="text-semantic-danger font-medium">
            Konto im Read-only-Modus
          </div>
          <div className="text-ui-sm text-ink-secondary mt-1">
            Wegen ausstehender Zahlung sind Uploads und Änderungen
            deaktiviert. Bestehende Galerien bleiben für deine Kunden
            sichtbar. Bitte Karte aktualisieren.
          </div>
        </Card>
      )}

      {/* Storage-Bar */}
      <Card className="p-5">
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-ui-md font-medium">Speicher</h3>
          <div className="text-ui-xs text-ink-tertiary tabular-nums">
            {formatBytes(storageUsedBytes)} von {formatBytes(storageLimitBytes)}
          </div>
        </div>
        <UsageBar
          pct={storagePct}
          danger={storagePct > 95}
          warning={storagePct > 80}
        />
        <div className="grid grid-cols-2 gap-4 mt-3 text-ui-xs text-ink-tertiary">
          <div>
            Originale:{" "}
            <span className="text-ink-secondary tabular-nums">
              {formatBytes(BigInt(usage.storage.breakdown.originalsBytes))}
            </span>
          </div>
          <div>
            Vorschauen:{" "}
            <span className="text-ink-secondary tabular-nums">
              {formatBytes(BigInt(usage.storage.breakdown.renditionsBytes))}
            </span>
          </div>
        </div>
        {usage.storageAddonGib > 0 && (
          <div className="text-ui-xs text-ink-tertiary mt-2">
            Inklusive {usage.storageAddonGib} GB Zusatz-Speicher
          </div>
        )}
      </Card>

      {/* Aktive Galerien */}
      <Card className="p-5">
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-ui-md font-medium">Aktive Galerien</h3>
          <div className="text-ui-xs text-ink-tertiary tabular-nums">
            {usage.galleries.active}
            {usage.plan.activeGalleries !== null && (
              <> von {usage.plan.activeGalleries}</>
            )}
          </div>
        </div>
        {usage.plan.activeGalleries !== null ? (
          <UsageBar
            pct={galleriesPct}
            danger={galleriesPct > 95}
            warning={galleriesPct > 80}
          />
        ) : (
          <div className="text-ui-xs text-ink-tertiary">Unbegrenzt</div>
        )}
        {usage.galleries.total > usage.galleries.active && (
          <div className="text-ui-xs text-ink-tertiary mt-2">
            Plus {usage.galleries.total - usage.galleries.active} archivierte
            Galerien (zählen nicht zum Limit).
          </div>
        )}
      </Card>

      {/* Features-Übersicht */}
      <Card className="p-5">
        <h3 className="text-ui-md font-medium mb-3">Features in deinem Plan</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-ui-sm">
          <FeatureRow
            label="Eigenes Branding"
            value={usage.plan.brandings > 0 ? `${usage.plan.brandings} Profil${usage.plan.brandings > 1 ? "e" : ""}` : null}
          />
          <FeatureRow
            label="Custom-Domain"
            value={
              usage.plan.customDomains === null
                ? "Unbegrenzt"
                : usage.plan.customDomains > 0
                ? `${usage.plan.customDomains} Domain${usage.plan.customDomains > 1 ? "s" : ""}`
                : null
            }
          />
          <FeatureRow
            label="Watermark"
            value={usage.plan.watermarkAllowed ? "Verfügbar" : null}
          />
          <FeatureRow
            label="Team-Mitglieder"
            value={usage.plan.teamMembers > 1 ? `bis ${usage.plan.teamMembers}` : null}
          />
        </div>
      </Card>

      {/* Plan-Vergleich für Upgrade */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-ui-md font-medium">Andere Pläne</h3>
          {/* Monthly / Yearly Toggle. Yearly = 17% Rabatt (10 Monate
              statt 12) — wir zeigen das als Badge an. */}
          <div className="inline-flex rounded border border-line-subtle p-0.5">
            <button
              onClick={() => setInterval("monthly")}
              className={`text-ui-sm px-3 h-7 rounded transition-colors ${
                interval === "monthly"
                  ? "bg-surface-canvas text-ink-primary"
                  : "text-ink-tertiary hover:text-ink-secondary"
              }`}
            >
              Monatlich
            </button>
            <button
              onClick={() => setInterval("yearly")}
              className={`text-ui-sm px-3 h-7 rounded transition-colors flex items-center gap-1 ${
                interval === "yearly"
                  ? "bg-surface-canvas text-ink-primary"
                  : "text-ink-tertiary hover:text-ink-secondary"
              }`}
            >
              Jährlich
              <span className="text-ui-xs bg-accent/15 text-accent px-1.5 py-0.5 rounded">
                −17 %
              </span>
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {plans.map((p) => {
            const isCurrent =
              p.slug === usage.plan.slug &&
              (sub?.billingInterval ?? "monthly") === interval;
            const priceCents =
              interval === "yearly" ? p.priceYearlyCents : p.priceMonthlyCents;
            const slug = p.slug as "solo" | "studio" | "pro";
            return (
              <div
                key={p.slug}
                className={`rounded-lg border p-4 ${
                  isCurrent
                    ? "border-accent bg-accent/5"
                    : "border-line-subtle"
                }`}
              >
                <div className="font-medium text-ink-primary">{p.name}</div>
                <div className="text-2xl font-medium text-ink-primary mt-2">
                  {(priceCents / 100).toFixed(0)} €
                  <span className="text-ui-xs text-ink-tertiary font-normal">
                    {" "}
                    / {interval === "yearly" ? "Jahr" : "Monat"}
                  </span>
                </div>
                {interval === "yearly" && (
                  <div className="text-ui-xs text-ink-tertiary mt-0.5">
                    ≈ {(priceCents / 1200).toFixed(0)} €/Monat
                  </div>
                )}
                <div className="text-ui-xs text-ink-secondary mt-3 space-y-1">
                  <div>{p.storageGib} GB Speicher</div>
                  <div>
                    {p.activeGalleries === null
                      ? "Unbegrenzte"
                      : p.activeGalleries}{" "}
                    aktive Galerien
                  </div>
                  {p.brandings > 0 && (
                    <div>
                      {p.brandings} Branding-Profil
                      {p.brandings > 1 ? "e" : ""}
                    </div>
                  )}
                  {p.customDomains !== 0 && (
                    <div>
                      {p.customDomains === null
                        ? "Unbegrenzte"
                        : p.customDomains}{" "}
                      Custom-Domain{p.customDomains !== 1 ? "s" : ""}
                    </div>
                  )}
                  {p.teamMembers > 1 && (
                    <div>
                      bis {p.teamMembers} Team-Mitglieder
                    </div>
                  )}
                </div>
                <div className="mt-4">
                  {isCurrent ? (
                    <div className="text-ui-sm text-accent font-medium">
                      Aktueller Plan
                    </div>
                  ) : (
                    <button
                      onClick={() => handleSelectPlan(slug)}
                      disabled={busyAction !== null}
                      className="w-full text-ui-sm h-9 rounded bg-accent text-accent-contrast font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
                    >
                      {busyAction === `plan:${slug}`
                        ? "Wird vorbereitet …"
                        : sub?.planSlug === p.slug
                        ? `Auf ${interval === "yearly" ? "Jahres-" : "Monats-"}Abrechnung wechseln`
                        : "Diesen Plan wählen"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {sub?.hasStripeId && (
          <div className="text-ui-xs text-ink-tertiary mt-3">
            Plan-Wechsel wird sofort wirksam. Bei höher dann anteilige
            Berechnung. Bei niedriger Plan: Guthaben fürs nächste Intervall.
          </div>
        )}
      </Card>

      {/* Stripe Customer Portal — Karte, Rechnungen, Cancel */}
      {sub?.hasStripeId && (
        <Card className="p-5">
          <h3 className="text-ui-md font-medium mb-1">
            Karte & Rechnungen verwalten
          </h3>
          <p className="text-ui-sm text-ink-secondary mb-3">
            Karte aktualisieren, Rechnungen herunterladen, Adresse ändern
            oder kündigen — alles im Stripe-Portal.
          </p>
          <button
            onClick={handleOpenPortal}
            disabled={busyAction !== null}
            className="text-ui-sm h-9 px-4 rounded border border-line-strong text-ink-primary font-medium hover:bg-surface-sunken disabled:opacity-50 transition-colors"
          >
            {busyAction === "portal" ? "Wird geöffnet …" : "Portal öffnen"}
          </button>
        </Card>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    active: { label: "Aktiv", cls: "bg-semantic-success/15 text-semantic-success" },
    trialing: { label: "Trial", cls: "bg-accent/15 text-accent" },
    past_due: {
      label: "Zahlung ausstehend",
      cls: "bg-semantic-warning/15 text-semantic-warning",
    },
    canceled: { label: "Gekündigt", cls: "bg-ink-tertiary/15 text-ink-tertiary" },
    unpaid: {
      label: "Unbezahlt",
      cls: "bg-semantic-danger/15 text-semantic-danger",
    },
  };
  const conf = map[status] ?? { label: status, cls: "bg-ink-tertiary/15 text-ink-tertiary" };
  return (
    <span
      className={`inline-block mt-2 px-2 py-0.5 rounded-full text-ui-xs font-medium ${conf.cls}`}
    >
      {conf.label}
    </span>
  );
}

function UsageBar({
  pct,
  danger,
  warning,
}: {
  pct: number;
  danger?: boolean;
  warning?: boolean;
}) {
  const clamped = Math.min(100, Math.max(0, pct));
  const bg = danger
    ? "bg-semantic-danger"
    : warning
    ? "bg-semantic-warning"
    : "bg-accent";
  return (
    <div className="h-2 w-full rounded-full bg-surface-overlay/40 overflow-hidden">
      <div
        className={`h-full ${bg} transition-all duration-motion`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function FeatureRow({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={
          value ? "text-semantic-success" : "text-ink-tertiary opacity-50"
        }
      >
        {value ? "✓" : "—"}
      </span>
      <span className="text-ink-secondary">{label}</span>
      {value && (
        <span className="text-ink-tertiary text-ui-xs ml-auto">{value}</span>
      )}
    </div>
  );
}

function formatBytes(bytes: bigint): string {
  const n = Number(bytes);
  const gb = n / (1024 * 1024 * 1024);
  if (gb >= 10) return `${gb.toFixed(0)} GB`;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = n / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(0)} MB`;
  const kb = n / 1024;
  return `${kb.toFixed(0)} KB`;
}
