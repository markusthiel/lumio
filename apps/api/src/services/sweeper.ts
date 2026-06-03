/**
 * Lumio API — Periodic Sweeper
 *
 * Triggert in regelmäßigen Abständen periodische Aufgaben:
 *
 *   - cleanup_expired_exports: alle 6h. Worker-Job, räumt
 *     TenantExports mit expiresAt < now + zugehörige S3-ZIPs.
 *
 *   - pre-archive reminders: alle 6h. Schickt 7-Tage-Reminder-Mails
 *     an Tenants, deren archiveScheduledAt nahe ist, und benachrichtigt
 *     Super-Admins wenn das Datum erreicht ist (manueller Archive-
 *     Schritt erforderlich).
 *
 *   - storage_recalc: alle 6h. Aggregiert files+renditions pro Tenant
 *     und schreibt die Summe in BillingSubscription.storageBytesUsed.
 *     Wird für Super-Admin-Storage-View und Capacity-Planning gebraucht.
 *     Limit-Checks im Studio gehen weiter live über computeStorageBytes().
 *
 * Warum hier und nicht im Worker selbst: der Worker hat keinen
 * eingebauten Scheduler (kein Celery-Beat-Container). Die API läuft
 * als langlebiger Prozess und kann das easy übernehmen. Bei
 * mehreren API-Instances feuern alle den Trigger — Cleanup-Worker
 * ist idempotent. Reminder-Mail nutzt archiveReminderMailedAt als
 * Sperre damit nicht mehrfach gemailed wird (Race ist möglich aber
 * unwahrscheinlich; im Worst-Case schickt's ein paar Sekunden später
 * eine zweite Mail).
 */
import { enqueue, Queues } from "./queue.js";
import { prisma } from "../db.js";
import { sendMail } from "./mail.js";
import { logEvent } from "./audit.js";
import { writeMrrSnapshot } from "./mrr.js";
import { processBroadcast } from "./broadcast.js";
import { computeStorageBytes } from "./usage.js";
import { logger } from "../logger.js";
import { config } from "../config.js";
import {
  markDueArchives,
  dropArchivedDerivatives,
  sendPurgeReminders,
  purgeDueArchives,
} from "./billing-archive.js";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 30_000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

let _interval: NodeJS.Timeout | null = null;

async function runOnce() {
  await Promise.allSettled([
    triggerExpiredExportsCleanup(),
    sendPreArchiveReminders(),
    notifyArchiveScheduleReached(),
    // Self-Service-Tenant-Loeschung
    sendSelfDeletionReminders(),
    executeScheduledSelfDeletions(),
    // Tagesschnappschuss der MRR (idempotent via UNIQUE-Index auf
    // mrr_snapshots.date — mehrfache Calls am gleichen Tag schreiben
    // das gleiche Tagesdatum mit aktualisierten Werten via upsert).
    writeMrrSnapshot(),
    // Broadcast-Resume: nach Process-Crashes koennen Broadcasts in
    // 'pending' (noch nie gestartet) oder 'sending' mit stale
    // lastProgressAt haengen geblieben sein. Beide aufgreifen und neu
    // starten — processBroadcast ist idempotent durch Counter-Increment.
    resumeStuckBroadcasts(),
    // Storage-Verbrauch pro Tenant in BillingSubscription.storageBytesUsed
    // schreiben — wird für Super-Admin-Storage-View und Capacity-Planning
    // gebraucht. Studio-UI nutzt computeStorageBytes() live, also für die
    // Limit-Checks ist Drift unkritisch.
    recalculateStorageUsage(),
    // Billing-Archiv-Lifecycle (nur SaaS): Read-only → Archiv → Löschung.
    ...(config.BILLING_ENABLED
      ? [
          markDueArchives(),
          dropArchivedDerivatives(),
          sendPurgeReminders(),
          purgeDueArchives(),
        ]
      : []),
  ]);
}

async function resumeStuckBroadcasts() {
  try {
    const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);
    const stuck = await prisma.broadcast.findMany({
      where: {
        OR: [
          { status: "pending" },
          {
            status: "sending",
            OR: [
              { lastProgressAt: null },
              { lastProgressAt: { lt: staleThreshold } },
            ],
          },
        ],
      },
      select: { id: true, status: true, lastProgressAt: true },
      take: 5, // pro Run nur eine kleine Charge
    });
    for (const b of stuck) {
      logger.info({ broadcastId: b.id, status: b.status }, "broadcast resume");
      setImmediate(() => {
        processBroadcast(b.id).catch((err) => {
          logger.warn({ err, broadcastId: b.id }, "broadcast resume crashed");
        });
      });
    }
  } catch (err) {
    logger.warn({ err }, "resumeStuckBroadcasts failed");
  }
}

async function triggerExpiredExportsCleanup() {
  try {
    await enqueue(Queues.CLEANUP, {
      type: "cleanup_expired_exports",
    });
    logger.info("sweeper.enqueued cleanup_expired_exports");
  } catch (err) {
    logger.warn({ err }, "sweeper.cleanup_enqueue_failed");
  }
}

