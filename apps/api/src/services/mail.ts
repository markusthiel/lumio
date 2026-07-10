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
import { prisma } from "../db.js";

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
    void logMail(msg.to, msg.subject, "skipped");
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
    void logMail(msg.to, msg.subject, "sent");
  } catch (err) {
    logger.warn({ err, to: msg.to, subject: msg.subject }, "mail send failed");
    void logMail(
      msg.to,
      msg.subject,
      "failed",
      err instanceof Error ? err.message : String(err)
    );
    // Wir werfen NICHT — Mail-Fehler sollten Business-Operationen nicht killen
  }
}

// Schreibt einen Zustell-Log-Eintrag. Komplett fail-safe: ein Fehler hier
// darf den Mailversand niemals beeinflussen.
async function logMail(
  recipient: string,
  subject: string,
  status: "sent" | "failed" | "skipped",
  error?: string
): Promise<void> {
  try {
    await prisma.mailLog.create({
      data: {
        recipient: recipient.slice(0, 500),
        subject: subject.slice(0, 500),
        status,
        error: error ? error.slice(0, 1000) : null,
      },
    });
  } catch (e) {
    logger.warn({ e }, "mailLog write failed");
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
  branding?: MailBranding;
}): { subject: string; text: string; html: string } {
  return {
    subject: `Neuer Kommentar in "${opts.galleryTitle}"`,
    text:
      `${opts.authorLabel} hat einen Kommentar hinterlassen:\n\n` +
      `"${opts.body}"\n\n` +
      `Galerie ansehen: ${opts.galleryUrl}\n\n` +
      `— Lumio`,
    html: renderMailLayout({
      branding: opts.branding,
      preheader: `${opts.authorLabel} hat in "${opts.galleryTitle}" kommentiert`,
      bodyHtml:
        mailHeading(`Neuer Kommentar in „${opts.galleryTitle}"`) +
        mailParagraph(`${opts.authorLabel} hat einen Kommentar hinterlassen:`) +
        mailQuoteBlock(opts.body, opts.branding?.accentColor) +
        mailButton(opts.galleryUrl, "Galerie öffnen", opts.branding?.accentColor),
    }),
  };
}

export function tmplSelectionFinished(opts: {
  galleryTitle: string;
  galleryUrl: string;
  accessLabel: string;
  count: number;
  branding?: MailBranding;
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
      branding: opts.branding,
      preheader: `${opts.accessLabel} hat ${opts.count} ${fileWord} ausgewählt`,
      bodyHtml:
        mailHeading(`Auswahl abgeschlossen`) +
        mailParagraph(
          `${opts.accessLabel} hat die Auswahl in „${opts.galleryTitle}" abgeschlossen — ${opts.count} ${fileWord} markiert.`
        ) +
        mailButton(opts.galleryUrl, "Auswahl ansehen", opts.branding?.accentColor),
    }),
  };
}

export function tmplZipReady(opts: {
  galleryTitle: string;
  downloadUrl: string;
  fileCount: number;
  branding?: MailBranding;
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
      branding: opts.branding,
      preheader: `Dein ZIP-Download (${opts.fileCount} ${fileWord}) ist fertig`,
      bodyHtml:
        mailHeading(`Download bereit`) +
        mailParagraph(
          `Dein ZIP-Download mit ${opts.fileCount} ${fileWord} aus „${opts.galleryTitle}" ist fertig.`
        ) +
        mailButton(opts.downloadUrl, "ZIP herunterladen", opts.branding?.accentColor) +
        mailNoticeBox("Der Link ist 7 Tage gültig."),
    }),
  };
}

