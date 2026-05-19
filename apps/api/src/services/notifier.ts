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
