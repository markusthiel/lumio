/**
 * Lumio API — Print-Shop Mail-Templates
 *
 * Endkunden-Bestaetigung, Studio-Notifikation, Versand-Notifikation.
 * Folgt dem Template-Pattern von mail.ts: subject/text/html als POJO.
 */

interface OrderLike {
  id: string;
  orderNumber: string;
  totalCents: number;
  currency: string;
  paymentMode: string;
  guestEmail: string;
  guestName: string;
  shippingAddress: unknown;
  guestNote: string | null;
  trackingNumber: string | null;
  trackingCarrier: string | null;
  trackingUrl: string | null;
  items: Array<{
    quantity: number;
    unitPriceCents: number;
    totalPriceCents: number;
    printProductVariant: { name: string; widthMm: number; heightMm: number };
    file: { id: string; filename: string };
  }>;
  shippingMethod: { name: string; priceCents: number } | null;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
}

function formatPrice(cents: number, currency = "EUR"): string {
  return (cents / 100).toLocaleString("de-DE", {
    style: "currency",
    currency,
  });
}

function formatAddress(a: unknown): string {
  if (!a || typeof a !== "object") return "";
  const addr = a as Record<string, string | undefined>;
  return [
    addr.street,
    addr.street2,
    `${addr.postalCode ?? ""} ${addr.city ?? ""}`.trim(),
    addr.region,
    addr.countryCode,
  ]
    .filter(Boolean)
    .join("\n");
}

function itemsTextBlock(items: OrderLike["items"], currency: string): string {
  return items
    .map(
      (i) =>
        `  • ${i.quantity}× ${i.printProductVariant.name} ` +
        `(${i.printProductVariant.widthMm}×${i.printProductVariant.heightMm} mm) ` +
        `— ${formatPrice(i.totalPriceCents, currency)}`
    )
    .join("\n");
}

