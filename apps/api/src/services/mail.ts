/**
 * Lumio API — Mail Service
 *
 * SMTP-Versand via nodemailer. Wenn SMTP nicht konfiguriert ist
 * (z.B. lokales Dev oder Self-Hoster ohne Mail), läuft der Service im
 * No-Op-Modus und loggt die Mails — bricht aber nichts.
 *
 * Templates sind bewusst simpel: Text-Mails, keine HTML-Komplexität.
 * Wer schicker will, kann später ein React-Email-Setup darüberlegen.
 */
import nodemailer, { type Transporter } from "nodemailer";

import { config } from "../config.js";
import { logger } from "../logger.js";

let _transport: Transporter | null = null;
let _initAttempted = false;

function getTransport(): Transporter | null {
  if (_initAttempted) return _transport;
  _initAttempted = true;

  if (!config.SMTP_HOST) {
    logger.info("mail: SMTP_HOST not set, running in no-op mode");
    return null;
  }

  _transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth:
      config.SMTP_USER && config.SMTP_PASSWORD
        ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }
        : undefined,
  });
  return _transport;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Optional HTML-Version. Wenn gesetzt, wird die Mail multipart
   *  (alternative) versendet: Klartext als Fallback fuer Clients die
   *  HTML nicht koennen/wollen, HTML als bevorzugte Darstellung. */
  html?: string;
}

