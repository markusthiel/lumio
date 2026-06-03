/**
 * Lumio API — Self-Service Tenant Deletion
 *
 * DSGVO Art. 17: Owner kann sein Studio selbst loeschen.
 *
 * Drei Phasen:
 *
 * 1) requestDeletion(): Sofortige Massnahmen
 *    - status='pending_deletion' setzen + Timestamps + scheduledFor=now+60d
 *    - Stripe-Subscription sofort cancellen (keine weitere Abrechnung)
 *    - Audit-Log + Mail an Owner
 *    - Galerien bleiben erreichbar (Endkunden merken nichts), aber
 *      Studio-Login ist read-only (read-only-Plugin prueft status)
 *
 * 2) cancelDeletion(): User ueberlegt es sich anders waehrend Karenzphase
 *    - status='active', Timestamps clearen
 *    - Stripe-Subscription muss ggf. NEU gestartet werden (manuell durch
 *      User via Billing-Portal); wir versuchen NICHT, die alte zu
 *      reaktivieren — das wird in Stripe schnell unsauber
 *    - Audit-Log + Mail an Owner
 *
 * 3) executeHardDeletion(): vom Sweeper getriggert, wenn scheduledFor<=now
 *    - Alle Files aus S3 loeschen (best-effort, batch)
 *    - DB: Tenant.delete() loescht via Prisma-Cascade alle abhaengigen
 *      Records (User, Gallery, File, Branding, Subscription, ...)
 *    - Stripe-Customer NICHT loeschen (Audit-Trail), nur loggen
 *    - Final-Bestaetigungs-Mail an die Owner-Adresse, BEVOR der User
 *      geloescht wird — sonst koennen wir die Adresse nicht mehr lesen
 *    - Audit-Log auf Super-Admin-Ebene
 *
 * Idempotenz:
 * Alle drei Funktionen sind idempotent. requestDeletion auf einen
 * bereits pending_deletion-Tenant ist no-op (returnt aktuellen Status).
 * cancelDeletion auf einen active-Tenant ist no-op. executeHardDeletion
 * pruef vor dem Loeschen ob der Tenant noch existiert.
 */
import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { logEvent } from "./audit.js";
import { cancelSubscriptionImmediately } from "./stripe-service.js";
import { deleteObject } from "./storage.js";
import { sendMail } from "./mail.js";
import {
  tmplDeletionRequested,
  tmplDeletionCancelled,
  tmplDeletionExecuted,
} from "./mail.js";
import { config } from "../config.js";

/** Karenzphase zwischen Anfrage und Hard-Delete in Tagen.
 *  Vorgegeben durch die DSGVO-Marketing-Page-FAQ — wenn das hier
 *  geaendert wird, dort auch nachziehen. */
export const SELF_DELETION_GRACE_DAYS = 60;

/**
 * Loeschung anfordern. Sofortige Effekte: status-Wechsel, Stripe-
 * Cancel, Mail. Die Daten bleiben aber bis scheduledFor erhalten.
 */
export async function requestDeletion(opts: {
  tenantId: string;
  requestedById: string;
  ipAddress?: string;
}): Promise<{
  status: "scheduled" | "already_pending";
  scheduledFor: Date;
}> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: opts.tenantId },
    select: {
      id: true,
      name: true,
      status: true,
      selfDeletionScheduledFor: true,
    },
  });
  if (!tenant) {
    throw new Error(`tenant ${opts.tenantId} not found`);
  }

  // Idempotenz: schon pending → einfach aktuellen Stand zurueck.
  if (tenant.status === "pending_deletion" && tenant.selfDeletionScheduledFor) {
    return {
      status: "already_pending",
      scheduledFor: tenant.selfDeletionScheduledFor,
    };
  }

  const now = new Date();
  const scheduledFor = new Date(
    now.getTime() + SELF_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000
  );

  await prisma.tenant.update({
    where: { id: opts.tenantId },
    data: {
      status: "pending_deletion",
      selfDeletionRequestedAt: now,
      selfDeletionRequestedById: opts.requestedById,
      selfDeletionScheduledFor: scheduledFor,
      selfDeletionReminderMailedAt: null, // falls vorher mal gesetzt
    },
  });

  // Stripe-Subscription sofort cancellen — der User soll nicht
  // ueber Karenzphase weiter belastet werden.
  const stripeResult = await cancelSubscriptionImmediately(opts.tenantId).catch(
    (err) => {
      // Defensiv: wenn Stripe-Cancel scheitert, soll das den
      // Deletion-Request NICHT killen. User-Wunsch ist wichtiger
      // als Billing-Cleanup; Super-Admin kann manuell nachziehen.
      logger.warn(
        { err, tenantId: opts.tenantId },
        "stripe cancel failed during self-deletion request"
      );
      return { canceled: false, reason: "error" as const };
    }
  );

  await logEvent({
    tenantId: opts.tenantId,
    actorType: "user",
    actorId: opts.requestedById,
    action: "tenant.self_deletion_requested",
    targetType: "tenant",
    targetId: opts.tenantId,
    payload: {
      scheduledFor: scheduledFor.toISOString(),
      stripeCancel: stripeResult,
    },
    ipAddress: opts.ipAddress,
  });

  // Bestaetigungs-Mail an alle Owner des Tenants (kann mehrere geben).
  void notifyAllOwners(opts.tenantId, "requested", {
    studioName: tenant.name,
    scheduledFor,
  });

  return { status: "scheduled", scheduledFor };
}

