"use client";

/**
 * Lumio Studio — Print-Shop-Übersicht (Landing)
 *
 * Zeigt Setup-Status als Checkliste:
 *   1. Print-Shop aktiviert (TenantPrintShopConfig.enabled)
 *   2. Bezahlmethode eingerichtet (Stripe-Connect ODER offline-Modus)
 *   3. Mindestens 1 Provider aktiviert
 *   4. Mindestens 1 Produkt angelegt
 *   5. Mindestens 1 Versandmethode definiert
 *
 * Jede Zeile mit Status-Icon + Quick-Link zur entsprechenden Sub-Page.
 * Pragmatisch — kein Wizard, nur Orientierung.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";

interface Status {
  printShopEnabled: boolean;
  stripeReady: boolean;
  hasProviders: boolean;
  hasProducts: boolean;
  hasShipping: boolean;
}

export default function PrintShopOverviewPage() {
  const t = useT();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [config, providers, products, shipping] = await Promise.all([
          api.getPrintShopConfig(),
          api.listTenantPrintProviders(),
          api.listPrintProducts(),
          api.listShippingMethods(),
        ]);
        setStatus({
          printShopEnabled: config.config.enabled,
          // Bezahlbereit wenn Stripe ready ODER mindestens 1 enabled
          // Provider exists (offline-Modus implizit erlaubt)
          stripeReady: config.stripeConnect.ready,
          hasProviders: providers.providers.some((p) => p.enabled),
          hasProducts: products.products.some((p) => p.enabled),
          hasShipping: shipping.methods.some((m) => m.enabled),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : t("common.error"));
      }
    })();
  }, []);

  if (error) {
    return (
      <div className="rounded-md border border-semantic-danger/30 bg-semantic-danger/8 px-3 py-2 text-sm text-semantic-danger">
        {error}
      </div>
    );
  }
  if (!status) {
    return <div className="text-sm text-ink-tertiary">{t("common.loading")}</div>;
  }

  const steps = [
    {
      ok: status.printShopEnabled,
      title: t("printShopOverview.step1Title"),
      description: t("printShopOverview.step1Desc"),
      cta: { href: "/studio/print-shop/settings", label: t("printShopOverview.ctaSettings") },
    },
    {
      ok: status.stripeReady || status.hasProviders,
      title: t("printShopOverview.step2Title"),
      description: status.stripeReady
        ? t("printShopOverview.step2DescReady")
        : t("printShopOverview.step2DescNot"),
      cta: { href: "/studio/print-shop/settings", label: t("printShopOverview.ctaPayment") },
    },
    {
      ok: status.hasProviders,
      title: t("printShopOverview.step3Title"),
      description: t("printShopOverview.step3Desc"),
      cta: { href: "/studio/print-shop/providers", label: t("printShopOverview.ctaProviders") },
    },
    {
      ok: status.hasProducts,
      title: t("printShopOverview.step4Title"),
      description: t("printShopOverview.step4Desc"),
      cta: { href: "/studio/print-shop/products", label: t("printShopOverview.ctaProducts") },
    },
    {
      ok: status.hasShipping,
      title: t("printShopOverview.step5Title"),
      description: t("printShopOverview.step5Desc"),
      cta: { href: "/studio/print-shop/shipping", label: t("printShopOverview.ctaShipping") },
    },
  ];

  const completed = steps.filter((s) => s.ok).length;

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-line-subtle bg-surface-raised p-4">
        <div className="text-sm text-ink-secondary mb-2">
          {t("printShopOverview.setupStatusLabel")} <strong>{completed}</strong> {t("printShopOverview.ofTotal", { total: steps.length })}
          {completed === steps.length && (
            <span className="ml-2 text-semantic-success">
              {t("printShopOverview.ready")}
            </span>
          )}
        </div>
        <div className="h-1.5 bg-surface-sunken rounded overflow-hidden">
          <div
            className="h-full bg-accent transition-all"
            style={{
              width: `${(completed / steps.length) * 100}%`,
            }}
          />
        </div>
      </div>

      <ul className="space-y-2">
        {steps.map((s, i) => (
          <li
            key={i}
            className="rounded-md border border-line-subtle bg-surface-raised p-4 flex items-start gap-3"
          >
            <span
              className={
                s.ok
                  ? "shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-semantic-success/15 text-semantic-success text-sm"
                  : "shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-surface-sunken text-ink-tertiary text-sm"
              }
            >
              {s.ok ? "✓" : i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{s.title}</div>
              <div className="text-xs text-ink-tertiary mt-0.5">
                {s.description}
              </div>
            </div>
            <Link
              href={s.cta.href}
              className="shrink-0 text-xs text-accent hover:underline"
            >
              {s.cta.label} →
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
