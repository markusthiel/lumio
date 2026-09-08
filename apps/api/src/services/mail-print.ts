/**
 * Lumio API — Print-Shop Mail-Templates
 *
 * Endkunden-Bestaetigung, Studio-Notifikation, Versand-Notifikation.
 * Folgt dem Template-Pattern von mail.ts: subject/text/html als POJO.
 *
 * Diese drei Mails haben frueher ihr eigenes nacktes HTML gebaut und
 * damit das Branding-System umgangen: kein Studio-Logo, keine
 * Akzentfarbe, kein Absender-Kopf. Sie laufen jetzt durch
 * renderMailLayout() wie alle anderen — mit dem Studio-Branding, und
 * ohne eigenes Logo mit der Lumio-Bildmarke.
 */
import { supportAddress } from "./mail.js";
import {
  renderMailLayout,
  mailButton,
  type MailBranding,
} from "./mail-layout.js";
import {
  instanceMailLocale,
  phrase,
  type MailLocale,
  type Phrase,
  localeTag,
} from "./mail-i18n.js";

/** Kontaktadresse fuer Print-Mails: Studio-Support > Instanz-Support.
 *  Frueher stand hier fest support@lumio-cloud.de — fuer Self-Hoster
 *  eine fremde Adresse, die den Endkunden ins Leere schickt. */
function printSupport(studioSupport: string): string | null {
  return studioSupport?.trim() || supportAddress();
}

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