/**
 * Loeschung zuruecknehmen (Reaktivierung). Setzt alle self-deletion-
 * Felder zurueck und Status auf active. Stripe-Subscription wird
 * NICHT automatisch reaktiviert — der User muss sich neu Plan + Karte
 * im Studio-Billing aussuchen.
 */
export async function cancelDeletion(opts: {
  tenantId: string;
  cancelledById: string;
  /** "user" = Owner hat selbst zurueck genommen (Standardfall).
   *  "super_admin" = Cloud-Admin/Support hat manuell zurueckgenommen
   *  weil der Owner sich z.B. nicht einloggen konnte. */
  actorType?: "user" | "super_admin";
  ipAddress?: string;
}): Promise<{ status: "reactivated" | "not_pending" }> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: opts.tenantId },
    select: { id: true, name: true, status: true },
  });
  if (!tenant) {
    throw new Error(`tenant ${opts.tenantId} not found`);
  }

  if (tenant.status !== "pending_deletion") {
    return { status: "not_pending" };
  }

  await prisma.tenant.update({
    where: { id: opts.tenantId },
    data: {
      status: "active",
      selfDeletionRequestedAt: null,
      selfDeletionRequestedById: null,
      selfDeletionScheduledFor: null,
      selfDeletionReminderMailedAt: null,
    },
  });

  await logEvent({
    tenantId: opts.tenantId,
    actorType: opts.actorType ?? "user",
    actorId: opts.cancelledById,
    action:
      opts.actorType === "super_admin"
        ? "super.tenant.deletion_cancelled"
        : "tenant.self_deletion_cancelled",
    targetType: "tenant",
    targetId: opts.tenantId,
    payload: {},
    ipAddress: opts.ipAddress,
  });

  void notifyAllOwners(opts.tenantId, "cancelled", {
    studioName: tenant.name,
  });

  return { status: "reactivated" };
}

/**
 * Hard-Delete-Phase. NICHT direkt von Routen aufrufen — nur vom
 * Sweeper, wenn scheduledFor erreicht ist.
 *
 * Reihenfolge ist wichtig:
 *   1. Alle Files im S3 sammeln (vor DB-Delete sonst keine Keys mehr)
 *   2. Mail an Owner schicken (mit gemerkte E-Mail-Adressen, bevor
 *      die User-Records weg sind)
 *   3. S3-Delete (best-effort, fail-tolerant)
 *   4. DB-Delete (Cascade durch Prisma-Schema)
 *   5. Audit-Log mit "tenant.self_deletion_executed"
 *
 * S3-Delete-Failures stoppen den DB-Delete NICHT — sonst haetten wir
 * dangling Files im Storage UND einen Tenant der nicht weg geht. Wir
 * loggen aber pro-Key fehler damit Super-Admin manuell aufraeumen kann.
 */
