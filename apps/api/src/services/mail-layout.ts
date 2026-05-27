/**
 * Lumio API — Mail HTML Layout & Components
 *
 * Klartext-Mails sind schoen technisch sauber, aber fuer Endkunden-
 * Beruehrungspunkte (Galerie-Einladungen, Welcome) wirkt eine schicke
 * HTML-Mail viel professioneller.
 *
 * Design-Entscheidungen:
 *
 *  - **Tables statt Flexbox/Grid:** Mail-HTML ist nicht Web-HTML.
 *    Outlook (insb. Outlook Desktop) ignoriert moderne CSS-Layouts
 *    weitgehend. Tables sind der einzige garantiert kompatible Weg.
 *
 *  - **Inline-Styles:** <style>-Bloecke werden von einigen Clients
 *    ignoriert (Gmail web ja, Outlook teils nicht). Alle Styles inline.
 *
 *  - **Max-Width 600px:** Industry-Standard fuer Mail-Inhalte. Daniert
 *    sich auch in Lighting-Wide-Clients (Outlook im Vollscreen) auf
 *    600px und ist auf Mobile responsive.
 *
 *  - **Web-Safe Font-Stack:** Inter/Helvetica fallback. Custom Fonts
 *    in Mails sind oberflaechlich riskant — manche Clients laden sie
 *    nicht, andere verstuemmeln den Stack.
 *
 *  - **Zwei Branding-Modi:**
 *      - Lumio-Brand (default): fuer System-Mails an den Fotograf
 *        (Welcome, Password-Reset, etc.)
 *      - Studio-Brand (optional): fuer Galerie-Einladungen an
 *        Endkunden. Logo + Akzentfarbe vom Studio.
 *
 * Pragmatischer Verzicht:
 *  - Keine Dark-Mode-Logik. Mailclients mit Dark-Mode invertieren
 *    selbst — wenn wir mit Light-Theme rausgehen, sehen die Dark-
 *    Empfaenger eine softe automatische Invertierung.
 *  - Keine externe Bilder ausser dem Studio-Logo. Tracking-Pixel
 *    sind unethisch, Backgrounds sind in Outlook unzuverlaessig.
 */

const LUMIO_BRAND_COLOR = "#d97706"; // amber-600, vom Hero
const LUMIO_TEXT_COLOR = "#1f2937"; // gray-800
const LUMIO_MUTED_COLOR = "#6b7280"; // gray-500
const LUMIO_BORDER_COLOR = "#e5e7eb"; // gray-200
const LUMIO_BG_COLOR = "#f6f7f9";

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

export interface MailBranding {
  /** Wenn null, nutzen wir das Lumio-Branding (Wortmarke) als Header. */
  logoUrl?: string | null;
  /** Akzentfarbe fuer CTAs und Akzente. Wenn null, Lumio-Amber. */
  accentColor?: string | null;
  /** Display-Name oder Studio-Name fuer den Header. Default: "Lumio". */
  brandName?: string | null;
  /** Footer-Hinweis am Ende, z.B. "Diese Mail kam von Lumio im Auftrag
   *  von {studioName}". Optional. */
  footerNote?: string | null;
}

export interface RenderMailOpts {
  /** Inhalt des Mail-Body als HTML-Fragmente (z.B. aus mailParagraph()) */
  bodyHtml: string;
  /** Optional: Branding fuer Galerie-Einladungen. Default = Lumio-Branding. */
  branding?: MailBranding;
  /** Optional: Praeheader-Text — wird in Inbox-Preview unter dem Subject
   *  angezeigt. Wirkt subtil aber sehr stark auf Open-Rates. */
  preheader?: string;
}

/**
 * Generiert das komplette HTML-Dokument fuer eine Mail. Empfangt
 * inneres HTML-Fragment + Branding und wraps es in den Standard-
 * Layout.
 */
