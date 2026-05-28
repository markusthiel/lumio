"use client";

/**
 * Lumio Studio — Print-Shop-Bestellungen (Liste)
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

type Order = Awaited<
  ReturnType<typeof api.listPrintOrders>
>["orders"][number];

const STATUS_FILTERS = [
  { value: "", label: "Alle" },
  { value: "pending_payment", label: "Wartet auf Zahlung" },
  { value: "paid", label: "Bezahlt" },
  { value: "in_production", label: "In Produktion" },
  { value: "shipped", label: "Versendet" },
  { value: "delivered", label: "Zugestellt" },
  { value: "cancelled", label: "Storniert" },
  { value: "refunded", label: "Erstattet" },
];

export default function PrintOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (opts: { replace: boolean }) => {
      setLoading(true);
      setError(null);
      try {
        const r = await api.listPrintOrders({
          status: status || undefined,
          limit: 30,
          cursor: opts.replace ? undefined : (cursor ?? undefined),
        });
        setOrders((prev) =>
          opts.replace ? r.orders : [...prev, ...r.orders]
        );
        setCursor(r.nextCursor);
        setHasMore(r.nextCursor !== null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Fehler");
      } finally {
        setLoading(false);
      }
    },
    [cursor, status]
  );

  useEffect(() => {
    void load({ replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatus(f.value)}
            className={
              status === f.value
                ? "px-2.5 py-1 text-xs rounded bg-accent text-white"
                : "px-2.5 py-1 text-xs rounded bg-surface-sunken text-ink-secondary hover:bg-surface-raised"
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-semantic-danger/30 bg-semantic-danger/8 px-3 py-2 text-sm text-semantic-danger">
          {error}
        </div>
      )}

      {orders.length === 0 && !loading ? (
        <div className="rounded-md border border-line-subtle bg-surface-raised px-4 py-8 text-sm text-ink-tertiary text-center">
          Noch keine Bestellungen{status && " mit diesem Status"}.
        </div>
      ) : (
        <ul className="space-y-2">
          {orders.map((o) => (
            <li key={o.id}>
              <Link
                href={`/studio/print-shop/orders/${o.id}`}
                className="block rounded-md border border-line-subtle bg-surface-raised p-3 hover:bg-surface-sunken transition-colors"
              >
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <strong className="text-sm font-mono">
                        {o.orderNumber}
                      </strong>
                      <StatusBadge status={o.status} />
                      <span className="text-xs px-1.5 py-0.5 rounded bg-surface-sunken text-ink-tertiary">
                        {o.paymentMode === "stripe_connect"
                          ? "Online"
                          : "Offline"}
                      </span>
                    </div>
                    <div className="text-sm text-ink-secondary">
                      {o.guestName} &lt;{o.guestEmail}&gt;
                    </div>
                    <div className="text-xs text-ink-tertiary mt-0.5">
                      {new Date(o.createdAt).toLocaleString("de-DE")}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold tabular-nums">
                      {formatPrice(o.totalCents, o.currency)}
                    </div>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {hasMore && (
        <div className="text-center">
          <button
            type="button"
            onClick={() => void load({ replace: false })}
            disabled={loading}
            className="px-4 py-2 text-sm rounded border border-line-subtle bg-surface-raised hover:bg-surface-sunken disabled:opacity-50"
          >
            {loading ? "Lädt…" : "Mehr laden"}
          </button>
        </div>
      )}
    </div>
  );
}

function formatPrice(cents: number, currency = "EUR"): string {
  return (cents / 100).toLocaleString("de-DE", {
    style: "currency",
    currency,
  });
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; classes: string }> = {
    draft: {
      label: "Entwurf",
      classes: "bg-surface-sunken text-ink-tertiary",
    },
    pending_payment: {
      label: "Zahlung offen",
      classes: "bg-semantic-warning/15 text-semantic-warning",
    },
    paid: {
      label: "Bezahlt",
      classes: "bg-accent/15 text-accent",
    },
    in_production: {
      label: "In Produktion",
      classes: "bg-accent/15 text-accent",
    },
    shipped: {
      label: "Versendet",
      classes: "bg-semantic-success/15 text-semantic-success",
    },
    delivered: {
      label: "Zugestellt",
      classes: "bg-semantic-success/15 text-semantic-success",
    },
    cancelled: {
      label: "Storniert",
      classes: "bg-surface-sunken text-ink-tertiary",
    },
    refunded: {
      label: "Erstattet",
      classes: "bg-surface-sunken text-ink-tertiary",
    },
  };
  const e = map[status] ?? {
    label: status,
    classes: "bg-surface-sunken text-ink-tertiary",
  };
  return (
    <span
      className={`text-xs px-1.5 py-0.5 rounded font-medium ${e.classes}`}
    >
      {e.label}
    </span>
  );
}