export async function executeHardDeletion(tenantId: string): Promise<{
  status: "deleted" | "skipped";
  reason?: string;
  filesDeleted: number;
  filesFailed: number;
}> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      status: true,
      selfDeletionScheduledFor: true,
      stripeCustomerId: true,
      users: {
        where: { role: "owner" },
        select: { email: true, name: true },
      },
    },
  });

  if (!tenant) {
    return { status: "skipped", reason: "not_found", filesDeleted: 0, filesFailed: 0 };
  }
  if (tenant.status !== "pending_deletion") {
    return {
      status: "skipped",
      reason: `unexpected_status:${tenant.status}`,
      filesDeleted: 0,
      filesFailed: 0,
    };
  }
  if (
    !tenant.selfDeletionScheduledFor ||
    tenant.selfDeletionScheduledFor > new Date()
  ) {
    return {
      status: "skipped",
      reason: "not_yet_scheduled",
      filesDeleted: 0,
      filesFailed: 0,
    };
  }

  logger.info(
    { tenantId, studioName: tenant.name },
    "hard-delete: starting self-deletion execution"
  );

  // 1. Mail-Empfaenger sammeln (BEVOR User-Records weg sind)
  const ownerEmails = tenant.users
    .map((u) => u.email)
    .filter((e): e is string => Boolean(e));

  // 2. Mails schicken
  for (const email of ownerEmails) {
    const tpl = tmplDeletionExecuted({ studioName: tenant.name });
    await sendMail({ to: email, ...tpl });
  }

  // 3. Alle Files des Tenants sammeln
  const files = await prisma.file.findMany({
    where: { gallery: { tenantId } },
    select: {
      storageKey: true,
      renditions: { select: { storageKey: true } },
    },
  });

  // 4. S3-Delete batch — Originals + Renditions
  let filesDeleted = 0;
  let filesFailed = 0;
  for (const file of files) {
    const keys = [file.storageKey, ...file.renditions.map((r) => r.storageKey)];
    for (const key of keys) {
      try {
        await deleteObject(key);
        filesDeleted++;
      } catch (err) {
        filesFailed++;
        logger.warn(
          { err, key, tenantId },
          "hard-delete: s3 delete failed (continuing)"
        );
      }
    }
  }

  // 5. Watermark-Image aus S3 (wenn als Key gespeichert)
  const tenantWatermark = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { watermarkImageKey: true },
  });
  if (tenantWatermark?.watermarkImageKey) {
    try {
      await deleteObject(tenantWatermark.watermarkImageKey);
      filesDeleted++;
    } catch (err) {
      filesFailed++;
      logger.warn({ err, key: tenantWatermark.watermarkImageKey, tenantId }, "hard-delete: watermark s3 delete failed");
    }
  }
  // Hinweis: Branding-Logos sind als URLs gespeichert, nicht als
  // direkte S3-Keys — die parsen wir nicht zurueck. Bei Bedarf
  // raeumt Super-Admin im Storage manuell auf. Logos sind klein und
  // selten, Volumen-Risiko fast null.

  // 6. DB-Cascade-Delete. Prisma-Schema definiert onDelete: Cascade
  //    auf den FK-Relationen, also reicht prisma.tenant.delete()
  await prisma.tenant.delete({ where: { id: tenantId } });

  // 7. Audit-Log (Super-Admin-Ebene, weil tenantId nicht mehr existiert)
  await logEvent({
    tenantId: null, // global event nach Delete
    actorType: "system",
    actorId: "sweeper",
    action: "tenant.self_deletion_executed",
    targetType: "tenant",
    targetId: tenantId,
    payload: {
      studioName: tenant.name,
      filesDeleted,
      filesFailed,
      stripeCustomerId: tenant.stripeCustomerId,
      ownerEmailsNotified: ownerEmails.length,
    },
  });

  logger.info(
    { tenantId, filesDeleted, filesFailed },
    "hard-delete: self-deletion completed"
  );

  return { status: "deleted", filesDeleted, filesFailed };
}

/**
 * Helper: Mail an alle Owner eines Tenants. Wird sowohl bei
 * requestDeletion als auch cancelDeletion verwendet.
 */