export async function sendMail(msg: MailMessage): Promise<void> {
  const transport = getTransport();
  if (!transport) {
    logger.info(
      { to: msg.to, subject: msg.subject },
      "mail (no-op, SMTP not configured)"
    );
    return;
  }
  try {
    await transport.sendMail({
      from: config.SMTP_FROM ?? "Lumio <noreply@lumio.local>",
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    logger.info({ to: msg.to, subject: msg.subject }, "mail sent");
  } catch (err) {
    logger.warn({ err, to: msg.to, subject: msg.subject }, "mail send failed");
    // Wir werfen NICHT — Mail-Fehler sollten Business-Operationen nicht killen
  }
}

// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Templates
//
// Jedes Template gibt zurueck: { subject, text, html }
//   - text: Klartext-Fallback (manche Mail-Clients ziehen den vor; Tools wie
//     mutt zeigen ohnehin nur text)
//   - html: Schicke HTML-Variante mit Layout-Wrapper aus mail-layout.ts
//
// Templates die an Endkund:innen gehen (tmplGalleryInvite) duerfen
// optional Studio-Branding (Logo + Akzentfarbe) bekommen — siehe
// notifier.ts wo das geladen wird. System-Mails an den Fotograf nutzen
// das default Lumio-Branding.
// -----------------------------------------------------------------------------
import {
  renderMailLayout,
  mailParagraph,
  mailParagraphInterpolated,
  mailHeading,
  mailButton,
  mailBullets,
  mailDivider,
  mailNoticeBox,
  mailQuoteBlock,
  type MailBranding,
} from "./mail-layout.js";

export function tmplNewComment(opts: {
  galleryTitle: string;
  galleryUrl: string;
  authorLabel: string;
  body: string;
}): { subject: string; text: string; html: string } {
  return {
    subject: `Neuer Kommentar in "${opts.galleryTitle}"`,
    text:
      `${opts.authorLabel} hat einen Kommentar hinterlassen:\n\n` +
      `"${opts.body}"\n\n` +
      `Galerie ansehen: ${opts.galleryUrl}\n\n` +
      `— Lumio`,
    html: renderMailLayout({
      preheader: `${opts.authorLabel} hat in "${opts.galleryTitle}" kommentiert`,
      bodyHtml:
        mailHeading(`Neuer Kommentar in „${opts.galleryTitle}"`) +
        mailParagraph(`${opts.authorLabel} hat einen Kommentar hinterlassen:`) +
        mailQuoteBlock(opts.body) +
        mailButton(opts.galleryUrl, "Galerie öffnen"),
    }),
  };
}

export function tmplSelectionFinished(opts: {
  galleryTitle: string;
  galleryUrl: string;
  accessLabel: string;
  count: number;
}): { subject: string; text: string; html: string } {
  const fileWord = opts.count === 1 ? "Datei" : "Dateien";
  return {
    subject: `Auswahl fertig: "${opts.galleryTitle}"`,
    text:
      `${opts.accessLabel} hat die Auswahl abgeschlossen ` +
      `(${opts.count} ${fileWord}).\n\n` +
      `Galerie ansehen: ${opts.galleryUrl}\n\n` +
      `— Lumio`,
    html: renderMailLayout({
      preheader: `${opts.accessLabel} hat ${opts.count} ${fileWord} ausgewählt`,
      bodyHtml:
        mailHeading(`Auswahl abgeschlossen`) +
        mailParagraph(
          `${opts.accessLabel} hat die Auswahl in „${opts.galleryTitle}" abgeschlossen — ${opts.count} ${fileWord} markiert.`
        ) +
        mailButton(opts.galleryUrl, "Auswahl ansehen"),
    }),
  };
}

export function tmplZipReady(opts: {
  galleryTitle: string;
  downloadUrl: string;
  fileCount: number;
}): { subject: string; text: string; html: string } {
  const fileWord = opts.fileCount === 1 ? "Datei" : "Dateien";
  return {
    subject: `Download bereit: "${opts.galleryTitle}"`,
    text:
      `Dein ZIP-Download mit ${opts.fileCount} ${fileWord} ist fertig:\n\n` +
      `${opts.downloadUrl}\n\n` +
      `Der Link ist 7 Tage gültig.\n\n` +
      `— Lumio`,
    html: renderMailLayout({
      preheader: `Dein ZIP-Download (${opts.fileCount} ${fileWord}) ist fertig`,
      bodyHtml:
        mailHeading(`Download bereit`) +
        mailParagraph(
          `Dein ZIP-Download mit ${opts.fileCount} ${fileWord} aus „${opts.galleryTitle}" ist fertig.`
        ) +
        mailButton(opts.downloadUrl, "ZIP herunterladen") +
        mailNoticeBox("Der Link ist 7 Tage gültig."),
    }),
  };
}

export function tmplOwnerSetup(opts: {
  displayName: string;
  tenantName: string;
  setupUrl: string;
  invitedBy: string;
  validHours: number;
}): { subject: string; text: string; html: string } {
  return {
    subject: `Dein Lumio-Studio "${opts.tenantName}" ist bereit`,
    text:
      `Hallo ${opts.displayName},\n\n` +
      `${opts.invitedBy} hat ein Lumio-Studio für dich angelegt:\n` +
      `  ${opts.tenantName}\n\n` +
      `Klick auf den folgenden Link, um dein Passwort zu setzen und ` +
      `direkt loszulegen:\n\n` +
      `${opts.setupUrl}\n\n` +
      `Der Link ist ${opts.validHours} Stunden gültig. Falls die Frist ` +
      `abläuft, melde dich bei ${opts.invitedBy}.\n\n` +
      `— Lumio`,
    html: renderMailLayout({
      preheader: `Dein Studio „${opts.tenantName}" wartet auf dich`,
      bodyHtml:
        mailHeading(`Hallo ${opts.displayName},`) +
        mailParagraph(
          `${opts.invitedBy} hat ein Lumio-Studio für dich angelegt: „${opts.tenantName}". Setze jetzt dein Passwort und leg los.`
        ) +
        mailButton(opts.setupUrl, "Passwort setzen") +
        mailNoticeBox(
          `Der Link ist ${opts.validHours} Stunden gültig. Falls die Frist abläuft, melde dich bei ${opts.invitedBy}.`
        ),
    }),
  };
}

export function tmplPasswordReset(opts: {
  displayName: string;
  tenantName: string;
  resetUrl: string;
  validHours: number;
  ipAddress?: string;
}): { subject: string; text: string; html: string } {
  const ipLine = opts.ipAddress
    ? `Angefordert von IP-Adresse: ${opts.ipAddress}\n\n`
    : "";
  return {
    subject: `Passwort zurücksetzen für „${opts.tenantName}"`,
    text:
      `Hallo ${opts.displayName},\n\n` +
      `Du (oder jemand mit deiner E-Mail-Adresse) hat ein neues Passwort ` +
      `für dein Lumio-Studio „${opts.tenantName}" angefordert.\n\n` +
      `Klick auf den folgenden Link, um ein neues Passwort zu setzen:\n\n` +
      `${opts.resetUrl}\n\n` +
      `Der Link ist ${opts.validHours} Stunden gültig.\n\n` +
      ipLine +
      `Falls du das NICHT angefordert hast, kannst du diese Mail ignorieren — ` +
      `dein aktuelles Passwort bleibt gültig. Bei verdächtiger Aktivität ` +
      `melde dich bitte beim Studio-Owner.\n\n` +
      `— Lumio`,
    html: renderMailLayout({
      preheader: `Passwort-Reset für „${opts.tenantName}"`,
      bodyHtml:
        mailHeading(`Hallo ${opts.displayName},`) +
        mailParagraph(
          `Du (oder jemand mit deiner E-Mail-Adresse) hat ein neues Passwort für dein Lumio-Studio „${opts.tenantName}" angefordert.`
        ) +
        mailButton(opts.resetUrl, "Neues Passwort setzen") +
        mailNoticeBox(
          `Der Link ist ${opts.validHours} Stunden gültig.` +
            (opts.ipAddress
              ? ` Angefordert von IP-Adresse: ${opts.ipAddress}.`
              : "")
        ) +
        mailParagraph(
          `Falls du das NICHT angefordert hast, kannst du diese Mail ignorieren — dein aktuelles Passwort bleibt gültig.`
        ),
    }),
  };
}

export function tmplEmailChangeConfirm(opts: {
  displayName: string;
  tenantName: string;
  oldEmail: string;
  newEmail: string;
  confirmUrl: string;
  validHours: number;
}): { subject: string; text: string; html: string } {
  return {
    subject: `Bestätige deine neue E-Mail-Adresse für „${opts.tenantName}"`,
    text:
      `Hallo ${opts.displayName},\n\n` +
      `Du hast deine E-Mail-Adresse für dein Lumio-Studio ` +
      `„${opts.tenantName}" geändert:\n\n` +
      `  von: ${opts.oldEmail}\n` +
      `  zu:  ${opts.newEmail}\n\n` +
      `Klick auf den folgenden Link, um die Änderung zu bestätigen:\n\n` +
      `${opts.confirmUrl}\n\n` +
      `Der Link ist ${opts.validHours} Stunden gültig.\n\n` +
      `Bis du den Link klickst, bleibt deine alte E-Mail-Adresse aktiv. ` +
      `Falls du diesen Wechsel NICHT angefordert hast, ignoriere die Mail ` +
      `einfach.\n\n` +
      `— Lumio`,
    html: renderMailLayout({
      preheader: `Bestätige den Wechsel zu ${opts.newEmail}`,
      bodyHtml:
        mailHeading(`Hallo ${opts.displayName},`) +
        mailParagraph(
          `Du hast deine E-Mail-Adresse für dein Lumio-Studio „${opts.tenantName}" geändert:`
        ) +
        mailParagraphInterpolated(
          `Von: \${old}\nZu: \${new}`,
          { old: opts.oldEmail, new: opts.newEmail }
        ) +
        mailButton(opts.confirmUrl, "Wechsel bestätigen") +
        mailNoticeBox(
          `Der Link ist ${opts.validHours} Stunden gültig. Bis du klickst, bleibt deine alte E-Mail-Adresse aktiv.`
        ),
    }),
  };
}

export function tmplEmailChangeNotice(opts: {
  displayName: string;
  tenantName: string;
  newEmail: string;
}): { subject: string; text: string; html: string } {
  return {
    subject: `E-Mail-Wechsel für „${opts.tenantName}" angefordert`,
    text:
      `Hallo ${opts.displayName},\n\n` +
      `Es wurde ein Wechsel deiner E-Mail-Adresse für dein Lumio-Studio ` +
      `„${opts.tenantName}" angefordert. Die neue Adresse lautet:\n\n` +
      `  ${opts.newEmail}\n\n` +
      `An die neue Adresse haben wir einen Bestätigungslink geschickt. ` +
      `Erst nach Klick darauf ist der Wechsel vollzogen.\n\n` +
      `Wenn du das selbst angefordert hast, brauchst du nichts weiter ` +
      `zu tun. Wenn NICHT, melde dich umgehend beim Studio-Owner und ` +
      `ändere dein Passwort — möglicherweise hat jemand Fremdes Zugriff ` +
      `auf deinen Account.\n\n` +
      `— Lumio`,
    html: renderMailLayout({
      preheader: `E-Mail-Wechsel auf ${opts.newEmail} angefordert`,
      bodyHtml:
        mailHeading(`Hallo ${opts.displayName},`) +
        mailParagraph(
          `Es wurde ein Wechsel deiner E-Mail-Adresse für dein Lumio-Studio „${opts.tenantName}" angefordert. Neue Adresse: ${opts.newEmail}.`
        ) +
        mailParagraph(
          `An die neue Adresse haben wir einen Bestätigungslink geschickt. Erst nach Klick darauf ist der Wechsel vollzogen.`
        ) +
        mailNoticeBox(
          `Wenn du das selbst angefordert hast, ist alles in Ordnung. Wenn NICHT, melde dich beim Studio-Owner und ändere dein Passwort — möglicherweise hat jemand Fremdes Zugriff auf deinen Account.`
        ),
    }),
  };
}

/**
 * Galerie-Einladung — die EINZIGE Mail die optional Studio-Branding
 * bekommt (Logo + Akzentfarbe vom Studio). Geht an Endkunden, deshalb
 * soll der Fotograf vorne stehen, nicht Lumio.
 */
export function tmplGalleryInvite(opts: {
  galleryTitle: string;
  shareUrl: string;
  studioName: string;
  recipientLabel: string;
  personalMessage?: string;
  canSelect: boolean;
  canDownload: boolean;
  expiresAt?: Date | null;
  /** Optional: Studio-Branding fuer die HTML-Mail. */
  branding?: MailBranding;
}): { subject: string; text: string; html: string } {
  const greetingName = opts.recipientLabel || "Hallo";
  const expiryLine = opts.expiresAt
    ? `\nDer Link ist gültig bis ${opts.expiresAt.toLocaleDateString(
        "de-DE",
        { day: "2-digit", month: "long", year: "numeric" }
      )}.\n`
    : "";

  const capabilities: string[] = [];
  capabilities.push("Bilder ansehen");
  if (opts.canSelect) capabilities.push("Lieblings-Bilder markieren");
  if (opts.canDownload) capabilities.push("Bilder herunterladen");
  const capLines = capabilities.map((c) => `  • ${c}`).join("\n");

  const intro = opts.personalMessage
    ? `${opts.personalMessage}\n\n`
    : `${greetingName},\n\n` +
      `deine Galerie „${opts.galleryTitle}" ist da. ` +
      `Über den folgenden Link kannst du:\n\n`;

  const accent = opts.branding?.accentColor ?? null;

  return {
    subject: `Deine Galerie „${opts.galleryTitle}" von ${opts.studioName}`,
    text:
      intro +
      (opts.personalMessage ? `Was du in der Galerie tun kannst:\n` : "") +
      capLines +
      `\n\n` +
      `Galerie öffnen:\n${opts.shareUrl}\n` +
      expiryLine +
      `\n` +
      `— ${opts.studioName}\n` +
      `\n` +
      `(verschickt via Lumio)`,
    html: renderMailLayout({
      branding: {
        ...(opts.branding ?? {}),
        brandName: opts.studioName,
        footerNote: `Diese Mail wurde von ${opts.studioName} über Lumio verschickt.`,
      },
      preheader: opts.personalMessage
        ? opts.personalMessage.slice(0, 100)
        : `Deine Galerie „${opts.galleryTitle}" ist bereit`,
      bodyHtml:
        (opts.personalMessage
          ? mailQuoteBlock(opts.personalMessage, accent)
          : mailParagraph(
              `${greetingName}, deine Galerie „${opts.galleryTitle}" ist da.`
            )) +
        mailParagraph(`Was du in der Galerie tun kannst:`) +
        mailBullets(capabilities) +
        mailButton(opts.shareUrl, "Galerie öffnen", accent) +
        (opts.expiresAt
          ? mailNoticeBox(
              `Der Link ist gültig bis ${opts.expiresAt.toLocaleDateString(
                "de-DE",
                { day: "2-digit", month: "long", year: "numeric" }
              )}.`
            )
          : ""),
    }),
  };
}

export function tmplWelcome(opts: {
  displayName: string | null;
  studioName: string;
  studioUrl: string;
  trialEndsAt: Date;
  planName: string;
}): { subject: string; text: string; html: string } {
  const greeting = opts.displayName ? `Hallo ${opts.displayName},` : "Hallo,";
  const trialEnd = opts.trialEndsAt.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  return {
    subject: `Willkommen bei Lumio — dein Studio „${opts.studioName}" ist startklar`,
    text:
      `${greeting}\n\n` +
      `dein Lumio-Studio „${opts.studioName}" ist angelegt und einsatzbereit. ` +
      `Du bist im ${opts.planName}-Plan mit einem 14-tägigen Trial — kostenlos ` +
      `bis zum ${trialEnd}, kein Risiko.\n\n` +
      `Einloggen kannst du dich jederzeit unter:\n` +
      `  ${opts.studioUrl}\n\n` +
      `Erste Schritte für dein Studio:\n` +
      `  • Branding anpassen (Logo, Farben, eigene Domain)\n` +
      `  • Eine erste Galerie anlegen und ein paar Bilder hochladen\n` +
      `  • Test-Share-Link an dich selbst schicken, um den Endkunden-` +
      `Workflow zu durchlaufen\n\n` +
      `Fragen? Antworte einfach auf diese Mail oder schreib an ` +
      `support@lumio-cloud.de.\n\n` +
      `Bis bald\n` +
      `— Lumio`,
    html: renderMailLayout({
      preheader: `Dein Studio „${opts.studioName}" ist startklar`,
      bodyHtml:
        mailHeading(`Willkommen bei Lumio`) +
        mailParagraph(
          `${opts.displayName ? opts.displayName + ", " : ""}dein Studio „${opts.studioName}" ist angelegt und einsatzbereit. Du bist im ${opts.planName}-Plan mit einem 14-tägigen Trial — kostenlos bis zum ${trialEnd}.`
        ) +
        mailButton(opts.studioUrl, "Studio öffnen") +
        mailDivider() +
        mailHeading(`Erste Schritte`) +
        mailBullets([
          "Branding anpassen (Logo, Farben, eigene Domain)",
          "Eine erste Galerie anlegen und ein paar Bilder hochladen",
          "Test-Share-Link an dich selbst schicken, um den Endkunden-Workflow zu durchlaufen",
        ]) +
        mailNoticeBox(
          `Fragen? Antworte einfach auf diese Mail oder schreib an support@lumio-cloud.de.`
        ),
    }),
  };
}

// ---------------------------------------------------------------------------
// Self-Service Tenant-Loeschung (DSGVO Art. 17)
// ---------------------------------------------------------------------------

export function tmplDeletionRequested(opts: {
  displayName: string | null;
  studioName: string;
  scheduledFor: Date;
  cancelUrl: string;
}): { subject: string; text: string; html: string } {
  const greeting = opts.displayName ? `Hallo ${opts.displayName},` : "Hallo,";
  const dateStr = opts.scheduledFor.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  return {
    subject: `Löschung deines Studios „${opts.studioName}" geplant`,
    text:
      `${greeting}\n\n` +
      `wir haben deine Anfrage zur Löschung deines Lumio-Studios ` +
      `„${opts.studioName}" erhalten.\n\n` +
      `Was jetzt passiert:\n` +
      `  • Deine Stripe-Subscription wurde sofort gekündigt — keine ` +
      `weitere Abrechnung.\n` +
      `  • Das Studio bleibt für 60 Tage in der Karenzphase. Bestehende ` +
      `Kunden-Galerien sind in dieser Zeit weiter erreichbar.\n` +
      `  • Du kannst die Löschung bis zum ${dateStr} jederzeit ` +
      `zurücknehmen.\n` +
      `  • Am ${dateStr} werden alle Daten endgültig gelöscht.\n\n` +
      `Löschung zurücknehmen:\n${opts.cancelUrl}\n\n` +
      `Wenn du die Löschung NICHT angefordert hast, melde dich umgehend ` +
      `bei support@lumio-cloud.de.\n\n` +
      `— Lumio`,
    html: renderMailLayout({
      preheader: `Endgültige Löschung am ${dateStr} — bis dahin rücknehmbar`,
      bodyHtml:
        mailHeading(`Studio-Löschung geplant`) +
        mailParagraph(
          `${greeting.replace(",", "")} — wir haben deine Anfrage zur Löschung von „${opts.studioName}" erhalten.`
        ) +
        mailHeading(`Was jetzt passiert`) +
        mailBullets([
          "Deine Stripe-Subscription wurde sofort gekündigt — keine weitere Abrechnung.",
          "Das Studio bleibt für 60 Tage in der Karenzphase. Bestehende Kunden-Galerien sind weiter erreichbar.",
          `Du kannst die Löschung bis zum ${dateStr} jederzeit zurücknehmen.`,
          `Am ${dateStr} werden alle Daten endgültig gelöscht.`,
        ]) +
        mailButton(opts.cancelUrl, "Löschung zurücknehmen") +
        mailNoticeBox(
          `Wenn du die Löschung NICHT angefordert hast, melde dich umgehend bei support@lumio-cloud.de — möglicherweise hat jemand Fremdes Zugriff auf deinen Account.`
        ),
    }),
  };
}

export function tmplDeletionCancelled(opts: {
  displayName: string | null;
  studioName: string;
}): { subject: string; text: string; html: string } {
  const greeting = opts.displayName ? `Hallo ${opts.displayName},` : "Hallo,";
  return {
    subject: `Löschung deines Studios „${opts.studioName}" zurückgenommen`,
    text:
      `${greeting}\n\n` +
      `du hast die Löschung deines Studios „${opts.studioName}" ` +
      `zurückgenommen. Dein Studio ist wieder aktiv und voll nutzbar.\n\n` +
      `Wichtiger Hinweis zur Abrechnung:\n` +
      `Deine Stripe-Subscription wurde bei der Lösch-Anfrage gekündigt ` +
      `und wird NICHT automatisch reaktiviert. Wenn du Lumio weiter ` +
      `nutzen willst, musst du im Studio unter „Billing" eine neue ` +
      `Subscription starten.\n\n` +
      `— Lumio`,
    html: renderMailLayout({
      preheader: `Dein Studio „${opts.studioName}" ist wieder aktiv`,
      bodyHtml:
        mailHeading(`Löschung zurückgenommen`) +
        mailParagraph(
          `${greeting.replace(",", "")} — du hast die Löschung deines Studios „${opts.studioName}" zurückgenommen. Dein Studio ist wieder aktiv und voll nutzbar.`
        ) +
        mailNoticeBox(
          `Wichtig zur Abrechnung: Deine Stripe-Subscription wurde bei der Lösch-Anfrage gekündigt und wird NICHT automatisch reaktiviert. Wenn du Lumio weiter nutzen willst, starte im Studio unter „Billing" eine neue Subscription.`
        ),
    }),
  };
}

export function tmplDeletionExecuted(opts: {
  studioName: string;
}): { subject: string; text: string; html: string } {
  return {
    subject: `Dein Lumio-Studio „${opts.studioName}" wurde gelöscht`,
    text:
      `Hallo,\n\n` +
      `wie angekündigt haben wir dein Lumio-Studio „${opts.studioName}" ` +
      `und alle zugehörigen Daten endgültig gelöscht.\n\n` +
      `Gelöscht wurden:\n` +
      `  • Alle Bilder und Videos in deinen Galerien\n` +
      `  • Alle Galerien und ihre Konfiguration\n` +
      `  • Dein Account und alle Team-Accounts\n` +
      `  • Branding, Watermarks, Templates\n` +
      `  • Audit-Logs (nur die Tenant-spezifischen)\n\n` +
      `Behalten:\n` +
      `  • Stripe-Customer-Datensatz (für Rechnungs-Audit-Trail in Stripe).\n` +
      `    Wenn du den auch endgültig gelöscht haben möchtest, schreibe ` +
      `an support@lumio-cloud.de.\n\n` +
      `Diese Mail ist deine Löschungs-Bestätigung — bitte aufbewahren ` +
      `falls du sie später für dein eigenes Verarbeitungsverzeichnis ` +
      `brauchst.\n\n` +
      `Schade dass du gehst. Falls es technische Gründe waren oder ein ` +
      `Feature gefehlt hat: feedback@lumio-cloud.de — wir lesen das.\n\n` +
      `— Lumio`,
    html: renderMailLayout({
      preheader: `Bestätigung der endgültigen Löschung von „${opts.studioName}"`,
      bodyHtml:
        mailHeading(`Studio gelöscht`) +
        mailParagraph(
          `Wie angekündigt haben wir dein Lumio-Studio „${opts.studioName}" und alle zugehörigen Daten endgültig gelöscht.`
        ) +
        mailHeading(`Gelöscht wurden`) +
        mailBullets([
          "Alle Bilder und Videos in deinen Galerien",
          "Alle Galerien und ihre Konfiguration",
          "Dein Account und alle Team-Accounts",
          "Branding, Watermarks, Templates",
          "Audit-Logs (nur die Tenant-spezifischen)",
        ]) +
        mailHeading(`Behalten`) +
        mailParagraph(
          `Stripe-Customer-Datensatz (für Rechnungs-Audit-Trail in Stripe). Wenn du den auch endgültig gelöscht haben möchtest, schreibe an support@lumio-cloud.de.`
        ) +
        mailDivider() +
        mailNoticeBox(
          `Diese Mail ist deine Löschungs-Bestätigung — bitte aufbewahren, falls du sie später für dein eigenes Verarbeitungsverzeichnis brauchst.`
        ) +
        mailParagraph(
          `Schade dass du gehst. Falls es technische Gründe waren oder ein Feature gefehlt hat: feedback@lumio-cloud.de — wir lesen das.`
        ),
    }),
  };
}

export function tmplDeletionReminder(opts: {
  displayName: string | null;
  studioName: string;
  scheduledFor: Date;
  cancelUrl: string;
}): { subject: string; text: string; html: string } {
  const greeting = opts.displayName ? `Hallo ${opts.displayName},` : "Hallo,";
  const dateStr = opts.scheduledFor.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  return {
    subject: `Erinnerung: dein Studio „${opts.studioName}" wird in 7 Tagen gelöscht`,
    text:
      `${greeting}\n\n` +
      `am ${dateStr} löschen wir dein Lumio-Studio „${opts.studioName}" ` +
      `endgültig — wie von dir angefragt.\n\n` +
      `Das ist deine letzte Erinnerung. Wenn du es dir anders überlegt ` +
      `hast, kannst du die Löschung jetzt noch zurücknehmen:\n\n` +
      `${opts.cancelUrl}\n\n` +
      `Nach dem Stichtag sind die Daten unwiderruflich weg.\n\n` +
      `— Lumio`,
    html: renderMailLayout({
      preheader: `Letzte 7 Tage — endgültige Löschung am ${dateStr}`,
      bodyHtml:
        mailHeading(`Letzte Erinnerung`) +
        mailParagraph(
          `${greeting.replace(",", "")} — am ${dateStr} löschen wir dein Lumio-Studio „${opts.studioName}" endgültig, wie von dir angefragt.`
        ) +
        mailParagraph(
          `Wenn du es dir anders überlegt hast, kannst du die Löschung jetzt noch zurücknehmen:`
        ) +
        mailButton(opts.cancelUrl, "Löschung zurücknehmen") +
        mailNoticeBox(`Nach dem Stichtag sind die Daten unwiderruflich weg.`),
    }),
  };
}
