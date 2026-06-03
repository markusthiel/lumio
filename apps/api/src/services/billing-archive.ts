/**
 * Lumio API — Billing-Archiv-Lifecycle (nur SaaS)
 *
 * Übergang für gekündigte/unbezahlte Studios, damit sie nicht unbegrenzt
 * im Read-only liegen (Kosten + DSGVO-Speicherbegrenzung):
 *
 *   1) Abo endet  → readOnlySince wird gesetzt (anderswo, Stripe/Usage).
 *   2) markDueArchives(): readOnlySince älter als BILLING_ARCHIVE_AFTER_DAYS
 *      → archivedSince setzen, purgeScheduledFor = readOnlySince + N Monate,
 *        Galerien gehen offline (Gate prüft archivedSince), Hinweis-Mail.
 *   3) dropArchivedDerivatives(): für archivierte Studios die Renditions
 *      (Vorschauen/Thumbs/Web) batchweise aus dem Bucket löschen — Originale
 *      bleiben. Resumable über mehrere Sweeper-Ticks (Rows werden gelöscht).
 *   4) sendPurgeReminders(): ~30 Tage vor purgeScheduledFor eine Erinnerung.
 *   5) purgeDueArchives(): purgeScheduledFor erreicht → endgültige Löschung.
 *
 * Reaktivierung (neues Abo) → clearArchiveOnReactivation(): Flags leeren und
 * Renditions neu erzeugen (Worker, über die normale Verarbeitungs-Pipeline).
 */
import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { config } from "../config.js";
import { deleteObject } from "./storage.js";
import { enqueue, Queues } from "./queue.js";
import {
  sendMail,
  tmplBillingArchived,
  tmplBillingPurgeReminder,
} from "./mail.js";
import { logEvent } from "./audit.js";

const DAY_MS = 86_400_000;
const REMINDER_LEAD_DAYS = 30;
// Pro Tick begrenzen, damit ein Sweeper-Lauf nicht zu lange blockiert.
const MAX_SUBS_PER_TICK = 25;
// Renditions pro Tenant und Tick — verteilt große Studios über mehrere Ticks.
const RENDITION_DROP_BATCH = 1000;

function addMonths(d: Date, months: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + months);
  return r;
}

/** Studio-Reaktivierungs-Link für die Mails. */
function reactivateUrl(): string {
  return `${config.PUBLIC_URL}/studio/settings/account`;
}

/**
 * Stufe 2 — Read-only → Archiv. Setzt archivedSince + purgeScheduledFor und
 * benachrichtigt die Owner. Galerien sind ab jetzt offline (Gate in der
 * Customer-Galerie-Route prüft archivedSince).
 */
export async function markDueArchives(): Promise<void> {
  const threshold = new Date(
    Date.now() - config.BILLING_ARCHIVE_AFTER_DAYS * DAY_MS
  );
  const subs = await prisma.billingSubscription.findMany({
    where: {
      archivedSince: null,
      readOnlySince: { not: null, lte: threshold },
      tenant: { status: "active" },
    },
    select: {
      tenantId: true,
      readOnlySince: true,
      tenant: {
        select: {
          name: true,
          users: {
            where: { role: "owner" },
            select: { email: true, name: true },
          },
        },
      },
    },
    take: MAX_SUBS_PER_TICK,
  });

  for (const s of subs) {
    try {
      const now = new Date();
      const purgeAt = addMonths(
        s.readOnlySince!,
        config.BILLING_PURGE_AFTER_MONTHS
      );
      await prisma.billingSubscription.update({
        where: { tenantId: s.tenantId },
        data: {
          archivedSince: now,
          purgeScheduledFor: purgeAt,
          archiveNoticeMailedAt: now,
        },
      });
      for (const o of s.tenant.users) {
        const tpl = tmplBillingArchived({
          displayName: o.name,
          studioName: s.tenant.name,
          purgeDate: purgeAt,
          reactivateUrl: reactivateUrl(),
        });
        await sendMail({ to: o.email, ...tpl });
      }
      await logEvent({
        tenantId: s.tenantId,
        actorType: "system",
        actorId: "sweeper",
        action: "tenant.billing_archived",
        targetType: "tenant",
        targetId: s.tenantId,
        payload: { purgeScheduledFor: purgeAt.toISOString() },
      });
      logger.info(
        { tenantId: s.tenantId, purgeAt },
        "billing-archive: tenant archived"
      );
    } catch (err) {
      logger.warn({ err, tenantId: s.tenantId }, "billing-archive: mark failed");
    }
  }
}

/**
 * Stufe 3 — Renditions archivierter Studios batchweise aus S3 entfernen.
 * Originale (File.storageKey) bleiben. Läuft jeden Tick weiter, bis für das
 * Studio keine Renditions mehr existieren.
 */