async function notifyAllOwners(
  tenantId: string,
  kind: "requested" | "cancelled",
  opts: { studioName: string; scheduledFor?: Date }
): Promise<void> {
  try {
    const owners = await prisma.user.findMany({
      where: { tenantId, role: "owner" },
      select: { email: true, name: true },
    });

    for (const owner of owners) {
      const tpl =
        kind === "requested"
          ? tmplDeletionRequested({
              displayName: owner.name,
              studioName: opts.studioName,
              scheduledFor: opts.scheduledFor!,
              cancelUrl: `${config.PUBLIC_URL}/studio/settings/account`,
            })
          : tmplDeletionCancelled({
              displayName: owner.name,
              studioName: opts.studioName,
            });
      await sendMail({ to: owner.email, ...tpl });
    }
  } catch (err) {
    logger.warn(
      { err, tenantId, kind },
      "notifyAllOwners failed (not critical, deletion state already updated)"
    );
  }
}

/**
 * Billing-Archiv-Purge — endgültige Löschung eines archivierten Studios nach
 * Ablauf der Aufbewahrungsfrist (BillingSubscription.purgeScheduledFor).
 *
 * Anders als executeHardDeletion (Owner-Self-Deletion) ist hier KEINE
 * pending_deletion-Karenz im Spiel: Der Tenant ist regulär 'active', nur sein
 * Abo ist seit langem inaktiv. Der Lösch-Kern (S3 + Cascade + Mail + Audit)
 * ist bewusst identisch zu executeHardDeletion gehalten — bei Änderungen an
 * der Lösch-Logik BEIDE Stellen anpassen.
 */
export async function purgeArchivedTenant(tenantId: string): Promise<{
  status: "deleted" | "skipped";
  reason?: string;
  filesDeleted: number;
  filesFailed: number;
}> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      status: true,
      stripeCustomerId: true,
      users: {
        where: { role: "owner" },
        select: { email: true, name: true },
      },
    },
  });

  if (!tenant) {
    return { status: "skipped", reason: "not_found", filesDeleted: 0, filesFailed: 0 };
  }
  // Nur reguläre Tenants über diesen Pfad löschen. suspended/archived
  // (Super-Admin) und pending_deletion (Self-Deletion) haben eigene Pfade.
  if (tenant.status !== "active") {
    return {
      status: "skipped",
      reason: `unexpected_status:${tenant.status}`,
      filesDeleted: 0,
      filesFailed: 0,
    };
  }

  logger.info(
    { tenantId, studioName: tenant.name },
    "billing-purge: starting archived-tenant deletion"
  );

  const ownerEmails = tenant.users
    .map((u) => u.email)
    .filter((e): e is string => Boolean(e));
  for (const email of ownerEmails) {
    try {
      const tpl = tmplDeletionExecuted({ studioName: tenant.name });
      await sendMail({ to: email, ...tpl });
    } catch (err) {
      logger.warn({ err, tenantId }, "billing-purge: executed-mail failed (continuing)");
    }
  }

  const files = await prisma.file.findMany({
    where: { gallery: { tenantId } },
    select: {
      storageKey: true,
      renditions: { select: { storageKey: true } },
    },
  });
  let filesDeleted = 0;
  let filesFailed = 0;
  for (const file of files) {
    const keys = [file.storageKey, ...file.renditions.map((r) => r.storageKey)];
    for (const key of keys) {
      try {
        await deleteObject(key);
        filesDeleted++;
      } catch (err) {
        filesFailed++;
        logger.warn({ err, key, tenantId }, "billing-purge: s3 delete failed (continuing)");
      }
    }
  }

  const tenantWatermark = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { watermarkImageKey: true },
  });
  if (tenantWatermark?.watermarkImageKey) {
    try {
      await deleteObject(tenantWatermark.watermarkImageKey);
      filesDeleted++;
    } catch (err) {
      filesFailed++;
      logger.warn({ err, tenantId }, "billing-purge: watermark s3 delete failed");
    }
  }

  await prisma.tenant.delete({ where: { id: tenantId } });

  await logEvent({
    tenantId: null,
    actorType: "system",
    actorId: "sweeper",
    action: "tenant.billing_purge_executed",
    targetType: "tenant",
    targetId: tenantId,
    payload: {
      studioName: tenant.name,
      filesDeleted,
      filesFailed,
      stripeCustomerId: tenant.stripeCustomerId,
      ownerEmailsNotified: ownerEmails.length,
    },
  });

  logger.info({ tenantId, filesDeleted, filesFailed }, "billing-purge: completed");
  return { status: "deleted", filesDeleted, filesFailed };
}
