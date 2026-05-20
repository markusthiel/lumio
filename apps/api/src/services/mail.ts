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
