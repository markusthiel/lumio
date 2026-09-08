"use client";

/**
 * Lumio — Bestaetigungs-Page nach erfolgreichem Print-Shop-Checkout
 */
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useT, useFormat} from "@/lib/i18n";
import type { Formatters } from "@/lib/i18n/format";
import { useErrorText } from "@/lib/error-i18n";

type Order = Awaited<ReturnType<typeof api.getGalleryPrintOrder>>;

export default function PrintOrderConfirmationPage({
  params,
}: {
  params: Promise<{ slug: string; orderNumber: string }>;
}) {
  const errText = useErrorText();
  const fmt = useFormat();
  const { slug, orderNumber } = use(params);
  const t = useT();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.getGalleryPrintOrder(slug, orderNumber);
        setOrder(r);
      } catch (err) {
        setError(errText(err, t("common.error")));
      }
    })();
  }, [slug, orderNumber]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-sm text-semantic-danger">{error}</div>
      </div>
    );
  }
  if (!order) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-ink-tertiary">{t("common.loading")}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-canvas">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
        <div className="rounded-md border border-line-subtle bg-surface-raised p-6 mb-6">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-semantic-success/15 text-semantic-success text-2xl mb-3">
              ✓
            </div>
            <h1 className="text-xl font-semibold mb-1">
              {t("orderPage.thanks", { name: order.guestName })}
            </h1>
            <p className="text-sm text-ink-tertiary">
              {t("orderPage.received")}
            </p>
          </div>

          <div className="text-center mb-6">
            <div className="text-xs text-ink-tertiary uppercase tracking-wide mb-1">
              {t("orderPage.orderNumber")}
            </div>
            <div className="text-lg font-mono">{order.orderNumber}</div>
          </div>

          <div className="bg-surface-sunken rounded p-3 text-sm text-center mb-6">
            {order.paymentMode === "offline_invoice" ? (
              <>
                {t("orderPage.invoiceComing")}
              </>
            ) : (
              <>
                {t("orderPage.paymentReceived")}
              </>
            )}
          </div>

          {/* Artikel-Liste */}
          <h2 className="text-sm font-semibold mb-2">{t("orderPage.items")}</h2>
          <ul className="divide-y divide-line-subtle text-sm mb-3">
            {order.items.map((it, i) => (
              <li key={i} className="py-2 flex justify-between gap-3">
                <div>
                  <strong>
                    {it.quantity}× {it.variantName}
                  </strong>
                  <div className="text-xs text-ink-tertiary">
                    {it.productName} · {it.widthMm}×{it.heightMm} mm
                    {it.finishName && ` · ${it.finishName}`}
                  </div>
                </div>
                <div className="tabular-nums">
                  {formatPrice(fmt, it.totalPriceCents, order.currency)}
                </div>
              </li>
            ))}
          </ul>

          <dl className="text-sm pt-3 border-t border-line-subtle space-y-1">
            <div className="flex justify-between">
              <dt className="text-ink-tertiary">{t("orderPage.subtotal")}</dt>
              <dd className="tabular-nums">
                {formatPrice(fmt, order.totals.subtotalCents, order.currency)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-tertiary">
                {t("orderPage.shipping")}{order.shippingMethod && ` (${order.shippingMethod})`}
              </dt>
              <dd className="tabular-nums">
                {formatPrice(fmt, order.totals.shippingCents, order.currency)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-tertiary">{t("orderPage.vat")}</dt>
              <dd className="tabular-nums">
                {formatPrice(fmt, order.totals.taxCents, order.currency)}
              </dd>
            </div>
            <div className="flex justify-between pt-2 border-t border-line-subtle font-semibold">
              <dt>{t("orderPage.total")}</dt>
              <dd className="tabular-nums">
                {formatPrice(fmt, order.totals.totalCents, order.currency)}
              </dd>
            </div>
          </dl>
        </div>

        {order.trackingNumber && (
          <div className="rounded-md border border-line-subtle bg-surface-raised p-4 mb-6">
            <h2 className="text-sm font-semibold mb-2">{t("orderPage.shipping")}</h2>
            <div className="text-sm">
              {t("orderPage.trackingNumber")}{" "}
              <strong className="font-mono">{order.trackingNumber}</strong>
              {order.trackingCarrier && ` (${order.trackingCarrier})`}
            </div>
            {order.trackingUrl && (
              <a
                href={order.trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-accent hover:underline"
              >
                {t("orderPage.trackPackage")}
              </a>
            )}
          </div>
        )}

        <div className="text-center">
          <Link
            href={`/g/${slug}`}
            className="text-sm text-accent hover:underline"
          >
            {t("orderPage.backToGallery")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function formatPrice(fmt: Formatters, cents: number, currency = "EUR"): string {
  return fmt.currencyFromMinor(cents, currency);
}