/** Preis in der Sprache des Empfaengers, nicht fest de-DE. */
function formatPrice(
  cents: number,
  currency = "EUR",
  locale: MailLocale = "de"
): string {
  return (cents / 100).toLocaleString(localeTag(locale), {
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

function itemsTextBlock(
  items: OrderLike["items"],
  currency: string,
  locale: MailLocale = "de"
): string {
  return items
    .map(
      (i) =>
        `  • ${i.quantity}× ${i.printProductVariant.name} ` +
        `(${i.printProductVariant.widthMm}×${i.printProductVariant.heightMm} mm) ` +
        `— ${formatPrice(i.totalPriceCents, currency, locale)}`
    )
    .join("\n");
}

function itemsHtmlBlock(
  items: OrderLike["items"],
  currency: string,
  locale: MailLocale = "de"
): string {
  return items
    .map(
      (i) =>
        `<tr>
           <td style="padding:6px 12px;border-bottom:1px solid #eee;">
             ${i.quantity}× <strong>${escapeHtml(i.printProductVariant.name)}</strong>
             <br><small style="color:#888;">${i.printProductVariant.widthMm}×${i.printProductVariant.heightMm} mm</small>
           </td>
           <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;font-variant-numeric:tabular-nums;">
             ${formatPrice(i.totalPriceCents, currency, locale)}
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

/**
 * Empfaenger dieser beiden Vorlagen: die GAESTE, die im Print-Shop
 * bestellt haben. Kein Konto, keine bekannte Sprache — also folgt sie
 * dem Studio (Tenant.locale), siehe mail-i18n.ts.
 *
 * Die Studio-Vorlage dazwischen (tmplPrintOrderNotifyStudio) gehoert in
 * die andere Gruppe und wird spaeter mit den uebrigen Betreiber-Mails
 * umgestellt.
 */
const printGuestPhrases = {
  confirmSubject: {
    de: "Deine Bestellung {order} bei {studio}",
    en: "Your order {order} with {studio}",
    it: "Il tuo ordine {order} presso {studio}",
    fi: "Tilauksesi {order} studiolta {studio}",
  },
  greeting: {
    de: "Hallo {name},",
    en: "Hello {name},",
    it: "Ciao {name},",
    fi: "Hei {name},",
  },
  thanks: {
    de: "vielen Dank für deine Bestellung bei {studio}.",
    en: "thank you for your order with {studio}.",
    it: "grazie per il tuo ordine presso {studio}.",
    fi: "kiitos tilauksestasi studiolle {studio}.",
  },
  orderNumber: {
    de: "Bestellnummer",
    en: "Order number",
    it: "Numero d'ordine",
    fi: "Tilausnumero",
  },
  items: { de: "Artikel", en: "Items", it: "Articoli", fi: "Tuotteet" },
  subtotal: { de: "Zwischensumme", en: "Subtotal", it: "Subtotale", fi: "Välisumma" },
  shipping: { de: "Versand", en: "Shipping", it: "Spedizione", fi: "Toimitus" },
  tax: { de: "MwSt", en: "VAT", it: "IVA", fi: "ALV" },
  total: { de: "Gesamtsumme", en: "Total", it: "Totale", fi: "Yhteensä" },
  deliveryAddress: {
    de: "Lieferadresse",
    en: "Delivery address",
    it: "Indirizzo di consegna",
    fi: "Toimitusosoite",
  },
  offlineInvoice: {
    de: "Du bekommst von {studio} in Kürze eine Rechnung. Sobald die Zahlung eingeht, wird deine Bestellung produziert und verschickt.",
    en: "{studio} will send you an invoice shortly. Once payment arrives, your order goes into production and ships.",
    it: "Riceverai a breve una fattura da {studio}. Non appena arriva il pagamento, il tuo ordine va in produzione e viene spedito.",
    fi: "{studio} lähettää sinulle laskun pian. Kun maksu on saapunut, tilauksesi menee tuotantoon ja lähetetään.",
  },
  inProduction: {
    de: "Wir bereiten deine Bestellung jetzt zur Produktion vor. Du bekommst eine weitere Mail sobald sie versendet wird.",
    en: "We are preparing your order for production now. You will get another email once it ships.",
    it: "Stiamo preparando il tuo ordine per la produzione. Riceverai un'altra email non appena verrà spedito.",
    fi: "Valmistelemme tilaustasi tuotantoon. Saat uuden viestin heti kun se on lähetetty.",
  },
  questions: {
    de: "Bei Fragen: {contact}",
    en: "Questions? {contact}",
    it: "Domande? {contact}",
    fi: "Kysyttävää? {contact}",
  },
  questionsLabel: {
    de: "Bei Fragen:",
    en: "Questions?",
    it: "Domande?",
    fi: "Kysyttävää?",
  },
  shippedSubject: {
    de: "Deine Bestellung {order} ist auf dem Weg",
    en: "Your order {order} is on its way",
    it: "Il tuo ordine {order} è in arrivo",
    fi: "Tilauksesi {order} on matkalla",
  },
  shippedBody: {
    de: "deine Bestellung {order} ist auf dem Weg zu dir.",
    en: "your order {order} is on its way to you.",
    it: "il tuo ordine {order} è in arrivo.",
    fi: "tilauksesi {order} on matkalla sinulle.",
  },
  tracking: {
    de: "Sendungsverfolgung:",
    en: "Tracking:",
    it: "Tracciamento:",
    fi: "Seuranta:",
  },
  trackPackage: {
    de: "Paket verfolgen",
    en: "Track package",
    it: "Traccia il pacco",
    fi: "Seuraa pakettia",
  },
  noTracking: {
    de: "Wir haben leider noch keine Tracking-Nummer, deine Bestellung wurde aber verschickt.",
    en: "We do not have a tracking number yet, but your order has shipped.",
    it: "Non abbiamo ancora un numero di tracciamento, ma il tuo ordine è stato spedito.",
    fi: "Meillä ei ole vielä seurantanumeroa, mutta tilauksesi on lähetetty.",
  },
  readyForPickupSubject: {
    de: "Deine Bestellung {order} ist abholbereit",
    en: "Your order {order} is ready for pickup",
    it: "Il tuo ordine {order} è pronto per il ritiro",
    fi: "Tilauksesi {order} on noudettavissa",
  },
  readyForPickupBody: {
    de: "deine Bestellung {order} ist fertig und kann jetzt bei {studio} abgeholt werden.",
    en: "your order {order} is ready and can now be picked up at {studio}.",
    it: "il tuo ordine {order} è pronto e può essere ritirato presso {studio}.",
    fi: "tilauksesi {order} on valmis ja se voidaan nyt noutaa studiolta {studio}.",
  },
  regards: { de: "Viele Grüße,", en: "Kind regards,", it: "Cordiali saluti,", fi: "Ystävällisin terveisin," },
} satisfies Record<string, Phrase>;

/** Empfaenger: das Studio -> persoenliche Sprache des Owners. */
const printStudioPhrases = {
  subject: {
    de: "Neue Print-Bestellung: {order}",
    en: "New print order: {order}",
    it: "Nuovo ordine di stampa: {order}",
    fi: "Uusi print-tilaus: {order}",
  },
  intro: {
    de: "Neue Bestellung im Print-Shop:",
    en: "New order in the print shop:",
    it: "Nuovo ordine nel print shop:",
    fi: "Uusi tilaus print shopissa:",
  },
  orderNumber: {
    de: "Bestellnummer",
    en: "Order number",
    it: "Numero d'ordine",
    fi: "Tilausnumero",
  },
  customer: { de: "Kunde", en: "Customer", it: "Cliente", fi: "Asiakas" },
  paymentMode: { de: "Bezahlmodus", en: "Payment", it: "Pagamento", fi: "Maksutapa" },
  payOnline: {
    de: "Online (Stripe)",
    en: "Online (Stripe)",
    it: "Online (Stripe)",
    fi: "Verkkomaksu (Stripe)",
  },
  payOffline: {
    de: "Offline-Rechnung",
    en: "Offline invoice",
    it: "Fattura offline",
    fi: "Lasku jälkikäteen",
  },
  total: { de: "Gesamtsumme", en: "Total", it: "Totale", fi: "Yhteensä" },
  items: { de: "Artikel", en: "Items", it: "Articoli", fi: "Tuotteet" },
  deliveryAddress: {
    de: "Lieferadresse",
    en: "Delivery address",
    it: "Indirizzo di consegna",
    fi: "Toimitusosoite",
  },
  customerNote: {
    de: "Hinweis vom Kunden:",
    en: "Note from the customer:",
    it: "Nota del cliente:",
    fi: "Asiakkaan viesti:",
  },
  openOrder: {
    de: "Zur Bestellung im Studio:",
    en: "Open the order in the studio:",
    it: "Apri l'ordine nello studio:",
    fi: "Avaa tilaus studiossa:",
  },
  openOrderButton: {
    de: "Bestellung öffnen",
    en: "Open order",
    it: "Apri l'ordine",
    fi: "Avoin tilaus",
  },
} satisfies Record<string, Phrase>;

export function tmplPrintOrderConfirmGuest(opts: {
  studioName: string;
  /** Studio-Branding; ohne Angabe greift das Lumio-Branding. */
  branding?: MailBranding;
  supportEmail: string;
  order: OrderLike;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const { studioName, supportEmail, order, branding } = opts;
  const l = opts.locale ?? instanceMailLocale();
  const P = printGuestPhrases;
  const vars = {
    order: order.orderNumber,
    studio: studioName,
    name: order.guestName,
  };
  const subject = phrase(P.confirmSubject, l, vars);

  const text =
    `${phrase(P.greeting, l, vars)}

${phrase(P.thanks, l, vars)}

${phrase(P.orderNumber, l)}: ${order.orderNumber}

${phrase(P.items, l)}:
${itemsTextBlock(order.items, order.currency, l)}

${phrase(P.subtotal, l)}: ${formatPrice(order.subtotalCents, order.currency, l)}
${phrase(P.shipping, l)}${order.shippingMethod ? ` (${order.shippingMethod.name})` : ""}: ${formatPrice(order.shippingCents, order.currency, l)}
${phrase(P.tax, l)}: ${formatPrice(order.taxCents, order.currency, l)}
${phrase(P.total, l)}: ${formatPrice(order.totalCents, order.currency, l)}

${phrase(P.deliveryAddress, l)}:
${formatAddress(order.shippingAddress)}

${
  order.paymentMode === "offline_invoice"
    ? phrase(P.offlineInvoice, l, vars)
    : phrase(P.inProduction, l)
}

${printSupport(supportEmail) ? phrase(P.questions, l, { contact: printSupport(supportEmail)! }) : ""}

${phrase(P.regards, l)}
${studioName}`;

  const html = renderMailLayout({
    locale: l,
    branding,
    bodyHtml: `
  <p>${escapeHtml(phrase(P.greeting, l, vars))}</p>
  <p>${escapeHtml(phrase(P.thanks, l, { studio: studioName }))}</p>
  <p style="background:#f5f5f5;padding:10px 14px;border-radius:4px;display:inline-block;">
    ${escapeHtml(phrase(P.orderNumber, l))}: <strong style="font-family:monospace;">${order.orderNumber}</strong>
  </p>
  <h3 style="margin-top:24px;">${escapeHtml(phrase(P.items, l))}</h3>
  <table style="width:100%;border-collapse:collapse;">
    ${itemsHtmlBlock(order.items, order.currency, l)}
    <tr><td style="padding:6px 12px;color:#888;">${escapeHtml(phrase(P.subtotal, l))}</td><td style="padding:6px 12px;text-align:right;font-variant-numeric:tabular-nums;">${formatPrice(order.subtotalCents, order.currency, l)}</td></tr>
    <tr><td style="padding:6px 12px;color:#888;">${escapeHtml(phrase(P.shipping, l))}${order.shippingMethod ? " (" + escapeHtml(order.shippingMethod.name) + ")" : ""}</td><td style="padding:6px 12px;text-align:right;font-variant-numeric:tabular-nums;">${formatPrice(order.shippingCents, order.currency, l)}</td></tr>
    <tr><td style="padding:6px 12px;color:#888;">${escapeHtml(phrase(P.tax, l))}</td><td style="padding:6px 12px;text-align:right;font-variant-numeric:tabular-nums;">${formatPrice(order.taxCents, order.currency, l)}</td></tr>
    <tr><td style="padding:10px 12px;font-weight:600;border-top:2px solid #222;">${escapeHtml(phrase(P.total, l))}</td><td style="padding:10px 12px;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;border-top:2px solid #222;">${formatPrice(order.totalCents, order.currency, l)}</td></tr>
  </table>
  <h3 style="margin-top:24px;">${escapeHtml(phrase(P.deliveryAddress, l))}</h3>
  <pre style="font-family:inherit;white-space:pre-wrap;margin:0;color:#444;">${escapeHtml(formatAddress(order.shippingAddress))}</pre>
  <p style="margin-top:24px;color:#444;">
    ${
      order.paymentMode === "offline_invoice"
        ? escapeHtml(phrase(P.offlineInvoice, l, { studio: studioName }))
        : escapeHtml(phrase(P.inProduction, l))
    }
  </p>
  <p style="color:#888;font-size:13px;margin-top:24px;">
    ${printSupport(supportEmail) ? `${escapeHtml(phrase(P.questionsLabel, l))} <a href="mailto:${escapeHtml(printSupport(supportEmail)!)}">${escapeHtml(printSupport(supportEmail)!)}</a>` : ""}
  </p>
`,
  });

  return { subject, text, html };
}

// =============================================================================
// 2) Studio — neue Bestellung eingegangen
// =============================================================================
export function tmplPrintOrderNotifyStudio(opts: {
  studioName: string;
  /** Studio-Branding; ohne Angabe greift das Lumio-Branding. */
  branding?: MailBranding;
  order: OrderLike;
  baseUrl: string;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const { order, baseUrl, branding } = opts;
  const l = opts.locale ?? instanceMailLocale();
  const S = printStudioPhrases;
  const orderUrl = `${baseUrl.replace(/\/+$/, "")}/studio/print-shop/orders/${order.id}`;
  const subject = phrase(S.subject, l, { order: order.orderNumber });
  const payLabel =
    order.paymentMode === "stripe_connect"
      ? phrase(S.payOnline, l)
      : phrase(S.payOffline, l);

  const text =
    `${phrase(S.intro, l)}

${phrase(S.orderNumber, l)}: ${order.orderNumber}
${phrase(S.customer, l)}: ${order.guestName} <${order.guestEmail}>
${phrase(S.paymentMode, l)}: ${payLabel}
${phrase(S.total, l)}: ${formatPrice(order.totalCents, order.currency, l)}

${phrase(S.items, l)}:
${itemsTextBlock(order.items, order.currency, l)}

${phrase(S.deliveryAddress, l)}:
${formatAddress(order.shippingAddress)}

${order.guestNote ? `${phrase(S.customerNote, l)}\n${order.guestNote}\n` : ""}
${phrase(S.openOrder, l)}
${orderUrl}`;

  const html = renderMailLayout({
    locale: l,
    branding,
    bodyHtml: `
  <p>${escapeHtml(phrase(S.intro, l))}</p>
  <table style="border-collapse:collapse;">
    <tr><td style="padding:4px 12px 4px 0;color:#888;">${escapeHtml(phrase(S.orderNumber, l))}:</td><td style="padding:4px 0;"><strong style="font-family:monospace;">${order.orderNumber}</strong></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#888;">${escapeHtml(phrase(S.customer, l))}:</td><td style="padding:4px 0;">${escapeHtml(order.guestName)} &lt;${escapeHtml(order.guestEmail)}&gt;</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#888;">${escapeHtml(phrase(S.paymentMode, l))}:</td><td style="padding:4px 0;">${escapeHtml(payLabel)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#888;">${escapeHtml(phrase(S.total, l))}:</td><td style="padding:4px 0;font-weight:600;">${formatPrice(order.totalCents, order.currency, l)}</td></tr>
  </table>
  <h3>${escapeHtml(phrase(S.items, l))}</h3>
  <table style="width:100%;border-collapse:collapse;">
    ${itemsHtmlBlock(order.items, order.currency, l)}
  </table>
  <h3 style="margin-top:20px;">${escapeHtml(phrase(S.deliveryAddress, l))}</h3>
  <pre style="font-family:inherit;white-space:pre-wrap;margin:0;color:#444;">${escapeHtml(formatAddress(order.shippingAddress))}</pre>
  ${order.guestNote ? `<h3 style="margin-top:20px;">${escapeHtml(phrase(S.customerNote, l))}</h3><blockquote style="border-left:3px solid #ddd;padding-left:12px;margin:0;color:#444;">${escapeHtml(order.guestNote)}</blockquote>` : ""}
  <p style="margin-top:24px;">
    ${mailButton(orderUrl, phrase(S.openOrderButton, l), branding?.accentColor)}
  </p>
`,
  });

  return { subject, text, html };
}

// =============================================================================
// 3) Endkunde — Versand-Notifikation
// =============================================================================
export function tmplPrintOrderShippedGuest(opts: {
  studioName: string;
  /** Studio-Branding; ohne Angabe greift das Lumio-Branding. */
  branding?: MailBranding;
  supportEmail: string;
  order: OrderLike;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const { studioName, supportEmail, order, branding } = opts;
  const l = opts.locale ?? instanceMailLocale();
  const P = printGuestPhrases;
  const vars = {
    order: order.orderNumber,
    studio: studioName,
    name: order.guestName,
  };
  const subject = phrase(P.shippedSubject, l, vars);

  const trackingLine = order.trackingNumber
    ? `${phrase(P.tracking, l)} ${order.trackingNumber}` +
      (order.trackingCarrier ? ` (${order.trackingCarrier})` : "") +
      (order.trackingUrl ? `\n${order.trackingUrl}` : "")
    : phrase(P.noTracking, l);

  const text =
    `${phrase(P.greeting, l, vars)}

${phrase(P.shippedBody, l, vars)}

${trackingLine}

${phrase(P.deliveryAddress, l)}:
${formatAddress(order.shippingAddress)}

${phrase(P.regards, l)}
${studioName}

${printSupport(supportEmail) ? phrase(P.questions, l, { contact: printSupport(supportEmail)! }) : ""}`;

  const html = renderMailLayout({
    locale: l,
    branding,
    bodyHtml: `
  <p>${escapeHtml(phrase(P.greeting, l, vars))}</p>
  <p>${escapeHtml(phrase(P.shippedBody, l, { order: "" })).replace("{order}", "")}<strong style="font-family:monospace;">${order.orderNumber}</strong></p>
  ${
    order.trackingNumber
      ? `<p style="background:#f5f5f5;padding:10px 14px;border-radius:4px;">
           <strong>${escapeHtml(phrase(P.tracking, l))}</strong> ${escapeHtml(order.trackingNumber)}
           ${order.trackingCarrier ? ` (${escapeHtml(order.trackingCarrier)})` : ""}
           ${order.trackingUrl ? `<br><a href="${escapeHtml(order.trackingUrl)}">${escapeHtml(phrase(P.trackPackage, l))}</a>` : ""}
         </p>`
      : `<p style="color:#666;">${escapeHtml(phrase(P.noTracking, l))}</p>`
  }
  <h3>${escapeHtml(phrase(P.deliveryAddress, l))}</h3>
  <pre style="font-family:inherit;white-space:pre-wrap;margin:0;color:#444;">${escapeHtml(formatAddress(order.shippingAddress))}</pre>
  <p style="margin-top:24px;color:#444;">${escapeHtml(phrase(P.regards, l))}<br>${escapeHtml(studioName)}</p>
  <p style="color:#888;font-size:13px;margin-top:24px;">
    ${printSupport(supportEmail) ? `${escapeHtml(phrase(P.questionsLabel, l))} <a href="mailto:${escapeHtml(printSupport(supportEmail)!)}">${escapeHtml(printSupport(supportEmail)!)}</a>` : ""}
  </p>
`,
  });

  return { subject, text, html };
}

/** Sibling of tmplPrintOrderShippedGuest() for the pickup fulfillment
 *  path — no tracking/address block (there's no courier or address on
 *  a pickup order), just "it's ready, come get it". */
export function tmplPrintOrderReadyForPickupGuest(opts: {
  studioName: string;
  branding?: MailBranding;
  supportEmail: string;
  order: OrderLike;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const { studioName, supportEmail, order, branding } = opts;
  const l = opts.locale ?? instanceMailLocale();
  const P = printGuestPhrases;
  const vars = {
    order: order.orderNumber,
    studio: studioName,
    name: order.guestName,
  };
  const subject = phrase(P.readyForPickupSubject, l, vars);

  const text =
    `${phrase(P.greeting, l, vars)}

${phrase(P.readyForPickupBody, l, vars)}

${phrase(P.regards, l)}
${studioName}

${printSupport(supportEmail) ? phrase(P.questions, l, { contact: printSupport(supportEmail)! }) : ""}`;

  const html = renderMailLayout({
    locale: l,
    branding,
    bodyHtml: `
  <p>${escapeHtml(phrase(P.greeting, l, vars))}</p>
  <p>${escapeHtml(phrase(P.readyForPickupBody, l, vars))}</p>
  <p style="margin-top:24px;color:#444;">${escapeHtml(phrase(P.regards, l))}<br>${escapeHtml(studioName)}</p>
  <p style="color:#888;font-size:13px;margin-top:24px;">
    ${printSupport(supportEmail) ? `${escapeHtml(phrase(P.questionsLabel, l))} <a href="mailto:${escapeHtml(printSupport(supportEmail)!)}">${escapeHtml(printSupport(supportEmail)!)}</a>` : ""}
  </p>
`,
  });

  return { subject, text, html };
}