function itemsHtmlBlock(items: OrderLike["items"], currency: string): string {
  return items
    .map(
      (i) =>
        `<tr>
           <td style="padding:6px 12px;border-bottom:1px solid #eee;">
             ${i.quantity}× <strong>${escapeHtml(i.printProductVariant.name)}</strong>
             <br><small style="color:#888;">${i.printProductVariant.widthMm}×${i.printProductVariant.heightMm} mm</small>
           </td>
           <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;font-variant-numeric:tabular-nums;">
             ${formatPrice(i.totalPriceCents, currency)}
           </td>
         </tr>`
    )
    .join("");
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// =============================================================================
// 1) Endkunde — Bestellbestaetigung (nach 'paid')
// =============================================================================
export function tmplPrintOrderConfirmGuest(opts: {
  studioName: string;
  supportEmail: string;
  order: OrderLike;
}): { subject: string; text: string; html: string } {
  const { studioName, supportEmail, order } = opts;
  const subject = `Deine Bestellung ${order.orderNumber} bei ${studioName}`;

  const text =
    `Hallo ${order.guestName},

vielen Dank für deine Bestellung bei ${studioName}.

Bestellnummer: ${order.orderNumber}

Artikel:
${itemsTextBlock(order.items, order.currency)}

Zwischensumme: ${formatPrice(order.subtotalCents, order.currency)}
Versand${order.shippingMethod ? ` (${order.shippingMethod.name})` : ""}: ${formatPrice(order.shippingCents, order.currency)}
MwSt: ${formatPrice(order.taxCents, order.currency)}
Gesamtsumme: ${formatPrice(order.totalCents, order.currency)}

Lieferadresse:
${formatAddress(order.shippingAddress)}

${
  order.paymentMode === "offline_invoice"
    ? `Du bekommst von ${studioName} in Kürze eine Rechnung. Sobald die Zahlung eingeht, wird deine Bestellung produziert und verschickt.`
    : "Wir bereiten deine Bestellung jetzt zur Produktion vor. Du bekommst eine weitere Mail sobald sie versendet wird."
}

Bei Fragen: ${supportEmail || "support@lumio-cloud.de"}

Viele Grüße,
${studioName}`;

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#222;">
  <p>Hallo ${escapeHtml(order.guestName)},</p>
  <p>vielen Dank für deine Bestellung bei <strong>${escapeHtml(studioName)}</strong>.</p>
  <p style="background:#f5f5f5;padding:10px 14px;border-radius:4px;display:inline-block;">
    Bestellnummer: <strong style="font-family:monospace;">${order.orderNumber}</strong>
  </p>
  <h3 style="margin-top:24px;">Artikel</h3>
  <table style="width:100%;border-collapse:collapse;">
    ${itemsHtmlBlock(order.items, order.currency)}
    <tr><td style="padding:6px 12px;color:#888;">Zwischensumme</td><td style="padding:6px 12px;text-align:right;font-variant-numeric:tabular-nums;">${formatPrice(order.subtotalCents, order.currency)}</td></tr>
    <tr><td style="padding:6px 12px;color:#888;">Versand${order.shippingMethod ? " (" + escapeHtml(order.shippingMethod.name) + ")" : ""}</td><td style="padding:6px 12px;text-align:right;font-variant-numeric:tabular-nums;">${formatPrice(order.shippingCents, order.currency)}</td></tr>
    <tr><td style="padding:6px 12px;color:#888;">MwSt</td><td style="padding:6px 12px;text-align:right;font-variant-numeric:tabular-nums;">${formatPrice(order.taxCents, order.currency)}</td></tr>
    <tr><td style="padding:10px 12px;font-weight:600;border-top:2px solid #222;">Gesamtsumme</td><td style="padding:10px 12px;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;border-top:2px solid #222;">${formatPrice(order.totalCents, order.currency)}</td></tr>
  </table>
  <h3 style="margin-top:24px;">Lieferadresse</h3>
  <pre style="font-family:inherit;white-space:pre-wrap;margin:0;color:#444;">${escapeHtml(formatAddress(order.shippingAddress))}</pre>
  <p style="margin-top:24px;color:#444;">
    ${
      order.paymentMode === "offline_invoice"
        ? `Du bekommst von ${escapeHtml(studioName)} in Kürze eine Rechnung. Sobald die Zahlung eingeht, wird deine Bestellung produziert und verschickt.`
        : "Wir bereiten deine Bestellung jetzt zur Produktion vor. Du bekommst eine weitere Mail sobald sie versendet wird."
    }
  </p>
  <p style="color:#888;font-size:13px;margin-top:24px;">
    Bei Fragen: <a href="mailto:${escapeHtml(supportEmail)}">${escapeHtml(supportEmail || "support@lumio-cloud.de")}</a>
  </p>
</body></html>`;

  return { subject, text, html };
}

// =============================================================================
// 2) Studio — neue Bestellung eingegangen
// =============================================================================
export function tmplPrintOrderNotifyStudio(opts: {
  studioName: string;
  order: OrderLike;
  baseUrl: string;
}): { subject: string; text: string; html: string } {
  const { order, baseUrl } = opts;
  const orderUrl = `${baseUrl.replace(/\/+$/, "")}/studio/print-shop/orders/${order.id}`;
  const subject = `Neue Print-Bestellung: ${order.orderNumber}`;

  const text =
    `Neue Bestellung im Print-Shop:

Bestellnummer: ${order.orderNumber}
Kunde: ${order.guestName} <${order.guestEmail}>
Bezahlmodus: ${order.paymentMode === "stripe_connect" ? "Online (Stripe)" : "Offline-Rechnung"}
Gesamtsumme: ${formatPrice(order.totalCents, order.currency)}

Artikel:
${itemsTextBlock(order.items, order.currency)}

Lieferadresse:
${formatAddress(order.shippingAddress)}

${order.guestNote ? `Hinweis vom Kunden:\n${order.guestNote}\n` : ""}
Zur Bestellung im Studio:
${orderUrl}`;

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#222;">
  <p>Neue Bestellung im Print-Shop:</p>
  <table style="border-collapse:collapse;">
    <tr><td style="padding:4px 12px 4px 0;color:#888;">Bestellnummer:</td><td style="padding:4px 0;"><strong style="font-family:monospace;">${order.orderNumber}</strong></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#888;">Kunde:</td><td style="padding:4px 0;">${escapeHtml(order.guestName)} &lt;${escapeHtml(order.guestEmail)}&gt;</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#888;">Bezahlmodus:</td><td style="padding:4px 0;">${order.paymentMode === "stripe_connect" ? "Online (Stripe)" : "Offline-Rechnung"}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#888;">Gesamtsumme:</td><td style="padding:4px 0;font-weight:600;">${formatPrice(order.totalCents, order.currency)}</td></tr>
  </table>
  <h3>Artikel</h3>
  <table style="width:100%;border-collapse:collapse;">
    ${itemsHtmlBlock(order.items, order.currency)}
  </table>
  <h3 style="margin-top:20px;">Lieferadresse</h3>
  <pre style="font-family:inherit;white-space:pre-wrap;margin:0;color:#444;">${escapeHtml(formatAddress(order.shippingAddress))}</pre>
  ${order.guestNote ? `<h3 style="margin-top:20px;">Hinweis vom Kunden</h3><blockquote style="border-left:3px solid #ddd;padding-left:12px;margin:0;color:#444;">${escapeHtml(order.guestNote)}</blockquote>` : ""}
  <p style="margin-top:24px;">
    <a href="${orderUrl}" style="display:inline-block;padding:10px 18px;background:#222;color:#fff;text-decoration:none;border-radius:4px;">Bestellung öffnen</a>
  </p>
</body></html>`;

  return { subject, text, html };
}

// =============================================================================
// 3) Endkunde — Versand-Notifikation
// =============================================================================
export function tmplPrintOrderShippedGuest(opts: {
  studioName: string;
  supportEmail: string;
  order: OrderLike;
}): { subject: string; text: string; html: string } {
  const { studioName, supportEmail, order } = opts;
  const subject = `Deine Bestellung ${order.orderNumber} ist auf dem Weg`;

  const trackingLine = order.trackingNumber
    ? `Sendungsverfolgung: ${order.trackingNumber}` +
      (order.trackingCarrier ? ` (${order.trackingCarrier})` : "") +
      (order.trackingUrl ? `\n${order.trackingUrl}` : "")
    : "Wir haben leider noch keine Tracking-Nummer, deine Bestellung wurde aber verschickt.";

  const text =
    `Hallo ${order.guestName},

deine Bestellung ${order.orderNumber} ist auf dem Weg zu dir.

${trackingLine}

Lieferadresse:
${formatAddress(order.shippingAddress)}

Viele Grüße,
${studioName}

Bei Fragen: ${supportEmail || "support@lumio-cloud.de"}`;

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#222;">
  <p>Hallo ${escapeHtml(order.guestName)},</p>
  <p>deine Bestellung <strong style="font-family:monospace;">${order.orderNumber}</strong> ist auf dem Weg zu dir.</p>
  ${
    order.trackingNumber
      ? `<p style="background:#f5f5f5;padding:10px 14px;border-radius:4px;">
           <strong>Sendungsverfolgung:</strong> ${escapeHtml(order.trackingNumber)}
           ${order.trackingCarrier ? ` (${escapeHtml(order.trackingCarrier)})` : ""}
           ${order.trackingUrl ? `<br><a href="${escapeHtml(order.trackingUrl)}">Paket verfolgen</a>` : ""}
         </p>`
      : `<p style="color:#666;">Wir haben leider noch keine Tracking-Nummer, deine Bestellung wurde aber verschickt.</p>`
  }
  <h3>Lieferadresse</h3>
  <pre style="font-family:inherit;white-space:pre-wrap;margin:0;color:#444;">${escapeHtml(formatAddress(order.shippingAddress))}</pre>
  <p style="margin-top:24px;color:#444;">Viele Grüße,<br>${escapeHtml(studioName)}</p>
  <p style="color:#888;font-size:13px;margin-top:24px;">
    Bei Fragen: <a href="mailto:${escapeHtml(supportEmail)}">${escapeHtml(supportEmail || "support@lumio-cloud.de")}</a>
  </p>
</body></html>`;

  return { subject, text, html };
}
