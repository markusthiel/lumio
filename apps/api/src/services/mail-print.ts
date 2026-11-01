/**
 * Lumio API — Print-Shop Mail-Templates
 *
 * Bestellung eingegangen (Endkunde + Studio), Zahlung erhalten (Endkunde),
 * Versand-/Abhol-Notifikation (Endkunde).
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
  /** Optional: only the studio notification looks at these. */
  invoiceRequested?: boolean;
  invoiceVatNumber?: string | null;
  invoiceTaxCode?: string | null;
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
// 1) Endkunde — Bestellung eingegangen (bei Anlage, vor der Zahlung)
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
  fr: "Votre commande {order} avec {studio}" },
  greeting: {
    de: "Hallo {name},",
    en: "Hello {name},",
    it: "Ciao {name},",
    fi: "Hei {name},",
  fr: "Bonjour {name}," },
  thanks: {
    de: "vielen Dank für deine Bestellung bei {studio}.",
    en: "thank you for your order with {studio}.",
    it: "grazie per il tuo ordine presso {studio}.",
    fi: "kiitos tilauksestasi studiolle {studio}.",
  fr: "merci pour votre commande avec {studio}." },
  orderNumber: {
    de: "Bestellnummer",
    en: "Order number",
    it: "Numero d'ordine",
    fi: "Tilausnumero",
  fr: "Numéro de commande" },
  items: { de: "Artikel", en: "Items", it: "Articoli", fi: "Tuotteet" , fr: "Articles" },
  subtotal: { de: "Zwischensumme", en: "Subtotal", it: "Subtotale", fi: "Välisumma" , fr: "Total" },
  shipping: { de: "Versand", en: "Shipping", it: "Spedizione", fi: "Toimitus" , fr: "Expédition" },
  tax: { de: "MwSt", en: "VAT", it: "IVA", fi: "ALV" , fr: "T.V.A." },
  total: { de: "Gesamtsumme", en: "Total", it: "Totale", fi: "Yhteensä" , fr: "Total" },
  deliveryAddress: {
    de: "Lieferadresse",
    en: "Delivery address",
    it: "Indirizzo di consegna",
    fi: "Toimitusosoite",
  fr: "Adresse de livraison" },
  offlineInvoice: {
    de: "Du bekommst von {studio} in Kürze eine Rechnung. Sobald die Zahlung eingeht, wird deine Bestellung produziert und verschickt.",
    en: "{studio} will send you an invoice shortly. Once payment arrives, your order goes into production and ships.",
    it: "Riceverai a breve una fattura da {studio}. Non appena arriva il pagamento, il tuo ordine va in produzione e viene spedito.",
    fi: "{studio} lähettää sinulle laskun pian. Kun maksu on saapunut, tilauksesi menee tuotantoon ja lähetetään.",
  fr: "{studio} vous enverra une facture sous peu. Une fois le paiement arrivé, votre commande entre en production et est expédiée." },
  inProduction: {
    de: "Wir bereiten deine Bestellung jetzt zur Produktion vor. Du bekommst eine weitere Mail sobald sie versendet wird.",
    en: "We are preparing your order for production now. You will get another email once it ships.",
    it: "Stiamo preparando il tuo ordine per la produzione. Riceverai un'altra email non appena verrà spedito.",
    fi: "Valmistelemme tilaustasi tuotantoon. Saat uuden viestin heti kun se on lähetetty.",
  fr: "Nous préparons votre commande pour la production maintenant. Vous recevrez un autre e-mail une fois expédié." },
  awaitingOnlinePayment: {
    de: "Sobald deine Zahlung bei {studio} eingegangen ist, bekommst du eine Bestätigung und deine Bestellung geht in die Produktion.",
    en: "Once your payment has reached {studio}, you will get a confirmation and your order goes into production.",
    it: "Non appena il tuo pagamento è arrivato a {studio}, riceverai una conferma e il tuo ordine andrà in produzione.",
    fi: "Kun maksusi on saapunut studiolle {studio}, saat vahvistuksen ja tilauksesi menee tuotantoon.",
  fr: "Une fois votre paiement atteint {studio}, vous recevrez une confirmation et votre commande passera en production." },
  paidSubject: {
    de: "Zahlung für deine Bestellung {order} erhalten",
    en: "Payment received for your order {order}",
    it: "Pagamento ricevuto per il tuo ordine {order}",
    fi: "Maksu vastaanotettu tilaukselle {order}",
  fr: "Paiement reçu pour votre commande {order}" },
  paidBody: {
    de: "wir haben deine Zahlung für die Bestellung {order} erhalten. Vielen Dank!",
    en: "we have received your payment for order {order}. Thank you!",
    it: "abbiamo ricevuto il tuo pagamento per l'ordine {order}. Grazie!",
    fi: "olemme vastaanottaneet maksusi tilaukselle {order}. Kiitos!",
  fr: "nous avons reçu votre paiement pour la commande {order}. Merci!" },
  questions: {
    de: "Bei Fragen: {contact}",
    en: "Questions? {contact}",
    it: "Domande? {contact}",
    fi: "Kysyttävää? {contact}",
  fr: "Des questions ? {contact}" },
  questionsLabel: {
    de: "Bei Fragen:",
    en: "Questions?",
    it: "Domande?",
    fi: "Kysyttävää?",
  fr: "Des questions ?" },
  shippedSubject: {
    de: "Deine Bestellung {order} ist auf dem Weg",
    en: "Your order {order} is on its way",
    it: "Il tuo ordine {order} è in arrivo",
    fi: "Tilauksesi {order} on matkalla",
  fr: "Votre commande {order} est en route" },
  shippedBody: {
    de: "deine Bestellung {order} ist auf dem Weg zu dir.",
    en: "your order {order} is on its way to you.",
    it: "il tuo ordine {order} è in arrivo.",
    fi: "tilauksesi {order} on matkalla sinulle.",
  fr: "votre commande {order} est en route vers vous." },
  tracking: {
    de: "Sendungsverfolgung:",
    en: "Tracking:",
    it: "Tracciamento:",
    fi: "Seuranta:",
  fr: "Suivi:" },
  trackPackage: {
    de: "Paket verfolgen",
    en: "Track package",
    it: "Traccia il pacco",
    fi: "Seuraa pakettia",
  fr: "Suivre le colis" },
  noTracking: {
    de: "Wir haben leider noch keine Tracking-Nummer, deine Bestellung wurde aber verschickt.",
    en: "We do not have a tracking number yet, but your order has shipped.",
    it: "Non abbiamo ancora un numero di tracciamento, ma il tuo ordine è stato spedito.",
    fi: "Meillä ei ole vielä seurantanumeroa, mutta tilauksesi on lähetetty.",
  fr: "Nous n'avons pas encore de numéro de suivi, mais votre commande a été expédiée." },
  readyForPickupSubject: {
    de: "Deine Bestellung {order} ist abholbereit",
    en: "Your order {order} is ready for pickup",
    it: "Il tuo ordine {order} è pronto per il ritiro",
    fi: "Tilauksesi {order} on noudettavissa",
  fr: "Votre commande {order} est prête à être récupérée" },
  readyForPickupBody: {
    de: "deine Bestellung {order} ist fertig und kann jetzt bei {studio} abgeholt werden.",
    en: "your order {order} is ready and can now be picked up at {studio}.",
    it: "il tuo ordine {order} è pronto e può essere ritirato presso {studio}.",
    fi: "tilauksesi {order} on valmis ja se voidaan nyt noutaa studiolta {studio}.",
  fr: "votre commande {order} est prête et peut maintenant être récupérée chez {studio}." },
  regards: { de: "Viele Grüße,", en: "Kind regards,", it: "Cordiali saluti,", fi: "Ystävällisin terveisin," , fr: "Cordialement," },
} satisfies Record<string, Phrase>;

