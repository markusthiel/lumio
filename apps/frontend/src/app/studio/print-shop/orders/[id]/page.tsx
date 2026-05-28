"use client";

/**
 * Lumio Studio — Print-Order-Detail
 *
 * Zeigt:
 *  - Status + paymentMode + Tracking
 *  - Items mit File-Vorschau
 *  - Adressen
 *  - Lifecycle-Events als Timeline
 *  - Status-Transition-Buttons je nach aktuellem Status
 *  - Studio-Note (editierbar)
 */
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { PrintOrderDetail } from "@/lib/api";
import { Button, Input, Textarea } from "@/components/ui";
import { StatusBadge } from "../page";

export default function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [order, setOrder] = useState<PrintOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<
    { kind: "success" | "danger"; text: string } | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [shippingDialog, setShippingDialog] = useState(false);
  const [noteValue, setNoteValue] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api.getPrintOrder(id);
      setOrder(r.order);
      setNoteValue(r.order.studioNote ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function transition(
    type:
      | "mark_paid"
      | "mark_in_production"
      | "mark_shipped"
      | "mark_delivered"
      | "cancel"
      | "refund",
    extra?: {
      trackingNumber?: string;
      trackingCarrier?: string;
      trackingUrl?: string;
      reason?: string;
    }
  ) {
    setBusy(true);
    setMessage(null);
    try {
      await api.transitionPrintOrder(id, { type, ...extra });
      await load();
      setMessage({ kind: "success", text: "Status aktualisiert." });
    } catch (err) {
      setMessage({
        kind: "danger",
        text: err instanceof Error ? err.message : "Fehler",
      });
    } finally {
      setBusy(false);
    }
  }

  async function saveNote() {
    setBusy(true);
    try {
      await api.setPrintOrderNote(id, noteValue);
      setMessage({ kind: "success", text: "Notiz gespeichert." });
      await load();
    } catch (err) {
      setMessage({
        kind: "danger",
        text: err instanceof Error ? err.message : "Fehler",
      });
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="rounded-md border border-semantic-danger/30 bg-semantic-danger/8 px-3 py-2 text-sm text-semantic-danger">
        {error}
      </div>
    );
  }
  if (!order) {
    return <div className="text-sm text-ink-tertiary">Lädt…</div>;
  }

  // Status-spezifische Buttons
  const availableTransitions = transitionsForStatus(order.status);

  return (
    <div className="space-y-5">
      <Link
        href="/studio/print-shop/orders"
        className="text-xs text-accent hover:underline"
      >
        ← Alle Bestellungen
      </Link>

      {message && (
        <div
          className={
            message.kind === "success"
              ? "rounded-md border border-semantic-success/30 bg-semantic-success/8 px-3 py-2 text-sm text-semantic-success"
              : "rounded-md border border-semantic-danger/30 bg-semantic-danger/8 px-3 py-2 text-sm text-semantic-danger"
          }
        >
          {message.text}
        </div>
      )}

      {/* Header */}
      <div className="rounded-md border border-line-subtle bg-surface-raised p-4">
        <div className="flex items-start gap-3 flex-wrap mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h1 className="text-lg font-semibold font-mono">
                {order.orderNumber}
              </h1>
              <StatusBadge status={order.status} />
            </div>
            <div className="text-sm text-ink-secondary">
              {order.guestName} &lt;{order.guestEmail}&gt;
            </div>
            <div className="text-xs text-ink-tertiary mt-0.5">
              Bestellt am {new Date(order.createdAt).toLocaleString("de-DE")}
              {" · "}
              Galerie:{" "}
              <Link
                href={`/studio/${order.gallery.id}`}
                className="text-accent hover:underline"
              >
                {order.gallery.title}
              </Link>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-xl font-semibold tabular-nums">
              {formatPrice(order.totalCents, order.currency)}
            </div>
            <div className="text-xs text-ink-tertiary">
              {order.paymentMode === "stripe_connect"
                ? "Online (Stripe)"
                : "Offline-Rechnung"}
            </div>
          </div>
        </div>

        {/* Action-Buttons */}
        {availableTransitions.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-3 border-t border-line-subtle">
            {availableTransitions.map((t) => {
              if (t === "mark_shipped") {
                return (
                  <Button
                    key={t}
                    size="sm"
                    onClick={() => setShippingDialog(true)}
                    disabled={busy}
                  >
                    Versendet
                  </Button>
                );
              }
              if (t === "cancel" || t === "refund") {
                return (
                  <Button
                    key={t}
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      const verb = t === "cancel" ? "stornieren" : "erstatten";
                      const reason = window.prompt(
                        `Grund für die ${verb} (optional):`
                      );
                      if (reason === null) return; // cancelled prompt
                      void transition(t, { reason });
                    }}
                    disabled={busy}
                  >
                    {t === "cancel" ? "Stornieren" : "Erstatten"}
                  </Button>
                );
              }
              return (
                <Button
                  key={t}
                  size="sm"
                  variant={t === "mark_paid" ? "primary" : "secondary"}
                  onClick={() => void transition(t)}
                  disabled={busy}
                >
                  {transitionLabel(t)}
                </Button>
              );
            })}
          </div>
        )}
      </div>

      {/* Tracking-Info wenn schon vorhanden */}
      {(order.trackingNumber || order.trackingUrl) && (
        <Section title="Versand">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            {order.trackingNumber && (
              <>
                <dt className="text-ink-tertiary">Sendungsnummer</dt>
                <dd className="font-mono">{order.trackingNumber}</dd>
              </>
            )}
            {order.trackingCarrier && (
              <>
                <dt className="text-ink-tertiary">Versanddienstleister</dt>
                <dd>{order.trackingCarrier}</dd>
              </>
            )}
            {order.trackingUrl && (
              <>
                <dt className="text-ink-tertiary">Tracking-URL</dt>
                <dd>
                  <a
                    href={order.trackingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline break-all"
                  >
                    {order.trackingUrl}
                  </a>
                </dd>
              </>
            )}
          </dl>
        </Section>
      )}

      {/* Items */}
      <Section title={`Artikel (${order.items.length})`}>
        <ul className="divide-y divide-line-subtle">
          {order.items.map((it) => (
            <li key={it.id} className="py-2 flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="text-sm">
                  <strong>
                    {it.quantity}× {it.printProductVariant.name}
                  </strong>
                </div>
                <div className="text-xs text-ink-tertiary">
                  {it.printProductVariant.printProduct.name} ·{" "}
                  {it.printProductVariant.widthMm}×
                  {it.printProductVariant.heightMm} mm
                  {it.printProductVariant.finishType &&
                    ` · ${it.printProductVariant.finishType}`}
                </div>
                <div className="text-xs text-ink-tertiary mt-0.5">
                  Bild: {it.file.originalFilename}
                </div>
              </div>
              <div className="text-sm tabular-nums">
                {formatPrice(it.totalPriceCents, order.currency)}
              </div>
            </li>
          ))}
        </ul>
        <dl className="mt-3 pt-3 border-t border-line-subtle text-sm space-y-1">
          <div className="flex justify-between">
            <dt className="text-ink-tertiary">Zwischensumme</dt>
            <dd className="tabular-nums">
              {formatPrice(order.subtotalCents, order.currency)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-tertiary">
              Versand
              {order.shippingMethod && ` (${order.shippingMethod.name})`}
            </dt>
            <dd className="tabular-nums">
              {formatPrice(order.shippingCents, order.currency)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-tertiary">MwSt</dt>
            <dd className="tabular-nums">
              {formatPrice(order.taxCents, order.currency)}
            </dd>
          </div>
          <div className="flex justify-between pt-2 border-t border-line-subtle font-semibold">
            <dt>Gesamtsumme</dt>
            <dd className="tabular-nums">
              {formatPrice(order.totalCents, order.currency)}
            </dd>
          </div>
          {order.applicationFeeCents > 0 && (
            <div className="flex justify-between text-xs text-ink-tertiary pt-1">
              <dt>davon Lumio-Anteil</dt>
              <dd className="tabular-nums">
                −{formatPrice(order.applicationFeeCents, order.currency)}
              </dd>
            </div>
          )}
        </dl>
      </Section>

      {/* Adressen */}
      <Section title="Lieferadresse">
        <AddressBlock addr={order.shippingAddress} />
      </Section>

      {order.billingAddress && (
        <Section title="Rechnungsadresse">
          <AddressBlock addr={order.billingAddress} />
        </Section>
      )}

      {/* Kunden-Notiz */}
      {order.guestNote && (
        <Section title="Hinweis vom Kunden">
          <p className="text-sm whitespace-pre-wrap">{order.guestNote}</p>
        </Section>
      )}

      {/* Studio-Notiz */}
      <Section title="Interne Notiz">
        <Textarea
          value={noteValue}
          onChange={(e) => setNoteValue(e.target.value)}
          rows={3}
          placeholder="Notizen fuer das Studio-Team (nicht fuer den Kunden sichtbar)"
        />
        <div className="flex justify-end mt-2">
          <Button
            size="sm"
            onClick={saveNote}
            disabled={busy || noteValue === (order.studioNote ?? "")}
          >
            Notiz speichern
          </Button>
        </div>
      </Section>

      {/* Timeline */}
      <Section title="Verlauf">
        <ol className="space-y-2">
          {order.events.map((e) => (
            <li key={e.id} className="flex gap-3 text-sm">
              <span className="text-ink-tertiary text-xs tabular-nums shrink-0 w-32 sm:w-40">
                {new Date(e.createdAt).toLocaleString("de-DE")}
              </span>
              <span className="flex-1 min-w-0">
                <strong>{eventLabel(e.eventType)}</strong>
                <span className="text-ink-tertiary">
                  {" · "}
                  {actorLabel(e.actor)}
                </span>
                {e.data && Object.keys(e.data).length > 0 && (
                  <div className="text-xs text-ink-tertiary mt-0.5">
                    {Object.entries(e.data)
                      .filter(
                        ([k, v]) =>
                          v !== null && v !== "" && k !== "sweeper"
                      )
                      .map(([k, v]) => `${k}: ${String(v)}`)
                      .join(" · ")}
                  </div>
                )}
              </span>
            </li>
          ))}
        </ol>
      </Section>

      {shippingDialog && (
        <ShippingDialog
          onClose={() => setShippingDialog(false)}
          onSubmit={(values) => {
            setShippingDialog(false);
            void transition("mark_shipped", values);
          }}
        />
      )}
    </div>
  );
}

function ShippingDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (values: {
    trackingNumber?: string;
    trackingCarrier?: string;
    trackingUrl?: string;
  }) => void;
}) {
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingCarrier, setTrackingCarrier] = useState("DHL");
  const [trackingUrl, setTrackingUrl] = useState("");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-surface-raised rounded-md border border-line-subtle p-5 max-w-md w-full">
        <h3 className="text-lg font-semibold mb-3">Als versendet markieren</h3>
        <p className="text-xs text-ink-tertiary mb-3">
          Tracking-Daten sind optional, aber der Kunde bekommt eine Mail —
          mit Tracking ist die Mail viel hilfreicher.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({
              trackingNumber: trackingNumber.trim() || undefined,
              trackingCarrier: trackingCarrier.trim() || undefined,
              trackingUrl: trackingUrl.trim() || undefined,
            });
          }}
          className="space-y-3"
        >
          <label className="block">
            <span className="block text-xs text-ink-tertiary mb-1">
              Sendungsnummer
            </span>
            <Input
              type="text"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              placeholder="z.B. 1Z999AA10123456784"
            />
          </label>
          <label className="block">
            <span className="block text-xs text-ink-tertiary mb-1">
              Versanddienstleister
            </span>
            <Input
              type="text"
              value={trackingCarrier}
              onChange={(e) => setTrackingCarrier(e.target.value)}
              placeholder="DHL, UPS, DPD, ..."
            />
          </label>
          <label className="block">
            <span className="block text-xs text-ink-tertiary mb-1">
              Tracking-URL (optional)
            </span>
            <Input
              type="url"
              value={trackingUrl}
              onChange={(e) => setTrackingUrl(e.target.value)}
              placeholder="https://nolp.dhl.de/..."
            />
          </label>
          <div className="flex gap-2 justify-end pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
            >
              Abbrechen
            </Button>
            <Button type="submit">Versenden</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-line-subtle bg-surface-raised p-4">
      <h2 className="text-sm font-semibold mb-2">{title}</h2>
      {children}
    </section>
  );
}