export function tmplStorageWarning(opts: {
  usedGib: number;
  limitGib: number;
  percent: number;
  billingUrl: string;
  branding?: MailBranding;
}): { subject: string; text: string; html: string } {
  return {
    subject: `Speicher fast voll: ${opts.percent}% belegt`,
    text:
      `Dein Lumio-Speicher ist zu ${opts.percent}% belegt ` +
      `(${opts.usedGib} von ${opts.limitGib} GB).\n\n` +
      `Ist das Limit erreicht, sind keine neuen Uploads mehr möglich. Du ` +
      `kannst alte Galerien aufräumen oder deinen Speicher/Tarif erweitern:\n\n` +
      `${opts.billingUrl}\n\n— Lumio`,
    html: renderMailLayout({
      branding: opts.branding,
      preheader: `Dein Speicher ist zu ${opts.percent}% belegt`,
      bodyHtml:
        mailHeading("Speicher fast voll") +
        mailParagraph(
          `Dein belegter Speicher liegt bei ${opts.percent}% — ${opts.usedGib} von ${opts.limitGib} GB.`
        ) +
        mailParagraph(
          `Ist das Limit erreicht, sind keine neuen Uploads mehr möglich. Du kannst alte Galerien aufräumen oder deinen Speicher erweitern.`
        ) +
        mailButton(
          opts.billingUrl,
          "Speicher & Tarif",
          opts.branding?.accentColor
        ),
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

// ---------------------------------------------------------------------------
// Billing-Archiv-Lifecycle
// ---------------------------------------------------------------------------

/** Mail beim Übergang Read-only → Archiv: Galerien sind jetzt offline,
 * Vorschauen werden entfernt, Originale bleiben. Reaktivierung jederzeit
 * möglich bis zum Lösch-Stichtag. */
export function tmplBillingArchived(opts: {
  displayName: string | null;
  studioName: string;
  purgeDate: Date;
  reactivateUrl: string;
}): { subject: string; text: string; html: string } {
  const greeting = opts.displayName ? `Hallo ${opts.displayName},` : "Hallo,";
  const dateStr = opts.purgeDate.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  return {
    subject: `Dein Studio „${opts.studioName}" wurde archiviert`,
    text:
      `${greeting}\n\n` +
      `dein Lumio-Studio „${opts.studioName}" war länger ohne aktives Abo ` +
      `und wurde jetzt archiviert.\n\n` +
      `Was das bedeutet:\n` +
      `  • Deine Kunden-Galerien sind vorübergehend offline.\n` +
      `  • Die Original-Dateien bleiben gespeichert — nur die Vorschauen ` +
      `werden entfernt und bei Reaktivierung neu erzeugt.\n` +
      `  • Mit einem neuen Abo ist alles wieder da.\n\n` +
      `Wichtig: Wenn du bis zum ${dateStr} kein Abo abschließt, werden ` +
      `alle Daten an diesem Tag endgültig gelöscht.\n\n` +
      `Studio reaktivieren:\n${opts.reactivateUrl}\n\n` +
      `— Lumio`,
    html: renderMailLayout({
      preheader: `Galerien offline — endgültige Löschung am ${dateStr}, bis dahin reaktivierbar`,
      bodyHtml:
        mailHeading(`Studio archiviert`) +
        mailParagraph(
          `${greeting.replace(",", "")} — dein Studio „${opts.studioName}" war länger ohne aktives Abo und wurde jetzt archiviert.`
        ) +
        mailBullets([
          "Deine Kunden-Galerien sind vorübergehend offline.",
          "Die Original-Dateien bleiben gespeichert — nur die Vorschauen werden entfernt und bei Reaktivierung neu erzeugt.",
          "Mit einem neuen Abo ist alles wieder da.",
        ]) +
        mailButton(opts.reactivateUrl, "Studio reaktivieren") +
        mailNoticeBox(
          `Ohne neues Abo werden am ${dateStr} alle Daten endgültig gelöscht.`
        ),
    }),
  };
}

/** Reminder ~30 Tage vor der endgültigen Löschung eines archivierten Studios. */
export function tmplBillingPurgeReminder(opts: {
  displayName: string | null;
  studioName: string;
  purgeDate: Date;
  reactivateUrl: string;
}): { subject: string; text: string; html: string } {
  const greeting = opts.displayName ? `Hallo ${opts.displayName},` : "Hallo,";
  const dateStr = opts.purgeDate.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  return {
    subject: `Letzte Erinnerung: „${opts.studioName}" wird am ${dateStr} gelöscht`,
    text:
      `${greeting}\n\n` +
      `dein archiviertes Lumio-Studio „${opts.studioName}" wird am ` +
      `${dateStr} endgültig gelöscht — inklusive aller Original-Dateien ` +
      `und Galerien.\n\n` +
      `Wenn du deine Daten behalten möchtest, schließe bis dahin ein Abo ` +
      `ab — dann wird alles wiederhergestellt:\n\n` +
      `${opts.reactivateUrl}\n\n` +
      `Nach dem Stichtag ist eine Wiederherstellung nicht mehr möglich.\n\n` +
      `— Lumio`,
    html: renderMailLayout({
      preheader: `Endgültige Löschung am ${dateStr} — jetzt noch reaktivierbar`,
      bodyHtml:
        mailHeading(`Letzte Erinnerung`) +
        mailParagraph(
          `${greeting.replace(",", "")} — dein archiviertes Studio „${opts.studioName}" wird am ${dateStr} endgültig gelöscht, inklusive aller Original-Dateien und Galerien.`
        ) +
        mailParagraph(
          `Wenn du deine Daten behalten möchtest, schließe bis dahin ein Abo ab — dann wird alles wiederhergestellt:`
        ) +
        mailButton(opts.reactivateUrl, "Studio reaktivieren") +
        mailNoticeBox(`Nach dem Stichtag ist keine Wiederherstellung mehr möglich.`),
    }),
  };
}

// =============================================================================
// Super-Admin / Plattform-Benachrichtigungen (ohne Tenant-Branding)
// =============================================================================

export function tmplSuperNewTenant(opts: {
  tenantName: string;
  slug: string;
  plan: string;
  ownerEmail: string;
  superUrl: string;
}): { subject: string; text: string; html: string } {
  return {
    subject: `Neuer Tenant: ${opts.tenantName} (${opts.plan})`,
    text:
      `Neuer Tenant registriert:\n\n` +
      `Name:  ${opts.tenantName}\n` +
      `Slug:  ${opts.slug}\n` +
      `Plan:  ${opts.plan}\n` +
      `Owner: ${opts.ownerEmail}\n\n` +
      `Super-Admin: ${opts.superUrl}\n\n— Lumio`,
    html: renderMailLayout({
      preheader: `Neuer Tenant: ${opts.tenantName}`,
      bodyHtml:
        mailHeading("Neuer Tenant registriert") +
        mailBullets([
          `Name: ${opts.tenantName}`,
          `Slug: ${opts.slug}`,
          `Plan: ${opts.plan}`,
          `Owner: ${opts.ownerEmail}`,
        ]) +
        mailButton(opts.superUrl, "Im Super-Admin öffnen"),
    }),
  };
}

export function tmplSuperDigest(opts: {
  dateLabel: string;
  newTenants: Array<{ name: string; plan: string }>;
  activeTenants: number;
  totalUsers: number;
  totalStorageGib: number;
  topStorage: Array<{ name: string; usedGib: number; percent: number }>;
  nearLimit: Array<{ name: string; percent: number }>;
  superUrl: string;
}): { subject: string; text: string; html: string } {
  const newCount = opts.newTenants.length;
  const newLines = opts.newTenants.map((t) => `${t.name} (${t.plan})`);
  const topLines = opts.topStorage.map(
    (t) => `${t.name}: ${t.usedGib} GB (${t.percent}%)`
  );
  const nearLines = opts.nearLimit.map((t) => `${t.name}: ${t.percent}%`);

  const textParts = [
    `Lumio Täglicher Report — ${opts.dateLabel}`,
    ``,
    `Neue Tenants (24h): ${newCount}`,
    ...newLines.map((l) => `  - ${l}`),
    ``,
    `Aktive Tenants: ${opts.activeTenants}`,
    `User gesamt: ${opts.totalUsers}`,
    `Speicher gesamt: ${opts.totalStorageGib} GB`,
    ``,
    `Top-Speicher:`,
    ...topLines.map((l) => `  - ${l}`),
    ``,
    `Nahe am Limit (>=90%): ${opts.nearLimit.length}`,
    ...nearLines.map((l) => `  - ${l}`),
    ``,
    `Super-Admin: ${opts.superUrl}`,
    `— Lumio`,
  ];

  let body =
    mailHeading(`Täglicher Report — ${opts.dateLabel}`) +
    mailHeading2sub(`Neue Tenants (24h): ${newCount}`);
  body +=
    newCount > 0
      ? mailBullets(newLines)
      : mailParagraph("Keine neuen Tenants in den letzten 24 Stunden.");
  body += mailDivider();
  body += mailBullets([
    `Aktive Tenants: ${opts.activeTenants}`,
    `User gesamt: ${opts.totalUsers}`,
    `Speicher gesamt: ${opts.totalStorageGib} GB`,
  ]);
  if (opts.topStorage.length > 0) {
    body += mailParagraph("Top-Speicher:") + mailBullets(topLines);
  }
  body += mailParagraph(`Nahe am Limit (>=90%): ${opts.nearLimit.length}`);
  if (opts.nearLimit.length > 0) body += mailBullets(nearLines);
  body += mailButton(opts.superUrl, "Super-Admin öffnen");

  return {
    subject: `Lumio Report ${opts.dateLabel} — ${newCount} neue Tenant(s)`,
    text: textParts.join("\n"),
    html: renderMailLayout({
      preheader: `${newCount} neue Tenants · ${opts.totalStorageGib} GB gesamt`,
      bodyHtml: body,
    }),
  };
}

// Kleiner Zwischen-Titel (mailHeading ist groß; hier eine dezentere Variante).
function mailHeading2sub(text: string): string {
  return mailParagraph(text);
}

// =============================================================================
// Weitere Studio-Benachrichtigungen (Phase 3)
// =============================================================================

export function tmplTeamMemberJoined(opts: {
  memberName: string;
  memberEmail: string;
  role: string;
  teamUrl: string;
  branding?: MailBranding;
}): { subject: string; text: string; html: string } {
  const who = opts.memberName || opts.memberEmail;
  return {
    subject: `Neues Team-Mitglied: ${who}`,
    text:
      `${who} (${opts.memberEmail}, Rolle: ${opts.role}) hat das Konto ` +
      `eingerichtet und ist deinem Team beigetreten.\n\n` +
      `Team verwalten: ${opts.teamUrl}\n\n— Lumio`,
    html: renderMailLayout({
      branding: opts.branding,
      preheader: `${who} ist deinem Team beigetreten`,
      bodyHtml:
        mailHeading("Neues Team-Mitglied") +
        mailParagraph(
          `${who} (${opts.memberEmail}) hat das Konto eingerichtet und ist deinem Team als „${opts.role}" beigetreten.`
        ) +
        mailButton(opts.teamUrl, "Team verwalten", opts.branding?.accentColor),
    }),
  };
}

export function tmplGalleryExpiring(opts: {
  galleryTitle: string;
  daysLeft: number;
  expiresAtLabel: string;
  galleryUrl: string;
  branding?: MailBranding;
}): { subject: string; text: string; html: string } {
  const dayWord = opts.daysLeft === 1 ? "Tag" : "Tagen";
  return {
    subject: `Galerie läuft ab: „${opts.galleryTitle}" (in ${opts.daysLeft} ${dayWord})`,
    text:
      `Die Galerie „${opts.galleryTitle}" läuft am ${opts.expiresAtLabel} ab ` +
      `(in ${opts.daysLeft} ${dayWord}). Danach ist sie für Kunden nicht ` +
      `mehr erreichbar.\n\nGalerie öffnen: ${opts.galleryUrl}\n\n— Lumio`,
    html: renderMailLayout({
      branding: opts.branding,
      preheader: `„${opts.galleryTitle}" läuft in ${opts.daysLeft} ${dayWord} ab`,
      bodyHtml:
        mailHeading("Galerie läuft bald ab") +
        mailParagraph(
          `Die Galerie „${opts.galleryTitle}" läuft am ${opts.expiresAtLabel} ab (in ${opts.daysLeft} ${dayWord}). Danach ist sie für Kunden nicht mehr erreichbar.`
        ) +
        mailParagraph(
          `Falls du sie länger online halten möchtest, kannst du das Ablaufdatum in den Galerie-Einstellungen anpassen.`
        ) +
        mailButton(opts.galleryUrl, "Galerie öffnen", opts.branding?.accentColor),
    }),
  };
}

export function tmplUploadReceived(opts: {
  galleryTitle: string;
  linkLabel: string;
  galleryUrl: string;
  branding?: MailBranding;
}): { subject: string; text: string; html: string } {
  return {
    subject: `Neue Uploads: „${opts.galleryTitle}"`,
    text:
      `Es sind neue Uploads über den Link „${opts.linkLabel}" in der Galerie ` +
      `„${opts.galleryTitle}" eingegangen.\n\nGalerie öffnen: ${opts.galleryUrl}\n\n— Lumio`,
    html: renderMailLayout({
      branding: opts.branding,
      preheader: `Neue Uploads in „${opts.galleryTitle}"`,
      bodyHtml:
        mailHeading("Neue Uploads eingegangen") +
        mailParagraph(
          `Über den Upload-Link „${opts.linkLabel}" sind neue Dateien in „${opts.galleryTitle}" eingegangen.`
        ) +
        mailButton(opts.galleryUrl, "Galerie öffnen", opts.branding?.accentColor),
    }),
  };
}

// =============================================================================
// Marketing / Lifecycle-Templates
// =============================================================================

/**
 * Trial-Reminder — 3 Tage vor Ablauf.
 * Ton: hilfreich, kein Druck. Zeigt kurz was noch drin steckt, CTA Studio.
 */
export function tmplTrialReminder(opts: {
  displayName: string | null;
  studioName: string;
  studioUrl: string;
  planName: string;
  trialEndsAt: Date;
  unsubscribeUrl: string;
}): { subject: string; text: string; html: string } {
  const greeting = opts.displayName ? `Hallo ${opts.displayName},` : "Hallo,";
  const trialEnd = opts.trialEndsAt.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const daysLeft = Math.max(
    1,
    Math.ceil((opts.trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  );
  const daysLabel =
    daysLeft === 1 ? "morgen" : `in ${daysLeft} Tagen`;
  return {
    subject: `Dein Lumio-Trial endet ${daysLabel}`,
    text:
      `${greeting}\n\n` +
      `Dein kostenloser Trial im ${opts.planName}-Plan läuft am ${trialEnd} ab.\n\n` +
      `Falls du noch nicht alles ausprobiert hast — hier ein paar Dinge, ` +
      `die sich lohnen:\n\n` +
      `  • Galerie erstellen und mit einem Kunden teilen\n` +
      `  • Kundenauswahl aktivieren (dein Kunde markiert Favoriten)\n` +
      `  • Branding anpassen (Logo, Farben, eigene Domain)\n\n` +
      `Wenn du danach weiter bei Lumio bleibst, läuft dein Abo einfach weiter — ` +
      `ohne Unterbrechung, keine Daten gehen verloren.\n\n` +
      `Studio öffnen: ${opts.studioUrl}\n\n` +
      `Bei Fragen antworte einfach auf diese Mail.\n\n— Lumio\n\n` +
      `---\nDiese Mail abbestellen: ${opts.unsubscribeUrl}`,
    html: renderMailLayout({
      preheader: `Dein Trial endet am ${trialEnd} — hier ein kurzer Überblick.`,
      bodyHtml:
        mailHeading(greeting) +
        mailParagraph(
          `Dein kostenloser Trial im <strong>${opts.planName}</strong>-Plan läuft am <strong>${trialEnd}</strong> ab.`
        ) +
        mailParagraph(
          `Falls du noch nicht alles ausprobiert hast, lohnen sich besonders:`
        ) +
        `<ul style="margin:0 0 16px 0;padding-left:20px;color:#374151;font-size:15px;line-height:1.6;">` +
        `<li>Galerie erstellen und mit einem Kunden teilen</li>` +
        `<li>Kundenauswahl aktivieren (dein Kunde markiert Favoriten)</li>` +
        `<li>Branding anpassen (Logo, Farben, eigene Domain)</li>` +
        `</ul>` +
        mailParagraph(
          `Wenn du nach dem Trial weiter bei Lumio bleibst, läuft dein Abo einfach weiter — ohne Unterbrechung, keine Daten gehen verloren.`
        ) +
        mailButton(opts.studioUrl, "Studio öffnen") +
        mailParagraph(
          `Bei Fragen antworte einfach auf diese Mail.`
        ) +
        `<p style="margin:24px 0 0 0;font-size:12px;color:#9ca3af;">` +
        `<a href="${opts.unsubscribeUrl}" style="color:#9ca3af;">Keine weiteren Produkt-Mails erhalten</a>` +
        `</p>`,
    }),
  };
}

/**
 * Trial läuft noch, Subscription aber schon gecancelt.
 * Ton: neugierig, kein Vorwurf. Einmal, kein Follow-up.
 */
export function tmplTrialCancelled(opts: {
  displayName: string | null;
  studioName: string;
  studioUrl: string;
  trialEndsAt: Date;
  unsubscribeUrl: string;
}): { subject: string; text: string; html: string } {
  const greeting = opts.displayName ? `Hallo ${opts.displayName},` : "Hallo,";
  const trialEnd = opts.trialEndsAt.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  return {
    subject: `Du hast abgebrochen — dein Studio ist noch bis ${trialEnd} offen`,
    text:
      `${greeting}\n\n` +
      `Du hast dein Lumio-Abo während des Trials storniert. ` +
      `Dein Studio bleibt noch bis zum ${trialEnd} voll zugänglich.\n\n` +
      `Wir wären neugierig: War etwas unklar, hat etwas gefehlt oder ` +
      `war es einfach der falsche Zeitpunkt? Antworte gerne kurz auf diese ` +
      `Mail — wir lesen jede Antwort.\n\n` +
      `Falls du es dir anders überlegt hast, kannst du dein Abo jederzeit ` +
      `im Studio reaktivieren:\n` +
      `${opts.studioUrl}/billing\n\n` +
      `— Lumio\n\n` +
      `---\nDiese Mail abbestellen: ${opts.unsubscribeUrl}`,
    html: renderMailLayout({
      preheader: `Dein Studio ist noch bis ${trialEnd} zugänglich.`,
      bodyHtml:
        mailHeading(greeting) +
        mailParagraph(
          `Du hast dein Lumio-Abo während des Trials storniert. Dein Studio bleibt noch bis zum <strong>${trialEnd}</strong> voll zugänglich.`
        ) +
        mailParagraph(
          `Wir wären neugierig: War etwas unklar, hat etwas gefehlt oder war es einfach der falsche Zeitpunkt? Antworte gerne kurz auf diese Mail — wir lesen jede Antwort.`
        ) +
        mailParagraph(
          `Falls du es dir anders überlegt hast, kannst du dein Abo jederzeit reaktivieren.`
        ) +
        mailButton(`${opts.studioUrl}/billing`, "Abo reaktivieren") +
        `<p style="margin:24px 0 0 0;font-size:12px;color:#9ca3af;">` +
        `<a href="${opts.unsubscribeUrl}" style="color:#9ca3af;">Keine weiteren Mails von uns — versprochen.</a>` +
        `</p>`,
    }),
  };
}

/**
 * Winback — Trial abgelaufen ohne Upgrade ODER zahlender Kunde hat gekündigt.
 * Ton: 1 Mail, nie wieder. Kein Druck, aber ehrliches Angebot.
 */
export function tmplWinback(opts: {
  displayName: string | null;
  studioName: string;
  studioUrl: string;
  reason: "trial_expired" | "cancelled";
  unsubscribeUrl: string;
}): { subject: string; text: string; html: string } {
  const greeting = opts.displayName ? `Hallo ${opts.displayName},` : "Hallo,";
  const isChurn = opts.reason === "cancelled";
  const subject = isChurn
    ? `Schade, dass du gehst — Lumio wartet noch auf dich`
    : `Lumio wartet noch auf dich`;
  const intro = isChurn
    ? `Dein Lumio-Abo für „${opts.studioName}" ist ausgelaufen. Schade, dass du gegangen bist.`
    : `Dein Lumio-Trial für „${opts.studioName}" ist abgelaufen, ohne dass du ein Abo gestartet hast.`;
  return {
    subject,
    text:
      `${greeting}\n\n` +
      `${intro}\n\n` +
      `Wenn der Zeitpunkt gerade einfach nicht gepasst hat — kein Problem. ` +
      `Du kannst jederzeit wieder einsteigen; deine Daten sind noch da.\n\n` +
      `Studio öffnen: ${opts.studioUrl}/billing\n\n` +
      `Das ist die einzige Mail dieser Art, die du von uns bekommst.\n\n` +
      `— Lumio\n\n` +
      `---\nDiese Mail abbestellen: ${opts.unsubscribeUrl}`,
    html: renderMailLayout({
      preheader: isChurn
        ? "Deine Daten sind noch da — falls du doch zurückkommst."
        : "Dein Trial ist abgelaufen — du kannst jederzeit zurück.",
      bodyHtml:
        mailHeading(greeting) +
        mailParagraph(intro) +
        mailParagraph(
          `Wenn der Zeitpunkt gerade einfach nicht gepasst hat — kein Problem. Du kannst jederzeit wieder einsteigen, deine Daten sind noch da.`
        ) +
        mailButton(`${opts.studioUrl}/billing`, "Jetzt einsteigen") +
        mailNoticeBox(
          `Das ist die einzige Mail dieser Art, die du von uns bekommst.`
        ) +
        `<p style="margin:24px 0 0 0;font-size:12px;color:#9ca3af;">` +
        `<a href="${opts.unsubscribeUrl}" style="color:#9ca3af;">Keine weiteren Mails erhalten</a>` +
        `</p>`,
    }),
  };
}