/** Empfaenger: das Studio -> persoenliche Sprache des Owners. */
const printStudioPhrases = {
  subject: {
    de: "Neue Print-Bestellung: {order}",
    en: "New print order: {order}",
    it: "Nuovo ordine di stampa: {order}",
    fi: "Uusi print-tilaus: {order}",
  fr: "Nouvelle commande d'impression : {order}" },
  intro: {
    de: "Neue Bestellung im Print-Shop:",
    en: "New order in the print shop:",
    it: "Nuovo ordine nel print shop:",
    fi: "Uusi tilaus print shopissa:",
  fr: "Nouvelle commande à l'imprimerie :" },
  orderNumber: {
    de: "Bestellnummer",
    en: "Order number",
    it: "Numero d'ordine",
    fi: "Tilausnumero",
  fr: "Numéro de commande" },
  customer: { de: "Kunde", en: "Customer", it: "Cliente", fi: "Asiakas" , fr: "Client" },
  invoiceRequested: {
    de: "Rechnung gewünscht",
    en: "Invoice requested",
    it: "Fattura richiesta",
    fi: "Lasku pyydetty",
  fr: "Facture demandée" },
  paymentMode: { de: "Bezahlmodus", en: "Payment", it: "Pagamento", fi: "Maksutapa" , fr: "Paiement" },
  payOnline: {
    de: "Online (Stripe)",
    en: "Online (Stripe)",
    it: "Online (Stripe)",
    fi: "Verkkomaksu (Stripe)",
  fr: "En ligne (Stripe)" },
  payOffline: {
    de: "Offline-Rechnung",
    en: "Offline invoice",
    it: "Fattura offline",
    fi: "Lasku jälkikäteen",
  fr: "Facture hors ligne" },
  paymentPaid: {
    de: "bezahlt",
    en: "paid",
    it: "pagato",
    fi: "maksettu",
  fr: "payé" },
  paymentPending: {
    de: "Zahlung ausstehend",
    en: "payment pending",
    it: "pagamento in attesa",
    fi: "maksu odottaa",
  fr: "paiement en attente" },
  total: { de: "Gesamtsumme", en: "Total", it: "Totale", fi: "Yhteensä" , fr: "Total" },
  items: { de: "Artikel", en: "Items", it: "Articoli", fi: "Tuotteet" , fr: "Articles" },
  deliveryAddress: {
    de: "Lieferadresse",
    en: "Delivery address",
    it: "Indirizzo di consegna",
    fi: "Toimitusosoite",
  fr: "Adresse de livraison" },
  customerNote: {
    de: "Hinweis vom Kunden:",
    en: "Note from the customer:",
    it: "Nota del cliente:",
    fi: "Asiakkaan viesti:",
  fr: "Remarque du client :" },
  openOrder: {
    de: "Zur Bestellung im Studio:",
    en: "Open the order in the studio:",
    it: "Apri l'ordine nello studio:",
    fi: "Avaa tilaus studiossa:",
  fr: "Ouvrir la commande en studio :" },
  openOrderButton: {
    de: "Bestellung öffnen",
    en: "Open order",
    it: "Apri l'ordine",
    fi: "Avoin tilaus",
  fr: "Commande ouverte" },
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
    : phrase(P.awaitingOnlinePayment, l, vars)
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
        : escapeHtml(phrase(P.awaitingOnlinePayment, l, { studio: studioName }))
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
// 2) Studio — neue Bestellung eingegangen (bei Anlage)
// =============================================================================
export function tmplPrintOrderNotifyStudio(opts: {
  studioName: string;
  /** Studio-Branding; ohne Angabe greift das Lumio-Branding. */
  branding?: MailBranding;
  order: OrderLike;
  baseUrl: string;
  locale?: MailLocale;
  /** True when the mail goes out because the order has been paid (online
   *  orders); false when it goes out at creation, before any payment. */
  paid?: boolean;
}): { subject: string; text: string; html: string } {
  const { order, baseUrl, branding } = opts;
  const l = opts.locale ?? instanceMailLocale();
  const S = printStudioPhrases;
  const orderUrl = `${baseUrl.replace(/\/+$/, "")}/studio/print-shop/orders/${order.id}`;
  const subject = phrase(S.subject, l, { order: order.orderNumber });
  const payLabel = `${
    order.paymentMode === "stripe_connect"
      ? phrase(S.payOnline, l)
      : phrase(S.payOffline, l)
  } — ${phrase(opts.paid ? S.paymentPaid : S.paymentPending, l)}`;
  // Just the pointer that an invoice is due (with the first identifier that
  // is there, for a quick glance) — the full invoice details live in the
  // order in the studio. Which identifiers exist depends on what the studio
  // asked for.
  const invoiceValue =
    order.invoiceVatNumber || order.invoiceTaxCode || "✓";
  const invoiceLine = order.invoiceRequested
    ? `${phrase(S.invoiceRequested, l)}: ${invoiceValue}`
    : "";

  const text =
    `${phrase(S.intro, l)}

${phrase(S.orderNumber, l)}: ${order.orderNumber}
${phrase(S.customer, l)}: ${order.guestName} <${order.guestEmail}>
${invoiceLine ? `${invoiceLine}\n` : ""}${phrase(S.paymentMode, l)}: ${payLabel}
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
    <tr><td style="padding:4px 12px 4px 0;color:#888;">${escapeHtml(phrase(S.customer, l))}:</td><td style="padding:4px 0;">${escapeHtml(order.guestName)} &lt;${escapeHtml(order.guestEmail)}&gt;</td></tr>${
      invoiceLine
        ? `
    <tr><td style="padding:4px 12px 4px 0;color:#888;">${escapeHtml(phrase(S.invoiceRequested, l))}:</td><td style="padding:4px 0;">${escapeHtml(invoiceValue)}</td></tr>`
        : ""
    }
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
// 2b) Endkunde — Zahlung erhalten
// =============================================================================
export function tmplPrintOrderPaidGuest(opts: {
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
  const subject = phrase(P.paidSubject, l, vars);
  // Paid on delivery: the order is long past production by then.
  const producing = order.paymentMode !== "cash_on_delivery";

  const text =
    `${phrase(P.greeting, l, vars)}

${phrase(P.paidBody, l, vars)}

${phrase(P.total, l)}: ${formatPrice(order.totalCents, order.currency, l)}
${producing ? `\n${phrase(P.inProduction, l)}\n` : ""}
${phrase(P.regards, l)}
${studioName}

${printSupport(supportEmail) ? phrase(P.questions, l, { contact: printSupport(supportEmail)! }) : ""}`;

  const html = renderMailLayout({
    locale: l,
    branding,
    bodyHtml: `
  <p>${escapeHtml(phrase(P.greeting, l, vars))}</p>
  <p>${escapeHtml(phrase(P.paidBody, l, vars))}</p>
  <p style="background:#f5f5f5;padding:10px 14px;border-radius:4px;display:inline-block;">
    ${escapeHtml(phrase(P.orderNumber, l))}: <strong style="font-family:monospace;">${order.orderNumber}</strong><br>
    ${escapeHtml(phrase(P.total, l))}: <strong>${formatPrice(order.totalCents, order.currency, l)}</strong>
  </p>
  ${producing ? `<p style="margin-top:24px;color:#444;">${escapeHtml(phrase(P.inProduction, l))}</p>` : ""}
  <p style="margin-top:24px;color:#444;">${escapeHtml(phrase(P.regards, l))}<br>${escapeHtml(studioName)}</p>
  <p style="color:#888;font-size:13px;margin-top:24px;">
    ${printSupport(supportEmail) ? `${escapeHtml(phrase(P.questionsLabel, l))} <a href="mailto:${escapeHtml(printSupport(supportEmail)!)}">${escapeHtml(printSupport(supportEmail)!)}</a>` : ""}
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
