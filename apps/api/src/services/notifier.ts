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
  tmplWelcome,
} from "./mail.js";
import type { MailBranding } from "./mail-layout.js";

function studioUrl(galleryId: string): string {
  return `${config.PUBLIC_URL}/studio/${galleryId}`;
}

function publicUrl(slug: string): string {
  return `${config.PUBLIC_URL}/g/${slug}`;
}

/**
 * Baut das tenant-weite Mail-Branding (E-Mail-Logo, Akzent, Name,
 * Logo-Position) für die HTML-Mails. Das Logo wird über den stabilen
 * Public-Redirect ausgeliefert (verfällt nicht wie eine signierte URL).
 * Die Logo-Position ist grob an die Login-Layout-Variante gekoppelt.
 */
async function tenantMailBranding(
  tenantId: string | null | undefined
): Promise<MailBranding | undefined> {
  if (!tenantId) return undefined;
  try {
    const t = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        displayName: true,
        name: true,
        emailLogoKey: true,
        studioAccentColor: true,
        loginAccentColor: true,
        loginLayout: true,
        mailLayout: true,
      },
    });
    if (!t) return undefined;
    return {
      logoUrl: t.emailLogoKey
        ? `${config.PUBLIC_URL}/api/v1/public/email-logo/${tenantId}`
        : null,
      accentColor: t.studioAccentColor ?? t.loginAccentColor ?? null,
      brandName: t.displayName ?? t.name ?? null,
      layout:
        (t.mailLayout as
          | "classic"
          | "logo_right"
          | "centered"
          | "banner"
          | null) ?? "classic",
    };
  } catch {
    return undefined;
  }
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
      branding: await tenantMailBranding(gallery.tenantId),
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
      branding: await tenantMailBranding(gallery.tenantId),
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
        gallery: { select: { slug: true, title: true, tenantId: true } },
      },
    });
    if (!zip || !zip.accessId) return true; // ohne Access = keine Email-Adresse

    const access = await prisma.galleryAccess.findUnique({
      where: { id: zip.accessId },
      select: { emails: true },
    });
    if (!access || access.emails.length === 0) return true;

    const downloadUrl = `${config.PUBLIC_URL}/g/${zip.gallery.slug}` +
      `?zip=${zip.id}`;
    const tpl = tmplZipReady({
      galleryTitle: zip.gallery.title,
      downloadUrl,
      fileCount: zip.fileCount,
      branding: await tenantMailBranding(zip.gallery.tenantId),
    });
    // ZIP-Ready geht an alle hinterlegten Adressen — wer den Download
    // angestoßen hat, ist im aktuellen Datenmodell nicht trennbar von
    // den anderen Empfaengern des gleichen Access. Pragmatisch: alle
    // benachrichtigen, ist nicht intrusiv.
    for (const to of access.emails) {
      await sendMail({ to, ...tpl });
    }
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
  /** Wenn gesetzt: nutze diese Adressen statt der hinterlegten emails
   *  am Access. Fuer ad-hoc Versand aus dem InviteDialog. */
  recipientsOverride?: string[];
}): Promise<boolean> {
  try {
    const access = await prisma.galleryAccess.findUnique({
      where: { id: opts.accessId },
      include: {
        gallery: {
          select: {
            slug: true,
            title: true,
            tenantId: true,
            tenant: {
              select: {
                name: true,
                displayName: true,
              },
            },
          },
        },
      },
    });

    if (!access) {
      logger.info(
        { accessId: opts.accessId },
        "gallery invitation skipped: access not found"
      );
      return false;
    }

    const recipients = opts.recipientsOverride ?? access.emails;
    if (recipients.length === 0) {
      logger.info(
        { accessId: opts.accessId },
        "gallery invitation skipped: no recipients"
      );
      return false;
    }

    const shareUrl = `${publicUrl(access.gallery.slug)}?t=${access.token}`;
    const tenant = access.gallery.tenant;
    const studioDisplayName = tenant.displayName ?? tenant.name;

    const tpl = tmplGalleryInvite({
      galleryTitle: access.gallery.title,
      shareUrl,
      studioName: studioDisplayName,
      recipientLabel: access.label,
      personalMessage: opts.personalMessage,
      canSelect: access.canSelect,
      canDownload: access.canDownload,
      expiresAt: access.expiresAt,
      branding: (await tenantMailBranding(access.gallery.tenantId)) ?? {
        brandName: studioDisplayName,
      },
    });

    // Pro Empfaenger eine eigene Mail (keine BCC-Sammelmail). Vorteile:
    //   - Bounces/Spam-Reports lassen sich klar zuordnen
    //   - Empfaenger sieht "an: ich" (statt "an: 4 leute")
    //   - Bei einem fehlgeschlagenen Send haengen die anderen nicht
    // Sequential, weil Postmark bei Rate-Limits sonst rumzickt.
    for (const to of recipients) {
      await sendMail({ to, ...tpl });
    }
    return true;
  } catch (err) {
    logger.warn(
      { err, accessId: opts.accessId },
      "sendGalleryInvitation failed before SMTP"
    );
    return false;
  }
}

/**
 * Welcome-Mail nach erfolgreichem Self-Service-Signup.
 * Wird in routes/signup.ts aufgerufen nachdem Tenant+User+Subscription
 * angelegt UND der Stripe-Checkout-Session erfolgreich erstellt wurde.
 *
 * Stille Failures wie ueberall im Notifier — wir wollen den Signup-
 * Response nicht killen, falls Mail temporaer scheitert.
 */
export async function sendWelcomeMail(opts: {
  userId: string;
  tenantId: string;
}): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: opts.userId },
      select: {
        email: true,
        name: true,
        tenant: {
          select: {
            name: true,
            subscription: {
              select: {
                trialEndsAt: true,
                plan: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (!user) return;
    if (!user.tenant.subscription) return;
    if (!user.tenant.subscription.trialEndsAt) return;

    const tpl = tmplWelcome({
      displayName: user.name,
      studioName: user.tenant.name,
      studioUrl: config.PUBLIC_URL,
      trialEndsAt: user.tenant.subscription.trialEndsAt,
      planName: user.tenant.subscription.plan.name,
    });
    await sendMail({ to: user.email, ...tpl });
  } catch (err) {
    logger.warn({ err, userId: opts.userId }, "sendWelcomeMail failed before SMTP");
  }
}
