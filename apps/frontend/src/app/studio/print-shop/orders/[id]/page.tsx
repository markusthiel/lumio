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
import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { PrintOrderDetail } from "@/lib/api";
import { Button, Input, Textarea } from "@/components/ui";
import { StatusBadge } from "../page";
import { useT, useFormat} from "@/lib/i18n";
import type { Formatters } from "@/lib/i18n/format";
import { useErrorText } from "@/lib/error-i18n";
import { usePrompt } from "@/components/ui/dialogs";

export default function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ask = usePrompt();
  const errText = useErrorText();
  const fmt = useFormat();
  const { id } = use(params);
  const t = useT();
  const [order, setOrder] = useState<PrintOrderDetail | null>(null);
  // The studio's own wording of the invoice identifiers ("Codice fiscale"…).
  const [invoiceLabels, setInvoiceLabels] = useState<{
    vatNumber: string | null;
    taxId: string | null;
    eAddress: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<
    { kind: "success" | "danger"; text: string } | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [shippingDialog, setShippingDialog] = useState(false);
  const [noteValue, setNoteValue] = useState("");
  const [zipJob, setZipJob] = useState<{
    zipId: string;
    galleryId: string;
    status: string;
    fileCount: number | null;
    url: string | null;
    error: string | null;
  } | null>(null);
  const zipPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (zipPollRef.current) clearInterval(zipPollRef.current);
    };
  }, []);

  async function requestZip() {
    try {
      const res = await api.requestPrintOrderZip(id);
      setZipJob({
        zipId: res.id,
        galleryId: res.galleryId,
        status: res.status,
        fileCount: res.fileCount,
        url: null,
        error: null,
      });
      if (zipPollRef.current) clearInterval(zipPollRef.current);
      zipPollRef.current = setInterval(async () => {
        try {
          const st = await api.getStudioZipStatus(res.galleryId, res.id);
          setZipJob((prev) =>
            prev
              ? {
                  ...prev,
                  status: st.status,
                  fileCount: st.fileCount,
                  error: st.errorMessage,
                  url:
                    st.status === "ready"
                      ? api.studioZipDownloadUrl(res.galleryId, res.id)
                      : null,
                }
              : prev
          );
          if (st.status === "ready" || st.status === "failed") {
            if (zipPollRef.current) {
              clearInterval(zipPollRef.current);
              zipPollRef.current = null;
            }
          }
        } catch (err) {
          console.error("print order zip status poll failed:", err);
        }
      }, 2000);
    } catch (err) {
      setZipJob({
        zipId: "",
        galleryId: "",
        status: "failed",
        fileCount: null,
        url: null,
        error: errText(err, t("common.error")),
      });
    }
  }

  const load = useCallback(async () => {
    try {
      const r = await api.getPrintOrder(id);
      setOrder(r.order);
      setInvoiceLabels(r.invoiceLabels);
      setNoteValue(r.order.studioNote ?? "");
    } catch (err) {
      setError(errText(err, t("common.error")));
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
      | "mark_ready_for_pickup"
      | "mark_delivered"
      | "cancel"
      | "refund",
    extra?: {
      trackingNumber?: string;
      trackingCarrier?: string;
      trackingUrl?: string;
      reason?: string;
      paymentReference?: string;
    }
  ) {
    setBusy(true);
    setMessage(null);
    try {
      await api.transitionPrintOrder(id, { type, ...extra });
      await load();
      setMessage({ kind: "success", text: t("orderDetail.statusUpdated") });
    } catch (err) {
      setMessage({
        kind: "danger",
        text: errText(err, t("common.error")),
      });
    } finally {
      setBusy(false);
    }
  }

  /** Single place that knows which transitions need extra input before
   *  firing — used by both the action-button row and the fulfillment
   *  checklist, so the two never drift apart on what a click does. */
  async function runTransition(
    tr:
      | "mark_paid"
      | "mark_in_production"
      | "mark_shipped"
      | "mark_ready_for_pickup"
      | "mark_delivered"
      | "cancel"
      | "refund"
  ) {
    if (tr === "mark_shipped") {
      setShippingDialog(true);
      return;
    }
    if (tr === "mark_paid" && order?.paymentMode === "offline_invoice") {
      const paymentReference = await ask({
        message: t("orderDetail.paymentReferencePrompt"),
        placeholder: t("orderDetail.paymentReferencePlaceholder"),
        required: true,
      });
      if (paymentReference === null) return; // dialog dismissed
      void transition(tr, { paymentReference });
      return;
    }
    if (tr === "cancel" || tr === "refund") {
      const verb =
        tr === "cancel" ? t("orderDetail.verbCancel") : t("orderDetail.verbRefund");
      const reason = await ask({
        message: t("orderDetail.reasonPrompt", { verb }),
        required: false,
      });
      if (reason === null) return; // dialog dismissed
      void transition(tr, { reason });
      return;
    }
    void transition(tr);
  }

  async function saveNote() {
    setBusy(true);
    try {
      await api.setPrintOrderNote(id, noteValue);
      setMessage({ kind: "success", text: t("orderDetail.noteSaved") });
      await load();
    } catch (err) {
      setMessage({
        kind: "danger",
        text: errText(err, t("common.error")),
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
    return <div className="text-sm text-ink-tertiary">{t("common.loading")}</div>;
  }

  // Status-spezifische Buttons
  const availableTransitions = transitionsForStatus(
    order.status,
    order.isPickupDelivery
  );

  return (
    <div className="space-y-5">
      <Link
        href="/studio/print-shop/orders"
        className="text-xs text-accent hover:underline"
      >{t("orderDetail.backToOrders")}</Link>

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
              <StatusBadge status={order.status} isPickupDelivery={order.isPickupDelivery} />
            </div>
            <div className="text-sm text-ink-secondary">
              {order.guestName} &lt;{order.guestEmail}&gt;
            </div>
            <div className="text-xs text-ink-tertiary mt-0.5">
              {t("orderDetail.orderedOn", { date: new Date(order.createdAt).toLocaleString(fmt.bcp47) })}
              {" · "}
              {t("orderDetail.galleryLabel")}{" "}
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
              {formatPrice(fmt, order.totalCents, order.currency)}
            </div>
            <div className="text-xs text-ink-tertiary">
              {order.paymentMode === "stripe_connect"
                ? t("orderDetail.paymentOnline")
                : t("orderDetail.paymentOffline")}
            </div>
            {order.paymentReference && (
              <div className="text-xs text-ink-tertiary font-mono">
                {t("orderDetail.paymentReferenceLabel")}: {order.paymentReference}
              </div>
            )}
          </div>
        </div>

        {/* Cancel/Refund — side-exits, not part of the linear fulfillment
            checklist below. The linear steps (mark_paid..mark_delivered)
            are driven from the checklist instead. */}
        {availableTransitions.some((tr) => tr === "cancel" || tr === "refund") && (
          <div className="flex flex-wrap gap-2 pt-3 border-t border-line-subtle">
            {availableTransitions
              .filter((tr) => tr === "cancel" || tr === "refund")
              .map((tr) => (
                <Button
                  key={tr}
                  size="sm"
                  variant="secondary"
                  onClick={() => void runTransition(tr)}
                  disabled={busy}
                >
                  {t(transitionLabel(tr, order.isPickupDelivery))}
                </Button>
              ))}
          </div>
        )}
      </div>

      {/* Fulfillment-Checklist */}
      {order.status !== "cancelled" && order.status !== "refunded" && (
        <FulfillmentChecklist
          order={order}
          nextTransition={availableTransitions.find(
            (tr) => tr !== "cancel" && tr !== "refund"
          )}
          onAdvance={(tr) => void runTransition(tr)}
          busy={busy}
        />
      )}

      {/* Tracking-Info wenn schon vorhanden */}
      {(order.trackingNumber || order.trackingUrl) && (
        <Section title={t("orderDetail.secShipping")}>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            {order.trackingNumber && (
              <>
                <dt className="text-ink-tertiary">{t("orderDetail.trackingNumber")}</dt>
                <dd className="font-mono">{order.trackingNumber}</dd>
              </>
            )}
            {order.trackingCarrier && (
              <>
                <dt className="text-ink-tertiary">{t("orderDetail.trackingCarrier")}</dt>
                <dd>{order.trackingCarrier}</dd>
              </>
            )}
            {order.trackingUrl && (
              <>
                <dt className="text-ink-tertiary">{t("orderDetail.trackingUrl")}</dt>
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
      <Section
        title={t("orderDetail.secItems", { n: order.items.length })}
        action={
          <div className="flex items-center gap-3 flex-wrap justify-end">
            <a
              href={api.printOrderExportCsvUrl(id)}
              className="text-xs text-accent hover:underline whitespace-nowrap"
            >
              {t("orderDetail.downloadCsv")}
            </a>
            <a
              href={api.printOrderExportMdUrl(id)}
              className="text-xs text-accent hover:underline whitespace-nowrap"
            >
              {t("orderDetail.downloadMd")}
            </a>
            {!zipJob && (
              <button
                type="button"
                onClick={() => void requestZip()}
                className="text-xs text-accent hover:underline whitespace-nowrap"
              >
                {t("orderDetail.downloadZip")}
              </button>
            )}
            {zipJob && zipJob.status !== "ready" && zipJob.status !== "failed" && (
              <span className="text-xs text-ink-secondary flex items-center gap-1.5 whitespace-nowrap">
                <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse" />
                {t("orderDetail.zipBuilding")}
              </span>
            )}
            {zipJob && zipJob.status === "ready" && zipJob.url && (
              <a
                href={zipJob.url}
                className="text-xs text-semantic-success hover:underline font-medium whitespace-nowrap"
              >
                {t("orderDetail.zipReady")}
              </a>
            )}
            {zipJob && zipJob.status === "failed" && (
              <button
                type="button"
                onClick={() => void requestZip()}
                className="text-xs text-semantic-danger hover:underline whitespace-nowrap"
                title={zipJob.error ?? undefined}
              >
                {t("orderDetail.zipFailed")} — {t("orderDetail.zipRetry")}
              </button>
            )}
          </div>
        }
      >
        <ul className="divide-y divide-line-subtle">
          {order.items.map((it) => (
            <li key={it.id} className="py-2 flex items-center gap-3 flex-wrap">
              {/* Vorschau mit dem vom Kunden gewaehlten Ausschnitt (#55).
                  Bis eine zugeschnittene Datei erzeugt wird, ist das der
                  einzige Ort, an dem das Studio den Crop ueberhaupt sieht —
                  vorher war er gespeichert, aber nirgends sichtbar, und
                  der Download darunter liefert das ungeschnittene Original. */}
              {it.file.previewUrl && (
                <div className="relative shrink-0 w-24 h-24 bg-surface-sunken rounded-xs overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={it.file.previewUrl}
                    alt=""
                    className="absolute inset-0 w-full h-full object-contain"
                  />
                  {it.crop && (
                    <CropOverlay
                      crop={it.crop}
                      imageWidth={it.file.width}
                      imageHeight={it.file.height}
                    />
                  )}
                </div>
              )}
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
                  {it.finishOptionName && ` · ${it.finishOptionName}`}
                </div>
                <div className="text-xs text-ink-tertiary mt-0.5">
                  {t("orderDetail.imageLabel")}{" "}
                  <a
                    href={api.studioFileDownloadUrl(it.file.id)}
                    className="text-accent hover:underline"
                  >
                    {it.file.originalFilename}
                  </a>
                </div>
                {it.crop && (
                  <div className="text-xs text-ink-tertiary mt-0.5">
                    {t("orderDetail.cropLabel")}{" "}
                    <span className="font-mono">
                      {formatCropText(it.crop, it.file.width, it.file.height)}
                    </span>
                    {" · "}
                    {it.printFileKey ? (
                      // Gerendert: der Link liefert die geschnittene Datei.
                      <a
                        href={api.studioPrintFileUrl(order.id, it.id)}
                        className="text-accent hover:underline"
                      >
                        {t("orderDetail.cropDownload")}
                      </a>
                    ) : it.printFileError ? (
                      // Rendering ist gescheitert — das Studio muss selbst
                      // schneiden und soll wissen, warum.
                      <span
                        className="text-semantic-danger"
                        title={it.printFileError}
                      >
                        {t("orderDetail.cropRenderFailed")}
                      </span>
                    ) : (
                      // Noch nicht gerendert: vor `paid`, oder der Worker
                      // ist noch nicht durch.
                      <span className="text-semantic-warning">
                        {t("orderDetail.cropNotApplied")}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="text-sm tabular-nums">
                {formatPrice(fmt, it.totalPriceCents, order.currency)}
              </div>
            </li>
          ))}
        </ul>
        <dl className="mt-3 pt-3 border-t border-line-subtle text-sm space-y-1">
          <div className="flex justify-between">
            <dt className="text-ink-tertiary">{t("orderDetail.subtotal")}</dt>
            <dd className="tabular-nums">
              {formatPrice(fmt, order.subtotalCents, order.currency)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-tertiary">
              {t("orderDetail.shipping")}
              {order.shippingMethod && ` (${order.shippingMethod.name})`}
            </dt>
            <dd className="tabular-nums">
              {formatPrice(fmt, order.shippingCents, order.currency)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-tertiary">{t("orderDetail.vat")}</dt>
            <dd className="tabular-nums">
              {formatPrice(fmt, order.taxCents, order.currency)}
            </dd>
          </div>
          <div className="flex justify-between pt-2 border-t border-line-subtle font-semibold">
            <dt>{t("orderDetail.total")}</dt>
            <dd className="tabular-nums">
              {formatPrice(fmt, order.totalCents, order.currency)}
            </dd>
          </div>
          {order.applicationFeeCents > 0 && (
            <div className="flex justify-between text-xs text-ink-tertiary pt-1">
              <dt>{t("orderDetail.lumioShare")}</dt>
              <dd className="tabular-nums">
                −{formatPrice(fmt, order.applicationFeeCents, order.currency)}
              </dd>
            </div>
          )}
        </dl>
      </Section>

      {/* Customer registry — empty on orders placed before it was collected */}
      {(order.guestTaxCode || order.guestPhone || order.customerAddress) && (
        <Section title={t("orderDetail.secCustomer")}>
          <dl className="text-sm grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            {order.guestTaxCode && (
              <>
                <dt className="text-ink-tertiary">
                  {invoiceLabels?.taxId ?? t("orderDetail.taxCodeLabel")}
                </dt>
                <dd className="font-mono">{order.guestTaxCode}</dd>
              </>
            )}
            {order.guestPhone && (
              <>
                <dt className="text-ink-tertiary">{t("orderDetail.phoneLabel")}</dt>
                <dd>{order.guestPhone}</dd>
              </>
            )}
          </dl>
          {order.customerAddress && (
            <div className="mt-3">
              <div className="text-xs text-ink-tertiary mb-1">
                {t("orderDetail.residenceLabel")}
              </div>
              <AddressBlock addr={order.customerAddress} />
            </div>
          )}
        </Section>
      )}

      {/* Adressen */}
      <Section title={t("orderDetail.secShippingAddr")}>
        {order.shippingAddress ? (
          <AddressBlock addr={order.shippingAddress} />
        ) : (
          <p className="text-sm text-ink-tertiary">{t("orderDetail.pickupNoAddress")}</p>
        )}
      </Section>

      {order.invoiceRequested ? (
        <Section title={t("orderDetail.secInvoice")}>
          {/* Which identifiers exist depends on what the studio asked for —
              show only the ones that were asked for and given. */}
          <dl className="text-sm grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            {order.invoiceKind && (
              <>
                <dt className="text-ink-tertiary">{t("orderDetail.invoiceKindLabel")}</dt>
                <dd>
                  {order.invoiceKind === "business"
                    ? t("orderDetail.kindBusiness")
                    : t("orderDetail.kindPrivate")}
                </dd>
              </>
            )}
            <dt className="text-ink-tertiary">{t("orderDetail.invoiceToLabel")}</dt>
            <dd>{order.invoiceName ?? "—"}</dd>
            {order.invoiceVatNumber && (
              <>
                <dt className="text-ink-tertiary">
                  {invoiceLabels?.vatNumber ?? t("orderDetail.vatNumberLabel")}
                </dt>
                <dd className="font-mono">{order.invoiceVatNumber}</dd>
              </>
            )}
            {order.invoiceTaxCode && (
              <>
                <dt className="text-ink-tertiary">
                  {invoiceLabels?.taxId ?? t("orderDetail.taxCodeLabel")}
                </dt>
                <dd className="font-mono">{order.invoiceTaxCode}</dd>
              </>
            )}
            {order.invoiceEAddress && (
              <>
                <dt className="text-ink-tertiary">
                  {invoiceLabels?.eAddress ?? t("orderDetail.eAddressLabel")}
                </dt>
                <dd className="font-mono break-all">{order.invoiceEAddress}</dd>
              </>
            )}
          </dl>
          {order.billingAddress && (
            <div className="mt-3">
              <div className="text-xs text-ink-tertiary mb-1">
                {t("orderDetail.secBillingAddr")}
              </div>
              <AddressBlock addr={order.billingAddress} />
            </div>
          )}
        </Section>
      ) : (
        // Orders from before the invoice request could already carry a
        // billing address (an API field) without invoiceRequested.
        order.billingAddress && (
          <Section title={t("orderDetail.secBillingAddr")}>
            <AddressBlock addr={order.billingAddress} />
          </Section>
        )
      )}

      {/* Kunden-Notiz */}
      {order.guestNote && (
        <Section title={t("orderDetail.secGuestNote")}>
          <p className="text-sm whitespace-pre-wrap">{order.guestNote}</p>
        </Section>
      )}

      {/* Studio-Notiz */}
      <Section title={t("orderDetail.secInternalNote")}>
        <Textarea
          value={noteValue}
          onChange={(e) => setNoteValue(e.target.value)}
          rows={3}
          placeholder={t("orderDetail.notePlaceholder")}
        />
        <div className="flex justify-end mt-2">
          <Button
            size="sm"
            onClick={saveNote}
            disabled={busy || noteValue === (order.studioNote ?? "")}
          >{t("orderDetail.saveNote")}</Button>
        </div>
      </Section>

      {/* Timeline */}
      <Section title={t("orderDetail.secHistory")}>
        <ol className="space-y-2">
          {order.events.map((e) => (
            <li key={e.id} className="flex gap-3 text-sm">
              <span className="text-ink-tertiary text-xs tabular-nums shrink-0 w-32 sm:w-40">
                {new Date(e.createdAt).toLocaleString(fmt.bcp47)}
              </span>
              <span className="flex-1 min-w-0">
                <strong>{t(eventLabel(e.eventType, order.isPickupDelivery))}</strong>
                <span className="text-ink-tertiary">
                  {" · "}
                  {t(actorLabel(e.actor))}
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
  const t = useT();
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
        <h3 className="text-lg font-semibold mb-3">{t("orderDetail.shipDialogTitle")}</h3>
        <p className="text-xs text-ink-tertiary mb-3">
          {t("orderDetail.shipDialogDesc")}
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
            <span className="block text-xs text-ink-tertiary mb-1">{t("orderDetail.trackingNumber")}</span>
            <Input
              type="text"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              placeholder={t("orderDetail.trackingNumberPlaceholder")}
            />
          </label>
          <label className="block">
            <span className="block text-xs text-ink-tertiary mb-1">{t("orderDetail.trackingCarrier")}</span>
            <Input
              type="text"
              value={trackingCarrier}
              onChange={(e) => setTrackingCarrier(e.target.value)}
              placeholder={t("orderDetail.trackingCarrierPlaceholder")}
            />
          </label>
          <label className="block">
            <span className="block text-xs text-ink-tertiary mb-1">{t("orderDetail.trackingUrlOptional")}</span>
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
            >{t("common.cancel")}</Button>
            <Button type="submit">{t("orderDetail.shipSubmit")}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

type LinearTransition =
  | "mark_paid"
  | "mark_in_production"
  | "mark_shipped"
  | "mark_ready_for_pickup"
  | "mark_delivered";

const STATUS_RANK: Record<string, number> = {
  pending_payment: 0,
  paid: 1,
  in_production: 2,
  shipped: 3,
  ready_for_pickup: 3,
  delivered: 4,
};

/** Read-at-a-glance progress through the linear part of the order
 *  lifecycle (cancel/refund are side-exits, shown separately). Each
 *  step's status is derived from order.status, not tracked
 *  independently — clicking the current step fires the same
 *  transition as the equivalent action button (via onAdvance), so
 *  the checklist can never drift from the real state machine. */
function FulfillmentChecklist({
  order,
  nextTransition,
  onAdvance,
  busy,
}: {
  order: PrintOrderDetail;
  nextTransition: LinearTransition | "cancel" | "refund" | undefined;
  onAdvance: (tr: LinearTransition) => void;
  busy: boolean;
}) {
  const t = useT();
  const steps: Array<{ status: string; type: LinearTransition; title: string }> = [
    { status: "paid", type: "mark_paid", title: t("orderDetail.checklistOrdered") },
    { status: "in_production", type: "mark_in_production", title: t("orderDetail.checklistPrinting") },
    order.isPickupDelivery
      ? {
          status: "ready_for_pickup",
          type: "mark_ready_for_pickup",
          title: t("orderDetail.checklistReadyForPickup"),
        }
      : { status: "shipped", type: "mark_shipped", title: t("orderDetail.checklistShipped") },
    {
      status: "delivered",
      type: "mark_delivered",
      title: order.isPickupDelivery
        ? t("orderDetail.checklistPickedUp")
        : t("orderDetail.checklistDelivered"),
    },
  ];
  // shipped and ready_for_pickup share a rank: allowedTransitionsFor()
  // already tolerates order.status/isPickupDelivery disagreeing (a stale
  // flag never dead-ends an order), so this checklist shouldn't vanish
  // over the same mismatch — a plain array keyed on isPickupDelivery
  // would return -1 for whichever status it didn't include.
  const currentRank = STATUS_RANK[order.status] ?? -1;
  if (currentRank < 0) return null; // draft or an unknown status

  return (
    <Section title={t("orderDetail.secChecklist")}>
      <ul className="space-y-2">
        {steps.map((s, i) => {
          const stepRank = STATUS_RANK[s.status];
          const done = currentRank >= stepRank;
          const isNext = nextTransition === s.type;
          return (
            <li
              key={s.status}
              className="flex items-center gap-3 rounded-md border border-line-subtle p-2.5"
            >
              <span
                className={
                  done
                    ? "shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-semantic-success/15 text-semantic-success text-sm"
                    : "shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-surface-sunken text-ink-tertiary text-sm"
                }
              >
                {done ? "✓" : i + 1}
              </span>
              <span className="flex-1 text-sm font-medium">{s.title}</span>
              {isNext && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onAdvance(s.type)}
                >
                  {t("orderDetail.checklistMark")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-line-subtle bg-surface-raised p-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
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

function formatPrice(fmt: Formatters, cents: number, currency = "EUR"): string {
  return fmt.currencyFromMinor(cents, currency);
}

/** Mirrors allowedTransitionsFor() in apps/api/src/services/print/orders.ts —
 *  the 'in_production' step forks on isPickupDelivery. */
function transitionsForStatus(
  status: string,
  isPickupDelivery: boolean
): Array<
  | "mark_paid"
  | "mark_in_production"
  | "mark_shipped"
  | "mark_ready_for_pickup"
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
      return isPickupDelivery
        ? ["mark_ready_for_pickup", "cancel", "refund"]
        : ["mark_shipped", "cancel", "refund"];
    case "shipped":
    case "ready_for_pickup":
      return ["mark_delivered", "refund"];
    case "delivered":
      return ["refund"];
    default:
      return [];
  }
}

function transitionLabel(t: string, isPickupDelivery: boolean): string {
  switch (t) {
    case "mark_paid":
      return "orderDetail.actMarkPaid";
    case "mark_in_production":
      return "orderDetail.actInProduction";
    case "mark_shipped":
      return "orderDetail.actShipped";
    case "mark_ready_for_pickup":
      return "orderDetail.actReadyForPickup";
    case "mark_delivered":
      return isPickupDelivery
        ? "orderDetail.actPickedUp"
        : "orderDetail.actDelivered";
    case "cancel":
      return "orderDetail.actCancel";
    case "refund":
      return "orderDetail.actRefund";
    default:
      return t;
  }
}

function eventLabel(t: string, isPickupDelivery: boolean): string {
  switch (t) {
    case "created":
      return "orderDetail.evCreated";
    case "mark_paid":
      return "orderDetail.evPaid";
    case "mark_in_production":
      return "orderDetail.evInProduction";
    case "mark_shipped":
      return "orderDetail.evShipped";
    case "mark_ready_for_pickup":
      return "orderDetail.evReadyForPickup";
    case "mark_delivered":
      return isPickupDelivery ? "orderDetail.evPickedUp" : "orderDetail.evDelivered";
    case "cancel":
      return "orderDetail.evCancel";
    case "refund":
      return "orderDetail.evRefund";
    case "note_added":
      return "orderDetail.evNote";
    case "mails_sent_paid":
      return "orderDetail.evMailsPaid";
    default:
      return t;
  }
}

function actorLabel(a: string): string {
  switch (a) {
    case "guest":
      return "orderDetail.actorGuest";
    case "studio":
      return "orderDetail.actorStudio";
    case "system":
      return "orderDetail.actorSystem";
    case "super_admin":
      return "orderDetail.actorSuperAdmin";
    default:
      return a;
  }
}


/**
 * Zeichnet das Crop-Rechteck ueber ein object-contain-Bild. Die Crop-
 * Werte sind auf das BILD normiert, das Bild fuellt den Container aber
 * nur in einer Achse — darum erst die Letterbox-Offsets berechnen und
 * dann das Rechteck in den tatsaechlichen Bildbereich legen. Ohne das
 * saesse das Rechteck bei einem Hochformat-Foto im leeren Rand.
 */
function CropOverlay({
  crop,
  imageWidth,
  imageHeight,
}: {
  crop: { x: number; y: number; width: number; height: number };
  imageWidth: number | null;
  imageHeight: number | null;
}) {
  // Ohne Bildmasse kennen wir das Letterboxing nicht — dann lieber das
  // Rechteck relativ zum Container zeigen als gar nichts.
  let left = crop.x, top = crop.y, w = crop.width, h = crop.height;
  if (imageWidth && imageHeight) {
    const ratio = imageWidth / imageHeight;
    // Container ist quadratisch (w-24 h-24).
    const drawnW = ratio >= 1 ? 1 : ratio;
    const drawnH = ratio >= 1 ? 1 / ratio : 1;
    const offX = (1 - drawnW) / 2;
    const offY = (1 - drawnH) / 2;
    left = offX + crop.x * drawnW;
    top = offY + crop.y * drawnH;
    w = crop.width * drawnW;
    h = crop.height * drawnH;
  }
  return (
    <div
      aria-hidden="true"
      className="absolute border-2 border-accent pointer-events-none"
      style={{
        left: `${left * 100}%`,
        top: `${top * 100}%`,
        width: `${w * 100}%`,
        height: `${h * 100}%`,
        boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
      }}
    />
  );
}

/** Crop als Text — Pixel wenn die Bildmasse bekannt sind, sonst Prozent.
 *  Spiegelt formatCrop() im API-Export, damit Bildschirm und PDF/MD
 *  dieselben Zahlen zeigen. */
function formatCropText(
  crop: { x: number; y: number; width: number; height: number },
  imageWidth: number | null,
  imageHeight: number | null
): string {
  if (imageWidth && imageHeight) {
    const x = Math.round(crop.x * imageWidth);
    const y = Math.round(crop.y * imageHeight);
    const w = Math.round(crop.width * imageWidth);
    const h = Math.round(crop.height * imageHeight);
    return `${w}×${h} px @ ${x},${y}`;
  }
  const p = (v: number) => `${Math.round(v * 100)}%`;
  return `${p(crop.width)}×${p(crop.height)} @ ${p(crop.x)},${p(crop.y)}`;
}