/**
 * Storage-Verbrauch pro Tenant neu berechnen und in
 * BillingSubscription.storageBytesUsed schreiben.
 *
 * Die canonical Wahrheit für Limit-Checks ist computeStorageBytes() live;
 * dieser Job aktualisiert nur das "gecachte" Feld für Dashboards (Super-
 * Admin-Storage-View, Capacity-Planning, Up-Selling-Reports). Drift ist
 * dort tolerierbar — der Wert ist "recent enough".
 *
 * Fehler pro Tenant werden geloggt aber nicht propagiert: ein einzelner
 * Outlier soll nicht alle anderen Tenants blockieren.
 */
async function recalculateStorageUsage() {
  try {
    const tenants = await prisma.tenant.findMany({
      where: {
        status: { not: "archived" },
        subscription: { isNot: null },
      },
      select: { id: true },
    });

    let updated = 0;
    let failed = 0;
    for (const t of tenants) {
      try {
        const breakdown = await computeStorageBytes(t.id);
        const total = breakdown.originalsBytes + breakdown.renditionsBytes;
        await prisma.billingSubscription.update({
          where: { tenantId: t.id },
          data: { storageBytesUsed: total },
        });
        updated++;
      } catch (err) {
        failed++;
        logger.warn(
          { err, tenantId: t.id },
          "sweeper.storage_recalc.tenant_failed"
        );
      }
    }
    logger.info(
      { updated, failed, total: tenants.length },
      "sweeper.storage_recalc.done"
    );
  } catch (err) {
    logger.warn({ err }, "sweeper.storage_recalc.failed");
  }
}

/** 7-Tage-Reminder-Mails an aktive Owner schicken, deren Tenant
 *  eine Archivierung in <= 7 Tagen geplant hat und noch keine
 *  Reminder bekommen hat. */
async function sendPreArchiveReminders() {
  const reminderThreshold = new Date(Date.now() + SEVEN_DAYS_MS);
  const tenants = await prisma.tenant.findMany({
    where: {
      status: "active",
      archiveScheduledAt: {
        not: null,
        lte: reminderThreshold,
        // nur Reminder schicken solange der Stichtag in der Zukunft
        // ist. Wenn er schon vorbei ist, läuft das durch
        // notifyArchiveScheduleReached.
        gt: new Date(),
      },
      archiveReminderMailedAt: null,
    },
    include: {
      users: {
        where: { role: "owner", status: "active" },
        select: { id: true, email: true, name: true },
      },
    },
  });

  for (const t of tenants) {
    if (!t.archiveScheduledAt) continue;
    const formattedDate = t.archiveScheduledAt.toLocaleDateString("de-DE", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const daysLeft = Math.ceil(
      (t.archiveScheduledAt.getTime() - Date.now()) / ONE_DAY_MS
    );
    let mailsSent = 0;
    for (const owner of t.users) {
      try {
        await sendMail({
          to: owner.email,
          subject: `Erinnerung: Ihr Lumio-Konto „${t.name}" wird in ${daysLeft} Tagen archiviert`,
          text:
            `Hallo ${owner.name ?? owner.email},\n\n` +
            `dies ist eine Erinnerung: Ihr Lumio-Konto „${t.name}" wird ` +
            `am ${formattedDate} archiviert (in ${daysLeft} Tagen).\n\n` +
            `Falls Sie Ihre Daten noch herunterladen möchten, loggen Sie ` +
            `sich bitte zeitnah ein und nutzen Sie die Sidebar → ` +
            `"Datenexport". Pro Galerie wird ein ZIP-Archiv mit Originalen ` +
            `und Metadaten erstellt.\n\n` +
            `Nach der Archivierung können Sie sich nicht mehr einloggen. ` +
            `Ein direkter Download-Link wird Ihnen dann automatisch per ` +
            `Mail zugeschickt (30 Tage gültig), aber der Self-Service-Export ` +
            `im Studio ist ab dann nicht mehr verfügbar.\n\n` +
            `Falls die Archivierung nicht wie geplant erfolgen soll, ` +
            `antworten Sie bitte zeitnah auf diese Mail.\n\n— Lumio`,
        });
        mailsSent++;
      } catch (err) {
        logger.warn(
          { err, ownerId: owner.id, tenantId: t.id },
          "sweeper.reminder_mail_failed"
        );
      }
    }
    if (mailsSent > 0) {
      await prisma.tenant.update({
        where: { id: t.id },
        data: { archiveReminderMailedAt: new Date() },
      });
      await logEvent({
        tenantId: t.id,
        actorType: "system",
        actorId: null,
        action: "tenant.archive_reminder_sent",
        targetType: "tenant",
        targetId: t.id,
        payload: {
          scheduledAt: t.archiveScheduledAt,
          daysLeft,
          mailsSent,
          ownersTotal: t.users.length,
        },
      });
      logger.info(
        { tenantId: t.id, mailsSent, daysLeft },
        "sweeper.reminder_sent"
      );
    }
  }
}

/** Wenn ein Tenant das Schedule-Datum erreicht hat: Audit-Log-Eintrag
 *  als "manueller Archive-Schritt erforderlich". Das Studio-UI im
 *  Super-Admin sieht den Status auch direkt am Tenant-Detail. Wir
 *  loggen einmal pro Sweeper-Run und akzeptieren dass das alle 6h
 *  passiert solange der Super-Admin nicht archiviert — das ist
 *  eher Feature (erinnert kontinuierlich) als Bug. */
async function notifyArchiveScheduleReached() {
  const tenants = await prisma.tenant.findMany({
    where: {
      status: "active",
      archiveScheduledAt: { not: null, lte: new Date() },
    },
    select: { id: true, name: true, slug: true, archiveScheduledAt: true },
  });
  for (const t of tenants) {
    await logEvent({
      tenantId: t.id,
      actorType: "system",
      actorId: null,
      action: "tenant.archive_schedule_reached",
      targetType: "tenant",
      targetId: t.id,
      payload: {
        scheduledAt: t.archiveScheduledAt,
      },
    });
    logger.info(
      { tenantId: t.id, name: t.name },
      "sweeper.archive_schedule_reached (super-admin action required)"
    );
  }
}

export function startPeriodicSweeper() {
  if (_interval) return;
  // Erster Run mit kurzer Verzögerung — damit der API-Boot nicht
  // sofort von Queue-Calls überschwemmt wird falls Redis langsam ist.
  setTimeout(() => {
    void runOnce();
  }, STARTUP_DELAY_MS);
  // Danach alle 6 Stunden.
  _interval = setInterval(() => {
    void runOnce();
  }, SIX_HOURS_MS);
  logger.info(
    { intervalMs: SIX_HOURS_MS, startupDelayMs: STARTUP_DELAY_MS },
    "sweeper.started"
  );
}

export function stopPeriodicSweeper() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}

