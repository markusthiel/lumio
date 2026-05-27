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
    });
    logger.info({ to: msg.to, subject: msg.subject }, "mail sent");
  } catch (err) {
    logger.warn({ err, to: msg.to, subject: msg.subject }, "mail send failed");
    // Wir werfen NICHT — Mail-Fehler sollten Business-Operationen nicht killen
  }
}

// -----------------------------------------------------------------------------
// Templates
// -----------------------------------------------------------------------------
export function tmplNewComment(opts: {
  galleryTitle: string;
  galleryUrl: string;
  authorLabel: string;
  body: string;
}): { subject: string; text: string } {
  return {
    subject: `Neuer Kommentar in "${opts.galleryTitle}"`,
    text:
      `${opts.authorLabel} hat einen Kommentar hinterlassen:\n\n` +
      `"${opts.body}"\n\n` +
      `Galerie ansehen: ${opts.galleryUrl}\n\n` +
      `— Lumio`,
  };
}

export function tmplSelectionFinished(opts: {
  galleryTitle: string;
  galleryUrl: string;
  accessLabel: string;
  count: number;
}): { subject: string; text: string } {
  return {
    subject: `Auswahl fertig: "${opts.galleryTitle}"`,
    text:
      `${opts.accessLabel} hat die Auswahl abgeschlossen ` +
      `(${opts.count} Datei${opts.count === 1 ? "" : "en"}).\n\n` +
      `Galerie ansehen: ${opts.galleryUrl}\n\n` +
      `— Lumio`,
  };
}

export function tmplZipReady(opts: {
  galleryTitle: string;
  downloadUrl: string;
  fileCount: number;
}): { subject: string; text: string } {
  return {
    subject: `Download bereit: "${opts.galleryTitle}"`,
    text:
      `Dein ZIP-Download mit ${opts.fileCount} Datei` +
      `${opts.fileCount === 1 ? "" : "en"} ist fertig:\n\n` +
      `${opts.downloadUrl}\n\n` +
      `Der Link ist 7 Tage gültig.\n\n` +
      `— Lumio`,
  };
}

/**
 * Mail für neu angelegte Tenant-Owner. Der Super-Admin hat einen
 * Account vorbereitet und ein Setup-Token vergeben; per Link landet
 * der neue Owner im Frontend bei /auth/setup-password?token=...
 * und setzt dort sein eigenes Passwort.
 */
export function tmplOwnerSetup(opts: {
  displayName: string;
  tenantName: string;
  setupUrl: string;
  invitedBy: string;
  validHours: number;
}): { subject: string; text: string } {
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
  };
}

/**
 * Mail bei Passwort-Reset. Wird per "Passwort vergessen"-Flow vom
 * User selbst angestossen. tenantName lassen wir bewusst leer wenn
 * mehrere Tenants pro E-Mail existieren — die Mail soll keinen
 * Tenant-Hint geben, der jemand anderen verwirren wuerde.
 */
export function tmplPasswordReset(opts: {
  displayName: string;
  tenantName: string;
  resetUrl: string;
  validHours: number;
  ipAddress?: string;
}): { subject: string; text: string } {
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
  };
}

/**
 * Bestaetigungsmail an die NEUE E-Mail-Adresse beim E-Mail-Wechsel.
 * Erst nach Klick auf den Link ist der Wechsel vollzogen. So koennen
 * Tippfehler in der neuen Adresse den User nicht aussperren.
 */
export function tmplEmailChangeConfirm(opts: {
  displayName: string;
  tenantName: string;
  oldEmail: string;
  newEmail: string;
  confirmUrl: string;
  validHours: number;
}): { subject: string; text: string } {
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
  };
}

/**
 * Info-Mail an die ALTE E-Mail-Adresse beim E-Mail-Wechsel. Hilft
 * Account-Hijacks zu erkennen: wenn der User selbst den Wechsel
 * angefordert hat, ist das nur eine Bestätigung; wenn jemand
 * Fremdes Zugriff hatte und die Adresse ändert, sieht der echte
 * Inhaber Bescheid.
 */
export function tmplEmailChangeNotice(opts: {
  displayName: string;
  tenantName: string;
  newEmail: string;
}): { subject: string; text: string } {
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
  };
}

/**
 * Galerie-Einladung an Endkund:innen — wird verschickt wenn ein
 * GalleryAccess angelegt wird (oder spaeter manuell "Einladung
 * erneut senden" geklickt wird).
 *
 * personalMessage: optionale persoenliche Notiz vom Fotograf
 * (z.B. "Liebe Anna, hier sind eure Hochzeitsbilder!"). Wird ueber
 * den Standard-Text gesetzt damit sie als erstes sichtbar ist.
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
}): { subject: string; text: string } {
  const greetingName = opts.recipientLabel || "Hallo";
  const expiryLine = opts.expiresAt
    ? `\nDer Link ist gültig bis ${opts.expiresAt.toLocaleDateString(
        "de-DE",
        { day: "2-digit", month: "long", year: "numeric" }
      )}.\n`
    : "";

  // Was kann der Empfaenger? Kleiner Bullet-Block damit klar ist,
  // was er ohne Account tun kann.
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
  };
}

/**
 * Welcome-Mail nach erfolgreicher Self-Service-Account-Anlage.
 * Wird im Signup-Flow nach erfolgreichem Stripe-Checkout-Session-
 * Create verschickt — der Tenant ist zu dem Zeitpunkt persistiert
 * und die Subscription auf 'trialing' gesetzt.
 *
 * Inhalt bewusst auf das Wichtigste reduziert: was hat der User
 * gerade angelegt, wann endet sein Trial, wo loggt er sich ein,
 * wo bekommt er Hilfe.
 */
export function tmplWelcome(opts: {
  displayName: string | null;
  studioName: string;
  studioUrl: string;
  trialEndsAt: Date;
  planName: string;
}): { subject: string; text: string } {
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
  };
}