function AddressBlock({ addr }: { addr: Record<string, string> }) {
  return (
    <address className="not-italic text-sm whitespace-pre-line">
      {[
        addr.street,
        addr.street2,
        `${addr.postalCode ?? ""} ${addr.city ?? ""}`.trim(),
        addr.region,
        addr.countryCode,
      ]
        .filter(Boolean)
        .join("\n")}
      {addr.phone && (
        <div className="text-xs text-ink-tertiary mt-1">{addr.phone}</div>
      )}
    </address>
  );
}

function formatPrice(cents: number, currency = "EUR"): string {
  return (cents / 100).toLocaleString("de-DE", {
    style: "currency",
    currency,
  });
}

function transitionsForStatus(status: string): Array<
  | "mark_paid"
  | "mark_in_production"
  | "mark_shipped"
  | "mark_delivered"
  | "cancel"
  | "refund"
> {
  switch (status) {
    case "pending_payment":
      return ["mark_paid", "cancel"];
    case "paid":
      return ["mark_in_production", "cancel", "refund"];
    case "in_production":
      return ["mark_shipped", "cancel", "refund"];
    case "shipped":
      return ["mark_delivered", "refund"];
    case "delivered":
      return ["refund"];
    default:
      return [];
  }
}

function transitionLabel(t: string): string {
  switch (t) {
    case "mark_paid":
      return "Als bezahlt markieren";
    case "mark_in_production":
      return "In Produktion";
    case "mark_shipped":
      return "Versendet";
    case "mark_delivered":
      return "Zugestellt";
    case "cancel":
      return "Stornieren";
    case "refund":
      return "Erstatten";
    default:
      return t;
  }
}

function eventLabel(t: string): string {
  switch (t) {
    case "created":
      return "Bestellung angelegt";
    case "mark_paid":
      return "Bezahlt";
    case "mark_in_production":
      return "In Produktion";
    case "mark_shipped":
      return "Versendet";
    case "mark_delivered":
      return "Zugestellt";
    case "cancel":
      return "Storniert";
    case "refund":
      return "Erstattet";
    case "note_added":
      return "Notiz hinzugefuegt";
    case "mails_sent_paid":
      return "Bestaetigungsmails versendet";
    default:
      return t;
  }
}

function actorLabel(a: string): string {
  switch (a) {
    case "guest":
      return "Kunde";
    case "studio":
      return "Studio";
    case "system":
      return "System";
    case "super_admin":
      return "Super-Admin";
    default:
      return a;
  }
}
