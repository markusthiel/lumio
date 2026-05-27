/**
 * Lumio API — Notification Service
 *
 * Wird von Routen aufgerufen, wenn ein Event passiert, das per Mail
 * notifiziert werden sollte. Hält die Mail-Logik aus den Routen raus
 * und stellt sicher, dass Failures niemals den Request killen.
 */
import { prisma } from "../db.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import {
  sendMail,
  tmplNewComment,
  tmplSelectionFinished,
  tmplZipReady,
  tmplGalleryInvite,
} from "./mail.js";

function studioUrl(galleryId: string): string {
  return `${config.PUBLIC_URL}/studio/${galleryId}`;
}

function publicUrl(slug: string): string {
  return `${config.PUBLIC_URL}/g/${slug}`;
}

/**
 * Studio über einen neuen Kunden-Kommentar informieren.
 * Stille Failures — wir wollen die User-Aktion nie blockieren.
 */
export async function notifyNewComment(opts: {
  galleryId: string;
  authorLabel: string;
  body: string;
}): Promise<void> {
  try {
    const gallery = await prisma.gallery.findUnique({
      where: { id: opts.galleryId },
      include: {
        owner: { select: { email: true, name: true } },
      },
    });
    if (!gallery?.owner?.email) return;

    const tpl = tmplNewComment({
      galleryTitle: gallery.title,
      galleryUrl: studioUrl(gallery.id),
      authorLabel: opts.authorLabel,
      body: opts.body.slice(0, 500),
    });
    await sendMail({ to: gallery.owner.email, ...tpl });
  } catch (err) {
    logger.warn({ err }, "notifyNewComment failed");
  }
}

/**
 * Studio informieren, dass ein Access-Token-Inhaber seine Auswahl
 * abgeschlossen hat (heuristisch: wenn die Anzahl picks/likes einen
 * Schwellwert überschreitet oder explizit über einen "Abschließen"-Button —
 * hier vereinfacht: nach jeder Selection-Änderung anwerfen, aber mit
 * Throttling via DB).
 */
export async function notifySelectionFinished(opts: {
  galleryId: string;
  accessId: string;
}): Promise<void> {
  try {
    const access = await prisma.galleryAccess.findUnique({
      where: { id: opts.accessId },
      select: { label: true },
    });
    const gallery = await prisma.gallery.findUnique({
      where: { id: opts.galleryId },
      include: {
        owner: { select: { email: true } },
      },
    });
    if (!gallery?.owner?.email || !access) return;

    // Aktuelle Auswahl zählen
    const count = await prisma.selection.count({
      where: {
        accessId: opts.accessId,
        OR: [{ liked: true }, { status: "pick" }],
      },
    });
    if (count === 0) return;

    const tpl = tmplSelectionFinished({
      galleryTitle: gallery.title,
      galleryUrl: studioUrl(gallery.id),
      accessLabel: access.label,
      count,
    });
    await sendMail({ to: gallery.owner.email, ...tpl });
  } catch (err) {
    logger.warn({ err }, "notifySelectionFinished failed");
  }
}

/**
 * Kunde informieren, dass sein ZIP-Download fertig ist.
 *
 * Idempotent über zip_downloads.notifiedAt: setzt das Flag transaktional,
 * sodass mehrere parallele Status-Polls nur EINE Mail auslösen.
 * Gibt true zurück, wenn diese Anfrage tatsächlich die Mail ausgelöst hat.
 */
export async function notifyZipReadyOnce(opts: {
  zipDownloadId: string;
}): Promise<boolean> {
  try {
    // Conditional update: setzt notifiedAt nur, wenn es noch NULL ist.
    // updateMany gibt count zurück — wenn 0, hat schon jemand anderes notifiziert.
    const updated = await prisma.zipDownload.updateMany({
      where: {
        id: opts.zipDownloadId,
        status: "ready",
        notifiedAt: null,
      },
      data: { notifiedAt: new Date() },
    });
    if (updated.count === 0) return false;

    // Jetzt die zugehörigen Daten holen
    const zip = await prisma.zipDownload.findUnique({
      where: { id: opts.zipDownloadId },
      select: {
        id: true,
        fileCount: true,
        accessId: true,
        gallery: { select: { slug: true, title: true } },
      },
    });
    if (!zip || !zip.accessId) return true; // ohne Access = keine Email-Adresse

    const access = await prisma.galleryAccess.findUnique({
      where: { id: zip.accessId },
      select: { email: true },
    });
    if (!access?.email) return true;

    const downloadUrl = `${config.PUBLIC_URL}/g/${zip.gallery.slug}` +
      `?zip=${zip.id}`;
    const tpl = tmplZipReady({
      galleryTitle: zip.gallery.title,
      downloadUrl,
      fileCount: zip.fileCount,
    });
    await sendMail({ to: access.email, ...tpl });
    return true;
  } catch (err) {
    logger.warn({ err }, "notifyZipReadyOnce failed");
    return false;
  }
}

/**
 * Kunde informieren, dass sein ZIP-Download fertig ist (alte Signatur).
 * @deprecated nutze notifyZipReadyOnce stattdessen
 */
export async function notifyZipReady(opts: {
  email: string;
  galleryTitle: string;
  downloadUrl: string;
  fileCount: number;
}): Promise<void> {
  try {
    const tpl = tmplZipReady({
      galleryTitle: opts.galleryTitle,
      downloadUrl: opts.downloadUrl,
      fileCount: opts.fileCount,
    });
    await sendMail({ to: opts.email, ...tpl });
  } catch (err) {
    logger.warn({ err }, "notifyZipReady failed");
  }
}

// publicUrl wird von Webhook-Aufrufen benötigt
export { publicUrl };

/**
 * Galerie-Einladung an einen Endkunden verschicken. Wird beim Anlegen
 * eines GalleryAccess mit sendInvitation=true aufgerufen, oder beim
 * expliziten "Einladung erneut senden"-Endpoint.
 *
 * Returns true bei Versand-Versuch (auch im no-op-mode), false wenn
 * keine E-Mail-Adresse hinterlegt ist.
 */
export async function sendGalleryInvitation(opts: {
  accessId: string;
  personalMessage?: string;
}): Promise<boolean> {
  try {
    const access = await prisma.galleryAccess.findUnique({
      where: { id: opts.accessId },
      include: {
        gallery: {
          select: {
            slug: true,
            title: true,
            tenant: { select: { name: true } },
          },
        },
      },
    });

    if (!access?.email) {
      logger.info(
        { accessId: opts.accessId },
        "gallery invitation skipped: no email on access"
      );
      return false;
    }

    const shareUrl = `${publicUrl(access.gallery.slug)}?t=${access.token}`;

    const tpl = tmplGalleryInvite({
      galleryTitle: access.gallery.title,
      shareUrl,
      studioName: access.gallery.tenant.name,
      recipientLabel: access.label,
      personalMessage: opts.personalMessage,
      canSelect: access.canSelect,
      canDownload: access.canDownload,
      expiresAt: access.expiresAt,
    });

    await sendMail({ to: access.email, ...tpl });
    return true;
  } catch (err) {
    // Schluck den Fehler bewusst — Mail-Versand darf den Auslosenden
    // Request nicht killen. Loggen aber sehr klar damit man bei Fehl-
    // diagnose sehen kann, dass eine Mail wegen DB-Fehler nicht raus
    // ging (anders als bei SMTP-Fehler, der schon in sendMail() gefangen
    // wird).
    logger.warn(
      { err, accessId: opts.accessId },
      "sendGalleryInvitation failed before SMTP"
    );
    return false;
  }
}