export async function dropArchivedDerivatives(): Promise<void> {
  const subs = await prisma.billingSubscription.findMany({
    where: { archivedSince: { not: null } },
    select: { tenantId: true },
    take: MAX_SUBS_PER_TICK,
  });

  for (const s of subs) {
    try {
      const rends = await prisma.rendition.findMany({
        where: { file: { gallery: { tenantId: s.tenantId } } },
        select: { id: true, storageKey: true },
        take: RENDITION_DROP_BATCH,
      });
      if (rends.length === 0) continue;

      for (const r of rends) {
        try {
          await deleteObject(r.storageKey);
        } catch (err) {
          logger.warn(
            { err, key: r.storageKey, tenantId: s.tenantId },
            "billing-archive: rendition s3 delete failed (continuing)"
          );
        }
      }
      await prisma.rendition.deleteMany({
        where: { id: { in: rends.map((r) => r.id) } },
      });
      logger.info(
        { tenantId: s.tenantId, dropped: rends.length },
        "billing-archive: dropped rendition batch"
      );
    } catch (err) {
      logger.warn(
        { err, tenantId: s.tenantId },
        "billing-archive: drop derivatives failed"
      );
    }
  }
}

/** Stufe 4 — Erinnerung ~30 Tage vor der endgültigen Löschung. */
export async function sendPurgeReminders(): Promise<void> {
  const now = new Date();
  const horizon = new Date(now.getTime() + REMINDER_LEAD_DAYS * DAY_MS);
  const subs = await prisma.billingSubscription.findMany({
    where: {
      archivedSince: { not: null },
      purgeReminderMailedAt: null,
      purgeScheduledFor: { not: null, lte: horizon, gt: now },
      tenant: { status: "active" },
    },
    select: {
      tenantId: true,
      purgeScheduledFor: true,
      tenant: {
        select: {
          name: true,
          users: {
            where: { role: "owner" },
            select: { email: true, name: true },
          },
        },
      },
    },
    take: MAX_SUBS_PER_TICK,
  });

  for (const s of subs) {
    try {
      for (const o of s.tenant.users) {
        const tpl = tmplBillingPurgeReminder({
          displayName: o.name,
          studioName: s.tenant.name,
          purgeDate: s.purgeScheduledFor!,
          reactivateUrl: reactivateUrl(),
        });
        await sendMail({ to: o.email, ...tpl });
      }
      await prisma.billingSubscription.update({
        where: { tenantId: s.tenantId },
        data: { purgeReminderMailedAt: new Date() },
      });
      logger.info(
        { tenantId: s.tenantId },
        "billing-archive: purge reminder sent"
      );
    } catch (err) {
      logger.warn(
        { err, tenantId: s.tenantId },
        "billing-archive: purge reminder failed"
      );
    }
  }
}

/** Stufe 5 — fällige Archive endgültig löschen. */
export async function purgeDueArchives(): Promise<void> {
  const due = await prisma.billingSubscription.findMany({
    where: {
      archivedSince: { not: null },
      purgeScheduledFor: { not: null, lte: new Date() },
      tenant: { status: "active" },
    },
    select: { tenantId: true },
    take: MAX_SUBS_PER_TICK,
  });
  if (due.length === 0) return;

  const { purgeArchivedTenant } = await import("./tenant-deletion.js");
  for (const s of due) {
    try {
      const r = await purgeArchivedTenant(s.tenantId);
      logger.info({ tenantId: s.tenantId, ...r }, "billing-archive: purge executed");
    } catch (err) {
      logger.warn({ err, tenantId: s.tenantId }, "billing-archive: purge failed");
    }
  }
}

/**
 * Reaktivierung: wird beim Recovery (neues/aktives Abo) aufgerufen. Wenn das
 * Studio archiviert war, Flags leeren und die Renditions neu erzeugen. No-op,
 * wenn nie archiviert wurde.
 */
export async function clearArchiveOnReactivation(
  tenantId: string
): Promise<void> {
  const sub = await prisma.billingSubscription.findUnique({
    where: { tenantId },
    select: { archivedSince: true },
  });
  if (!sub?.archivedSince) return;

  await prisma.billingSubscription.update({
    where: { tenantId },
    data: {
      archivedSince: null,
      purgeScheduledFor: null,
      archiveNoticeMailedAt: null,
      purgeReminderMailedAt: null,
    },
  });

  const queued = await enqueueRegeneration(tenantId);
  await logEvent({
    tenantId,
    actorType: "system",
    actorId: "billing",
    action: "tenant.reactivated_from_archive",
    targetType: "tenant",
    targetId: tenantId,
    payload: { filesQueued: queued },
  });
  logger.info(
    { tenantId, filesQueued: queued },
    "billing-archive: reactivated, regeneration enqueued"
  );
}

/**
 * Stellt die Renditions eines Studios wieder her, indem pro File ein
 * Verarbeitungs-Job über die BACKFILL-Queue eingereiht wird (blockiert keine
 * Live-Uploads). Originale liegen noch im Bucket — der Worker erzeugt
 * Thumbs/Vorschauen/Web daraus neu.
 */
async function enqueueRegeneration(tenantId: string): Promise<number> {
  const files = await prisma.file.findMany({
    where: { gallery: { tenantId }, status: { in: ["ready", "failed"] } },
    select: { id: true, kind: true, galleryId: true },
  });
  let n = 0;
  for (const f of files) {
    const isVideo = f.kind === "video";
    try {
      await enqueue(Queues.BACKFILL, {
        type: isVideo ? "process_video" : "process_file",
        fileId: f.id,
        tenantId,
        galleryId: f.galleryId,
      });
      n++;
    } catch (err) {
      logger.warn(
        { err, fileId: f.id, tenantId },
        "billing-archive: regen enqueue failed"
      );
    }
  }
  return n;
}