// ---------------------------------------------------------------------------
// Self-Service Tenant-Loeschung — Sweeper-Tasks
// ---------------------------------------------------------------------------

/**
 * 7-Tage-Reminder vor dem Hard-Delete. Sucht Tenants mit
 * selfDeletionScheduledFor <= now+7d und ohne bisherigen Reminder,
 * schickt eine "letzte Chance"-Mail. Sperre via selfDeletionReminderMailedAt.
 */
async function sendSelfDeletionReminders() {
  const sevenDaysFromNow = new Date(Date.now() + SEVEN_DAYS_MS);
  const tenants = await prisma.tenant.findMany({
    where: {
      status: "pending_deletion",
      selfDeletionScheduledFor: {
        not: null,
        lte: sevenDaysFromNow,
        gt: new Date(), // noch nicht faellig (= noch in Karenz)
      },
      selfDeletionReminderMailedAt: null,
    },
    select: {
      id: true,
      name: true,
      selfDeletionScheduledFor: true,
      users: {
        where: { role: "owner" },
        select: { email: true, name: true },
      },
    },
  });

  // Lazy-Import um Circular Deps zu vermeiden — sweeper -> mail -> sweeper
  const { tmplDeletionReminder } = await import("./mail.js");
  const { config } = await import("../config.js");

  for (const t of tenants) {
    try {
      const cancelUrl = `${config.PUBLIC_URL}/studio/settings/account`;
      for (const owner of t.users) {
        const tpl = tmplDeletionReminder({
          displayName: owner.name,
          studioName: t.name,
          scheduledFor: t.selfDeletionScheduledFor!,
          cancelUrl,
        });
        await sendMail({ to: owner.email, ...tpl });
      }
      await prisma.tenant.update({
        where: { id: t.id },
        data: { selfDeletionReminderMailedAt: new Date() },
      });
      logger.info(
        { tenantId: t.id, mailedCount: t.users.length },
        "sweeper.self_deletion_reminder_sent"
      );
    } catch (err) {
      logger.warn({ err, tenantId: t.id }, "sweeper.self_deletion_reminder_failed");
    }
  }
}

/**
 * Hard-Delete-Phase. Sucht Tenants mit faelligem selfDeletionScheduledFor
 * und executet die Loeschung. Sequenziell (nicht parallel) damit
 * S3-API-Limits nicht ueberlaufen — bei vielen pending Tenants kann
 * das eine Weile dauern, ist aber OK.
 */
async function executeScheduledSelfDeletions() {
  const due = await prisma.tenant.findMany({
    where: {
      status: "pending_deletion",
      selfDeletionScheduledFor: {
        not: null,
        lte: new Date(),
      },
    },
    select: { id: true, name: true },
  });

  if (due.length === 0) return;
  logger.info({ count: due.length }, "sweeper.executing_self_deletions");

  const { executeHardDeletion } = await import("./tenant-deletion.js");

  for (const t of due) {
    try {
      const result = await executeHardDeletion(t.id);
      logger.info(
        { tenantId: t.id, studioName: t.name, ...result },
        "sweeper.self_deletion_executed"
      );
    } catch (err) {
      // Single tenant scheitert → die anderen weitermachen
      logger.error(
        { err, tenantId: t.id, studioName: t.name },
        "sweeper.self_deletion_failed"
      );
    }
  }
}