export function renderMailLayout(opts: RenderMailOpts): string {
  const accent = opts.branding?.accentColor || LUMIO_BRAND_COLOR;
  const brandName = opts.branding?.brandName || "Lumio";
  const logoUrl = opts.branding?.logoUrl;
  const footerNote = opts.branding?.footerNote;
  const preheader = opts.preheader ?? "";

  // Header: entweder Studio-Logo oder Wortmarke "Lumio"
  const headerInner = logoUrl
    ? `<img src="${escapeAttr(logoUrl)}" alt="${escapeAttr(brandName)}" style="max-height:48px;max-width:200px;display:block;border:0;" />`
    : `<div style="font-size:22px;font-weight:600;color:${accent};letter-spacing:-0.02em;">Lumio</div>`;

  const footerHtml = footerNote
    ? `<p style="margin:0 0 8px;color:${LUMIO_MUTED_COLOR};font-size:12px;line-height:1.5;">${escapeHtml(footerNote)}</p>`
    : "";

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(brandName)}</title>
</head>
<body style="margin:0;padding:0;background-color:${LUMIO_BG_COLOR};font-family:${FONT_STACK};color:${LUMIO_TEXT_COLOR};">
<!-- Praeheader (versteckt im Body, sichtbar in der Inbox-Preview) -->
<div style="display:none;font-size:1px;color:${LUMIO_BG_COLOR};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
${escapeHtml(preheader)}
</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${LUMIO_BG_COLOR};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background-color:#ffffff;border:1px solid ${LUMIO_BORDER_COLOR};border-radius:12px;overflow:hidden;">
        <!-- Header -->
        <tr>
          <td style="padding:24px 32px;border-bottom:1px solid ${LUMIO_BORDER_COLOR};">
            ${headerInner}
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;font-size:15px;line-height:1.6;color:${LUMIO_TEXT_COLOR};">
            ${opts.bodyHtml}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px;background-color:#fafafa;border-top:1px solid ${LUMIO_BORDER_COLOR};">
            ${footerHtml}
            <p style="margin:0;color:${LUMIO_MUTED_COLOR};font-size:12px;line-height:1.5;">
              Verschickt von <a href="https://lumio-cloud.de" style="color:${LUMIO_MUTED_COLOR};text-decoration:underline;">Lumio</a> — Foto-Galerien für Profis, gehostet in Deutschland.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// HTML-Bausteine fuer Template-Bodies
// ---------------------------------------------------------------------------

/** Standard-Absatz. */
export function mailParagraph(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${LUMIO_TEXT_COLOR};">${escapeHtml(text)}</p>`;
}

/** Absatz mit Inline-Variablen — Platzhalter ${name} in text durch
 *  values ersetzen. Werte werden HTML-escaped, der umgebende Text
 *  auch. */
export function mailParagraphInterpolated(
  template: string,
  values: Record<string, string>
): string {
  let html = escapeHtml(template);
  for (const [key, val] of Object.entries(values)) {
    html = html.replaceAll(`\${${key}}`, `<strong>${escapeHtml(val)}</strong>`);
  }
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${LUMIO_TEXT_COLOR};">${html}</p>`;
}

/** Sub-Heading innerhalb des Bodys. */
export function mailHeading(text: string): string {
  return `<h2 style="margin:0 0 12px;font-size:18px;font-weight:600;color:${LUMIO_TEXT_COLOR};letter-spacing:-0.01em;">${escapeHtml(text)}</h2>`;
}

/** CTA-Button. Akzentfarbe optional — default Lumio-Amber. */
export function mailButton(
  href: string,
  label: string,
  accentColor?: string | null
): string {
  const color = accentColor || LUMIO_BRAND_COLOR;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
  <tr>
    <td align="center" style="background-color:${color};border-radius:8px;">
      <a href="${escapeAttr(href)}" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;font-family:${FONT_STACK};">${escapeHtml(label)}</a>
    </td>
  </tr>
</table>`;
}

/** Aufzaehlung. */
export function mailBullets(items: string[]): string {
  const lis = items
    .map(
      (i) =>
        `<li style="margin:0 0 8px;color:${LUMIO_TEXT_COLOR};">${escapeHtml(i)}</li>`
    )
    .join("");
  return `<ul style="margin:0 0 16px;padding-left:20px;font-size:15px;line-height:1.6;">${lis}</ul>`;
}

/** Trennlinie. */
export function mailDivider(): string {
  return `<hr style="border:none;border-top:1px solid ${LUMIO_BORDER_COLOR};margin:24px 0;" />`;
}

/** Klein-Box mit grauem Hintergrund — fuer "Du musst nichts weiter
 *  tun"-Hinweise oder Sicherheits-Footer. */
export function mailNoticeBox(text: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;">
  <tr>
    <td style="padding:16px;background-color:#fafafa;border:1px solid ${LUMIO_BORDER_COLOR};border-radius:8px;font-size:14px;line-height:1.6;color:${LUMIO_MUTED_COLOR};">
      ${escapeHtml(text)}
    </td>
  </tr>
</table>`;
}

/** Persoenliche Nachricht (z.B. vom Studio an den Endkunden) hervorheben.
 *  Akzent-Border links, italic. */
export function mailQuoteBlock(text: string, accentColor?: string | null): string {
  const color = accentColor || LUMIO_BRAND_COLOR;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;">
  <tr>
    <td style="padding:0 0 0 16px;border-left:3px solid ${color};font-size:15px;line-height:1.6;color:${LUMIO_TEXT_COLOR};font-style:italic;">
      ${escapeHtml(text).replace(/\n/g, "<br>")}
    </td>
  </tr>
</table>`;
}

// ---------------------------------------------------------------------------
// HTML/Attribut-Escaping. Minimale, klare Implementation.
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  // gleiche Sanitation wie HTML-content — Attribute-Werte sind in
  // Quotes, also Quotes escapen reicht plus die Standard-Suspekten.
  return escapeHtml(s);
}
