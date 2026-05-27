/**
 * Lumio API — Super-Admin Tenant Management
 *
 * Routes zum Verwalten von Tenants und ihren Owner-Accounts. Alle
 * brauchen einen eingeloggten Super-Admin (request.requireSuperAdmin).
 *
 *   GET    /super/tenants                — Liste aller Tenants
 *   POST   /super/tenants                — Tenant + Owner anlegen (mit Setup-Mail)
 *   GET    /super/tenants/:id            — Detail (inkl. Owner-Liste + Counts)
 *   PATCH  /super/tenants/:id            — Name / Custom-Domain ändern
 *   POST   /super/tenants/:id/suspend    — Status active → suspended
 *   POST   /super/tenants/:id/unsuspend  — Status suspended → active
 *   POST   /super/tenants/:id/schedule-archive  — Archive im Voraus planen
 *                                                 (Mail an Owner + Studio-Banner)
 *   DELETE /super/tenants/:id/schedule-archive  — Plan zurückziehen
 *   POST   /super/tenants/:id/archive    — Status → archived + Stripe-Cancel
 *                                          (setzt archivedAt für Karenz)
 *   DELETE /super/tenants/:id            — Hard-Delete (nach 30 Tage Karenz)
 *                                          + Worker-Cleanup für S3
 *   POST   /super/tenants/:id/owners     — weiteren Owner hinzufügen (Setup-Mail)
 *
 *   GET    /super/stats                  — globale Übersicht (Anzahl Tenants/Gallerys/Files)
 *
 * Was bewusst NICHT hier ist:
 *   - Cross-Tenant-Suche / -Lesen von Galerien-Inhalten. Super-Admin
 *     soll nicht in fremden Kunden-Galerien rumschauen können —
 *     darüber gibt es kein Endpoint. Wenn nötig: per CLI mit
 *     Begründung im Audit, nicht per UI-Klick.
 *   - Passwort-Reset eines Owners — wenn der Owner-Login klemmt,
 *     legt der Super-Admin einen neuen Setup-Token an (separater
 *     Endpoint später; aktuell: Owner muss "Passwort vergessen" über
 *     den normalen Flow nutzen, sobald der gebaut ist).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { config } from "../config.js";
import { hashPassword } from "../services/auth.js";
import { createSetupToken, buildSetupUrl } from "../services/setupToken.js";
import { logEvent } from "../services/audit.js";
import { sendMail, tmplOwnerSetup } from "../services/mail.js";
import { cancelSubscriptionImmediately } from "../services/stripe-service.js";
import { enqueue, Queues } from "../services/queue.js";
import { createExport } from "../services/export-service.js";
import { cancelDeletion } from "../services/tenant-deletion.js";
import { logger } from "../logger.js";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

// Reservierte Subdomains die kein Tenant als Slug nutzen darf. MUSS
// synchron bleiben mit RESERVED_SUBDOMAINS in plugins/auth.ts und im
// Frontend app/page.tsx (Apex-Erkennung).
const RESERVED_SLUGS = new Set(["www", "studio", "api", "admin", "app"]);

const slugSchema = z
  .string()
  .min(2)
  .max(40)
  .regex(SLUG_RE, "slug must be lowercase letters, digits, hyphens")
  .refine(
    (s) => !RESERVED_SLUGS.has(s),
    (s) => ({
      message: `slug "${s}" is reserved (used for system hosts like studio.<domain>)`,
    })
  );

const createTenantSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1).max(120),
  // Oeffentlicher Anzeigename (optional). Wenn weggelassen oder leer,
  // wird auf 'name' zurueckgegriffen. Super-Admin kann den Wert beim
  // Anlegen setzen; spaeter pflegt der Owner ihn selbst im Studio.
  displayName: z
    .string()
    .max(120)
    .nullable()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : null)),
  customDomain: z
    .string()
    .max(200)
    .nullable()
    .optional()
    .transform((v) => (v ? v.trim().toLowerCase() : null)),
  ownerEmail: z.string().email().max(200),
  ownerName: z.string().min(1).max(120),
});

const updateTenantSchema = z.object({
  slug: slugSchema.optional(),
  name: z.string().min(1).max(120).optional(),
  displayName: z
    .string()
    .max(120)
    .nullable()
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined; // nicht geaendert
      if (v === null) return null; // explizit geloescht
      const trimmed = v.trim();
      return trimmed ? trimmed : null;
    }),
  customDomain: z
    .string()
    .max(200)
    .nullable()
    .optional()
    .transform((v) => (v === undefined || v === null ? v : v.trim().toLowerCase() || null)),
});

const addOwnerSchema = z.object({
  email: z.string().email().max(200),
  name: z.string().min(1).max(120),
});

export async function registerSuperTenantRoutes(app: FastifyInstance) {
  // Gate: alle Routes hier brauchen einen Super-Admin.
  app.addHook("preHandler", async (req) => {
    req.requireSuperAdmin();
  });

  // -------------------------------------------------------------------------
  // GET /super/tenants
  // -------------------------------------------------------------------------
  app.get("/super/tenants", async () => {
    const tenants = await prisma.tenant.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        slug: true,
        name: true,
        displayName: true,
        status: true,
        customDomain: true,
        createdAt: true,
        _count: {
          select: { users: true, galleries: true },
        },
      },
    });
    return {
      tenants: tenants.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        displayName: t.displayName,
        status: t.status,
        customDomain: t.customDomain,
        createdAt: t.createdAt,
        userCount: t._count.users,
        galleryCount: t._count.galleries,
      })),
    };
  });

  // -------------------------------------------------------------------------
  // POST /super/tenants — Tenant + initialer Owner mit Setup-Mail
  // -------------------------------------------------------------------------
  app.post("/super/tenants", async (req, reply) => {
    const sa = req.requireSuperAdmin();
    const body = createTenantSchema.parse(req.body);

    // Slug-Konflikt?
    const slugExists = await prisma.tenant.findUnique({
      where: { slug: body.slug },
      select: { id: true },
    });
    if (slugExists) {
      return reply.status(409).send({ error: "slug_taken" });
    }
    if (body.customDomain) {
      const domainExists = await prisma.tenant.findFirst({
        where: { customDomain: body.customDomain },
        select: { id: true },
      });
      if (domainExists) {
        return reply.status(409).send({ error: "domain_taken" });
      }
    }

    // Owner-E-Mail darf in diesem Tenant nicht existieren — aber wir
    // legen den Tenant gerade erst an, also kann es nichts geben. Wir
    // prüfen sicherheitshalber tenant-global (manche Owner haben mehrere
    // Tenants mit derselben Mail; das ist OK weil unique(tenantId,email),
    // nicht global unique).
    //
    // Transaktion: tenant + user + token gemeinsam, damit nichts halb
    // entsteht. Bei Mail-Fehler später ist der DB-State trotzdem
    // konsistent.
    const inviteToken = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          slug: body.slug,
          name: body.name,
          displayName: body.displayName ?? null,
          status: "active",
          customDomain: body.customDomain ?? null,
        },
      });

      // Owner-User mit Placeholder-Passwort. Status "invited" verhindert
      // Login bis der Setup-Token eingelöst wurde (siehe Login-Pfade in
      // routes/auth.ts: status !== "active" → 401).
      const placeholderHash = await hashPassword(
        // Lang genug + zufällig, damit selbst wenn der Hash leakt und
        // jemand brute-forced nichts Brauchbares rauskommt. Wird vom
        // Setup-Flow überschrieben.
        crypto.randomUUID() + crypto.randomUUID()
      );
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: body.ownerEmail.toLowerCase(),
          passwordHash: placeholderHash,
          name: body.ownerName,
          role: "owner",
          status: "invited",
        },
      });

      // Direkt prisma.passwordResetToken.create statt createSetupToken,
      // weil wir innerhalb der tx sind und der Service einen eigenen
      // Connection nimmt. Wir duplizieren die Token-Hash-Logik
      // hier kurz; bei Erweiterung des Setup-Flows lohnt sich ein
      // Transaction-aware Service-Layer.
      const { randomBytes, createHash } = await import("node:crypto");
      const tokenPlain = randomBytes(32).toString("base64url");
      const tokenHash = createHash("sha256").update(tokenPlain).digest("hex");
      const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          kind: "setup",
          expiresAt,
        },
      });

      return {
        tenantId: tenant.id,
        tenantName: tenant.name,
        userId: user.id,
        userEmail: user.email,
        userName: user.name ?? user.email,
        tokenPlain,
      };
    });

    // Audit
    await logEvent({
      tenantId: inviteToken.tenantId,
      actorType: "super_admin",
      actorId: sa.admin.id,
      action: "super.tenant.create",
      targetType: "tenant",
      targetId: inviteToken.tenantId,
      payload: {
        slug: body.slug,
        name: body.name,
        ownerEmail: body.ownerEmail,
      },
      ipAddress: req.ip,
    });

    // Mail versenden (best-effort). Wenn Mail fehlschlägt, geben wir den
    // Setup-Link in der Response zurück, damit der Super-Admin ihn manuell
    // weiterleiten kann — sonst wäre der Tenant onboarding-blockiert.
    const setupUrl = buildSetupUrl(inviteToken.tokenPlain);
    let mailSent = false;
    try {
      const tpl = tmplOwnerSetup({
        displayName: inviteToken.userName,
        tenantName: inviteToken.tenantName,
        setupUrl,
        invitedBy: sa.admin.displayName,
        validHours: 72,
      });
      await sendMail({ to: inviteToken.userEmail, ...tpl });
      mailSent = true;
    } catch (err) {
      logger.warn(
        { err, userId: inviteToken.userId },
        "super.tenant.create: mail send failed — link in response only"
      );
    }

    return reply.status(201).send({
      tenant: {
        id: inviteToken.tenantId,
        slug: body.slug,
        name: body.name,
        status: "active",
        customDomain: body.customDomain ?? null,
      },
      owner: {
        id: inviteToken.userId,
        email: inviteToken.userEmail,
        name: inviteToken.userName,
        status: "invited",
      },
      setup: {
        // Klartext-Link in der Response, falls Mail nicht funktioniert
        // hat — Super-Admin kann ihn dann selber weiterleiten. Wird
        // hier einmalig zurückgegeben, nirgends gespeichert (Hash in DB).
        url: setupUrl,
        mailSent,
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      },
    });
  });

  // -------------------------------------------------------------------------
  // GET /super/tenants/:id
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    "/super/tenants/:id",
    async (req, reply) => {
      const tenant = await prisma.tenant.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          slug: true,
          name: true,
          displayName: true,
          status: true,
          archivedAt: true,
          archiveScheduledAt: true,
          customDomain: true,
          createdAt: true,
          updatedAt: true,
          // Self-Service-Loeschung — fuer Karenz-Anzeige im Detail
          selfDeletionRequestedAt: true,
          selfDeletionScheduledFor: true,
          // Billing — fuer Subscription-Block
          subscription: {
            select: {
              status: true,
              billingInterval: true,
              stripeCustomerId: true,
              stripeSubscriptionId: true,
              currentPeriodStart: true,
              currentPeriodEnd: true,
              cancelAtPeriodEnd: true,
              trialEndsAt: true,
              storageBytesUsed: true,
              storageAddonGib: true,
              galleriesCount: true,
              readOnlySince: true,
              createdAt: true,
              updatedAt: true,
              plan: {
                select: {
                  slug: true,
                  name: true,
                  storageGib: true,
                  galleriesMax: true,
                  priceMonthlyCents: true,
                  priceYearlyCents: true,
                  currency: true,
                },
              },
            },
          },
          users: {
            select: {
              id: true,
              email: true,
              name: true,
              role: true,
              status: true,
              lastLoginAt: true,
              createdAt: true,
            },
            orderBy: [{ role: "asc" }, { createdAt: "asc" }],
          },
          _count: { select: { galleries: true } },
        },
      });
      if (!tenant) return reply.status(404).send({ error: "not_found" });

      // Karenz berechnen wenn archiviert. Hilft dem UI ohne weitere
      // API-Calls anzuzeigen "Hard-Delete ab Tag X" oder "noch Y Tage".
      const KARENZ_DAYS = 30;
      let karenz: {
        active: boolean;
        deletableAt: Date | null;
        remainingDays: number;
      } | null = null;
      if (tenant.status === "archived" && tenant.archivedAt) {
        const deletableAt = new Date(
          tenant.archivedAt.getTime() + KARENZ_DAYS * 24 * 60 * 60 * 1000
        );
        const remainingMs = deletableAt.getTime() - Date.now();
        karenz = {
          active: remainingMs > 0,
          deletableAt,
          remainingDays: Math.max(
            0,
            Math.ceil(remainingMs / (24 * 60 * 60 * 1000))
          ),
        };
      }

      // BigInt aus Prisma kann nicht direkt JSON-serialisiert werden,
      // wir konvertieren zu number (sicher bis 9 PiB, mehr als wir
      // jemals als Storage-Wert sehen werden).
      const sub = tenant.subscription;
      const subscription = sub
        ? {
            status: sub.status,
            billingInterval: sub.billingInterval,
            stripeCustomerId: sub.stripeCustomerId,
            stripeSubscriptionId: sub.stripeSubscriptionId,
            currentPeriodStart: sub.currentPeriodStart,
            currentPeriodEnd: sub.currentPeriodEnd,
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
            trialEndsAt: sub.trialEndsAt,
            storageBytesUsed: Number(sub.storageBytesUsed),
            storageAddonGib: sub.storageAddonGib,
            galleriesCount: sub.galleriesCount,
            readOnlySince: sub.readOnlySince,
            createdAt: sub.createdAt,
            updatedAt: sub.updatedAt,
            plan: {
              slug: sub.plan.slug,
              name: sub.plan.name,
              storageGib: sub.plan.storageGib,
              galleriesMax: sub.plan.galleriesMax,
              priceMonthlyCents: sub.plan.priceMonthlyCents,
              priceYearlyCents: sub.plan.priceYearlyCents,
              currency: sub.plan.currency,
            },
          }
        : null;

      return {
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
          name: tenant.name,
          displayName: tenant.displayName,
          status: tenant.status,
          archivedAt: tenant.archivedAt,
          archiveScheduledAt: tenant.archiveScheduledAt,
          selfDeletionRequestedAt: tenant.selfDeletionRequestedAt,
          selfDeletionScheduledFor: tenant.selfDeletionScheduledFor,
          karenz,
          customDomain: tenant.customDomain,
          createdAt: tenant.createdAt,
          updatedAt: tenant.updatedAt,
          galleryCount: tenant._count.galleries,
          users: tenant.users,
          subscription,
        },
      };
    }
  );

  // -------------------------------------------------------------------------
  // PATCH /super/tenants/:id — Slug / Name / Custom-Domain
  // -------------------------------------------------------------------------
  app.patch<{ Params: { id: string } }>(
    "/super/tenants/:id",
    async (req, reply) => {
      const sa = req.requireSuperAdmin();
      const body = updateTenantSchema.parse(req.body);

      const existing = await prisma.tenant.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) return reply.status(404).send({ error: "not_found" });

      // Slug-Konflikt prüfen — wenn geändert wird, muss er anderswo
      // nicht existieren. Slug ist Teil der Subdomain-URL, also Vorsicht:
      // alte Bookmarks brechen. UI macht eine deutliche Warnung. Backend
      // selbst gibt nur 409 bei Konflikt zurück; keine weiteren Schranken.
      if (
        body.slug !== undefined &&
        body.slug !== existing.slug
      ) {
        const taken = await prisma.tenant.findFirst({
          where: { slug: body.slug, id: { not: existing.id } },
          select: { id: true },
        });
        if (taken) {
          return reply.status(409).send({ error: "slug_taken" });
        }
      }

      // Custom-Domain-Konflikt prüfen (nur wenn explizit gesetzt)
      if (
        body.customDomain !== undefined &&
        body.customDomain !== null &&
        body.customDomain !== existing.customDomain
      ) {
        const taken = await prisma.tenant.findFirst({
          where: {
            customDomain: body.customDomain,
            id: { not: existing.id },
          },
          select: { id: true },
        });
        if (taken) {
          return reply.status(409).send({ error: "domain_taken" });
        }
      }

      const updated = await prisma.tenant.update({
        where: { id: existing.id },
        data: {
          ...(body.slug !== undefined ? { slug: body.slug } : {}),
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.displayName !== undefined
            ? { displayName: body.displayName }
            : {}),
          ...(body.customDomain !== undefined
            ? { customDomain: body.customDomain }
            : {}),
        },
      });

      await logEvent({
        tenantId: updated.id,
        actorType: "super_admin",
        actorId: sa.admin.id,
        action: "super.tenant.update",
        targetType: "tenant",
        targetId: updated.id,
        payload: {
          slug: body.slug,
          previousSlug: body.slug !== undefined ? existing.slug : undefined,
          name: body.name,
          displayName: body.displayName,
          customDomain: body.customDomain,
        },
        ipAddress: req.ip,
      });

      return { tenant: updated };
    }
  );

  // -------------------------------------------------------------------------
  // POST /super/tenants/:id/suspend
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/super/tenants/:id/suspend",
    async (req, reply) => {
      const sa = req.requireSuperAdmin();
      const t = await prisma.tenant.findUnique({
        where: { id: req.params.id },
      });
      if (!t) return reply.status(404).send({ error: "not_found" });
      if (t.status === "archived") {
        return reply
          .status(409)
          .send({ error: "tenant_archived", message: "Archived tenants cannot be suspended" });
      }
      const updated = await prisma.tenant.update({
        where: { id: t.id },
        data: { status: "suspended" },
      });
      await logEvent({
        tenantId: t.id,
        actorType: "super_admin",
        actorId: sa.admin.id,
        action: "super.tenant.suspend",
        targetType: "tenant",
        targetId: t.id,
        ipAddress: req.ip,
      });
      return { tenant: updated };
    }
  );

  // -------------------------------------------------------------------------
  // POST /super/tenants/:id/unsuspend
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/super/tenants/:id/unsuspend",
    async (req, reply) => {
      const sa = req.requireSuperAdmin();
      const t = await prisma.tenant.findUnique({
        where: { id: req.params.id },
      });
      if (!t) return reply.status(404).send({ error: "not_found" });
      if (t.status === "archived") {
        return reply
          .status(409)
          .send({ error: "tenant_archived", message: "Archived tenants cannot be reactivated via UI" });
      }
      const updated = await prisma.tenant.update({
        where: { id: t.id },
        data: { status: "active" },
      });
      await logEvent({
        tenantId: t.id,
        actorType: "super_admin",
        actorId: sa.admin.id,
        action: "super.tenant.unsuspend",
        targetType: "tenant",
        targetId: t.id,
        ipAddress: req.ip,
      });
      return { tenant: updated };
    }
  );

  // -------------------------------------------------------------------------
  // POST /super/tenants/:id/schedule-archive — Archivierung vorab planen
  // -------------------------------------------------------------------------
  // Setzt archiveScheduledAt + verschickt Initial-Mail an alle Owner.
  // Default: heute + 30 Tage. Body kann ein scheduledAt (ISO-Date)
  // mitliefern. Studio-Frontend zeigt ab dem Setzen einen Countdown-
  // Banner. Beim Erreichen des Stichtags benachrichtigt der Sweeper
  // den Super-Admin (Mail + Audit), archiviert aber NICHT automatisch.
  //
  // Wird der Endpoint nochmal aufgerufen während bereits ein Datum
  // gesetzt ist (z.B. neues Datum), werden die Mail-Tracking-Felder
  // zurückgesetzt, damit die Reminder-Mail erneut greift.
  const scheduleArchiveBody = z.object({
    scheduledAt: z.string().datetime().optional(),
  });
  app.post<{ Params: { id: string } }>(
    "/super/tenants/:id/schedule-archive",
    async (req, reply) => {
      const sa = req.requireSuperAdmin();
      const body = scheduleArchiveBody.parse(req.body ?? {});

      const t = await prisma.tenant.findUnique({
        where: { id: req.params.id },
        include: {
          users: {
            where: { role: "owner", status: "active" },
            select: { id: true, email: true, name: true },
          },
        },
      });
      if (!t) return reply.status(404).send({ error: "not_found" });

      if (t.status !== "active") {
        return reply.status(409).send({
          error: "not_active",
          message:
            "Nur aktive Tenants können vor-archiviert werden. Suspended/archived Tenants brauchen das nicht.",
        });
      }

      const scheduledAt = body.scheduledAt
        ? new Date(body.scheduledAt)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      if (scheduledAt.getTime() <= Date.now()) {
        return reply.status(400).send({
          error: "scheduled_in_past",
          message:
            "Der Stichtag muss in der Zukunft liegen. Wenn du sofort archivieren willst, nutze /archive direkt.",
        });
      }

      const updated = await prisma.tenant.update({
        where: { id: t.id },
        data: {
          archiveScheduledAt: scheduledAt,
          // Reset der Mail-Tracking-Felder bei jedem Schedule-Aufruf,
          // damit der Sweeper bei einem Datums-Wechsel die Reminder
          // erneut schickt.
          archiveNoticeMailedAt: null,
          archiveReminderMailedAt: null,
        },
      });

      // Initial-Mail an alle aktiven Owner. Best-Effort: wenn SMTP
      // klemmt, archiveScheduledAt bleibt trotzdem gesetzt, Studio-
      // Banner funktioniert. Der Sweeper wuerde dann nochmal versuchen
      // — aber nur fuer den 7-Tage-Reminder, nicht fuer die Initial-
      // Mail. Wir loggen also Mail-Failures hier explizit.
      const formattedDate = scheduledAt.toLocaleDateString("de-DE", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      let mailsSent = 0;
      for (const owner of t.users) {
        try {
          await sendMail({
            to: owner.email,
            subject: `Wichtig: Ihr Lumio-Konto „${t.name}" wird am ${formattedDate} archiviert`,
            text:
              `Hallo ${owner.name ?? owner.email},\n\n` +
              `wir möchten Sie informieren, dass Ihr Lumio-Konto ` +
              `„${t.name}" am ${formattedDate} archiviert wird.\n\n` +
              `Was bedeutet das?\n` +
              `  • Ab diesem Datum können Sie sich nicht mehr einloggen\n` +
              `  • Ihre Daten bleiben 30 Tage in Karenz erhalten\n` +
              `  • Danach werden alle Daten endgültig gelöscht\n\n` +
              `Was sollten Sie jetzt tun?\n` +
              `Loggen Sie sich ein und exportieren Sie Ihre Daten über die ` +
              `Sidebar → "Datenexport". Pro Galerie wird ein ZIP-Archiv mit ` +
              `Originaldateien und Metadaten erstellt.\n\n` +
              `Falls Sie das Archivierungsdatum für ein Missverständnis halten ` +
              `oder Fragen haben, antworten Sie bitte zeitnah auf diese Mail.\n\n` +
              `Wir senden Ihnen 7 Tage vor dem Stichtag noch eine Erinnerung.\n\n` +
              `— Lumio`,
          });
          mailsSent++;
        } catch (err) {
          app.log.warn(
            { err, ownerId: owner.id },
            "schedule-archive mail failed"
          );
        }
      }
      // archiveNoticeMailedAt setzen, falls min. eine Mail durchging.
      // Bei kompletter Mail-Failure bleibt null — der Sweeper merkt
      // das beim naechsten Lauf nicht, aber wir wuerden's im Audit-Log
      // sehen.
      if (mailsSent > 0) {
        await prisma.tenant.update({
          where: { id: t.id },
          data: { archiveNoticeMailedAt: new Date() },
        });
      }

      await logEvent({
        tenantId: t.id,
        actorType: "super_admin",
        actorId: sa.admin.id,
        action: "super.tenant.schedule_archive",
        targetType: "tenant",
        targetId: t.id,
        payload: {
          scheduledAt,
          ownersMailed: mailsSent,
          ownersTotal: t.users.length,
        },
        ipAddress: req.ip,
      });

      return {
        tenant: {
          id: updated.id,
          slug: updated.slug,
          name: updated.name,
          status: updated.status,
          archiveScheduledAt: updated.archiveScheduledAt,
        },
        mailsSent,
        ownersTotal: t.users.length,
      };
    }
  );

  // -------------------------------------------------------------------------
  // DELETE /super/tenants/:id/schedule-archive — Plan zurückziehen
  // -------------------------------------------------------------------------
  // Setzt archiveScheduledAt + Mail-Tracking auf null. Schickt KEINE
  // "Archivierung abgesagt"-Mail automatisch — wenn der Super-Admin
  // den Tenant informieren will, soll er das bewusst tun (separater
  // Kommunikationskanal). Wir wollen vermeiden, dass jemand das aus
  // Versehen klickt und der Tenant verwirrt wird.
  app.delete<{ Params: { id: string } }>(
    "/super/tenants/:id/schedule-archive",
    async (req, reply) => {
      const sa = req.requireSuperAdmin();
      const t = await prisma.tenant.findUnique({
        where: { id: req.params.id },
      });
      if (!t) return reply.status(404).send({ error: "not_found" });
      if (!t.archiveScheduledAt) {
        return reply.status(409).send({
          error: "not_scheduled",
          message: "Es ist keine Archivierung geplant.",
        });
      }
      await prisma.tenant.update({
        where: { id: t.id },
        data: {
          archiveScheduledAt: null,
          archiveNoticeMailedAt: null,
          archiveReminderMailedAt: null,
        },
      });
      await logEvent({
        tenantId: t.id,
        actorType: "super_admin",
        actorId: sa.admin.id,
        action: "super.tenant.cancel_scheduled_archive",
        targetType: "tenant",
        targetId: t.id,
        payload: { previousScheduledAt: t.archiveScheduledAt },
        ipAddress: req.ip,
      });
      return { ok: true };
    }
  );

  // -------------------------------------------------------------------------
  // POST /super/tenants/:id/cancel-self-deletion
  // -------------------------------------------------------------------------
  // Manuell die 60-Tage-Karenzphase einer Self-Service-Loeschung beenden.
  // Use-Case: Owner ist nach Klick auf "Loeschen" raus und kommt nicht mehr
  // rein (vergessenes Passwort, Email-Probleme, was auch immer). Super-Admin
  // kann hier mit einem Klick die Loeschung stoppen — der Tenant ist danach
  // wieder voll funktionsfaehig.
  //
  // Hinweis bzgl. Stripe: die Subscription wurde beim Lösch-Request sofort
  // gekuendigt und wird hier NICHT automatisch reaktiviert. Owner muss
  // selbst im Studio-Billing eine neue Subscription starten — Mail-Hinweis
  // dazu ist im DeletionCancelled-Template enthalten.
  app.post<{ Params: { id: string } }>(
    "/super/tenants/:id/cancel-self-deletion",
    async (req, reply) => {
      const sa = req.requireSuperAdmin();
      const t = await prisma.tenant.findUnique({
        where: { id: req.params.id },
        select: { id: true, status: true },
      });
      if (!t) return reply.status(404).send({ error: "not_found" });
      if (t.status !== "pending_deletion") {
        return reply.status(409).send({
          error: "not_pending_deletion",
          message: "Dieser Tenant ist nicht in der Karenzphase.",
        });
      }

      const result = await cancelDeletion({
        tenantId: t.id,
        cancelledById: sa.admin.id,
        actorType: "super_admin",
        ipAddress: req.ip,
      });

      return { ok: true, status: result.status };
    }
  );

  app.post<{ Params: { id: string } }>(
    "/super/tenants/:id/archive",
    async (req, reply) => {
      const sa = req.requireSuperAdmin();
      const t = await prisma.tenant.findUnique({
        where: { id: req.params.id },
      });
      if (!t) return reply.status(404).send({ error: "not_found" });

      // Stripe-Subscription sofort kündigen. Best-Effort: wenn Stripe
      // failed, archivieren wir trotzdem (DB-State ist wichtiger,
      // Subscription-Cancel kann der Super-Admin notfalls im Stripe-
      // Dashboard nachholen). Bei normalem 'no_subscription' (Tenant
      // hatte nie eine) ist das ein no-op.
      let stripeResult: { canceled: boolean; reason: string } = {
        canceled: false,
        reason: "skipped",
      };
      try {
        stripeResult = await cancelSubscriptionImmediately(t.id);
        app.log.info(
          { tenantId: t.id, stripeResult },
          "tenant archive: stripe cancel"
        );
      } catch (err) {
        app.log.warn(
          { err, tenantId: t.id },
          "tenant archive: stripe cancel failed (continuing)"
        );
      }

      const updated = await prisma.tenant.update({
        where: { id: t.id },
        data: {
          status: "archived",
          // Karenz-Tracking. Wenn der Tenant bereits archiviert war
          // (z.B. Re-Archive nach DB-Manipulation), Timestamp NICHT
          // überschreiben — sonst würde die Karenz neu starten und
          // ein Super-Admin könnte unbeabsichtigt die 30 Tage
          // verlängern. Nur setzen wenn vorher null.
          archivedAt: t.archivedAt ?? new Date(),
          // Scheduled-Archive-Felder zurücksetzen (Archive wurde
          // jetzt vollzogen, der Plan ist erledigt). Sonst würde der
          // Sweeper später noch versuchen Reminder zu mailen.
          archiveScheduledAt: null,
          archiveNoticeMailedAt: null,
          archiveReminderMailedAt: null,
        },
      });
      // Alle aktiven Sessions des Tenants ungültig machen — Login-Pfad
      // weist suspended/archived ab, aber bestehende Sessions würden
      // sonst noch bis zur nächsten validateSession-Prüfung leben.
      // validateSession prüft den Tenant-Status auch, also reicht das
      // — explizites DELETE bringt aber Klarheit und früheres Aufräumen.
      await prisma.session.deleteMany({
        where: { user: { tenantId: t.id } },
      });
      await logEvent({
        tenantId: t.id,
        actorType: "super_admin",
        actorId: sa.admin.id,
        action: "super.tenant.archive",
        targetType: "tenant",
        targetId: t.id,
        payload: { stripeCancel: stripeResult },
        ipAddress: req.ip,
      });
      return { tenant: updated };
    }
  );

  // -------------------------------------------------------------------------
  // DELETE /super/tenants/:id — Hard-Delete
  // -------------------------------------------------------------------------
  // Vollständige Entfernung des Tenants aus der DB plus Anstoss des
  // S3-Cleanups. Voraussetzungen:
  //
  //   1. Tenant muss bereits status='archived' sein (über /archive).
  //   2. archivedAt + 30 Tage <= now() (DSGVO-typische Karenz, gibt
  //      dem Tenant Zeit für Datenexport).
  //   3. Body enthaelt confirmSlug, der exakt dem Tenant.slug entspricht
  //      — Schutz gegen versehentliches Klicken im UI.
  //
  // Was passiert:
  //   - Prisma cascade entfernt alle abhaengigen Rows (User, Gallery,
  //     File, Rendition, ..., BillingSubscription — siehe Schema).
  //   - Worker-Cleanup-Job raeumt den S3-Prefix t/<tenantId>/.
  //   - Audit-Log bleibt erhalten (gehört nicht zum Tenant, sondern
  //     wird tenantId='<id>' gespeichert auch nach Tenant-Delete).
  //   - Stripe-Customer bleibt in Stripe stehen (Audit-Trail). Wir
  //     nullen die stripeCustomerId nicht — die ist eh weg mit dem
  //     Tenant-Row.
  //
  // Was bewusst NICHT passiert:
  //   - Kein automatischer Datenexport. Tenant kann das während der
  //     30-Tage-Karenz selbst anfordern (separates Feature).
  //   - Kein Stripe-Cancel hier nochmal — das ist beim Archive schon
  //     passiert. Wenn Stripe-Cancel beim Archive nicht durchging und
  //     der Super-Admin das nicht im Dashboard nachgeholt hat, läuft
  //     die Subscription weiter — das ist DB-unabhängig.
  //   - Keine Mail-Notification an den Tenant. Wenn der gemailed werden
  //     soll ('Ihre Daten wurden endgültig gelöscht'), passiert das
  //     manuell vom Super-Admin außerhalb des Systems.
  const deleteTenantBody = z.object({
    confirmSlug: z.string(),
  });
  app.delete<{ Params: { id: string } }>(
    "/super/tenants/:id",
    async (req, reply) => {
      const sa = req.requireSuperAdmin();
      const body = deleteTenantBody.parse(req.body ?? {});

      const t = await prisma.tenant.findUnique({
        where: { id: req.params.id },
      });
      if (!t) return reply.status(404).send({ error: "not_found" });

      // 1. Muss archiviert sein
      if (t.status !== "archived") {
        return reply.status(409).send({
          error: "not_archived",
          message:
            "Tenant muss zuerst archiviert werden. Verwende /super/tenants/:id/archive.",
        });
      }

      // 2. Karenzfrist 30 Tage seit archivedAt
      const KARENZ_DAYS = 30;
      const KARENZ_MS = KARENZ_DAYS * 24 * 60 * 60 * 1000;
      if (!t.archivedAt) {
        // Tenant ist archiviert, hat aber kein archivedAt (alter Tenant
        // vor Migration). Karenz kann nicht berechnet werden — Super-
        // Admin muss erst nochmal archiven, damit archivedAt gesetzt wird.
        return reply.status(409).send({
          error: "no_archive_timestamp",
          message:
            "Tenant ist archiviert, aber ohne archivedAt-Timestamp (vor Migration). Bitte nochmal /archive aufrufen, damit die Karenz starten kann.",
        });
      }
      const elapsed = Date.now() - t.archivedAt.getTime();
      if (elapsed < KARENZ_MS) {
        const remainingDays = Math.ceil((KARENZ_MS - elapsed) / (24 * 60 * 60 * 1000));
        return reply.status(409).send({
          error: "karenz_active",
          message: `Karenzfrist noch aktiv. Hard-Delete frühestens in ${remainingDays} Tagen möglich.`,
          archivedAt: t.archivedAt,
          remainingDays,
        });
      }

      // 3. Slug-Confirm
      if (body.confirmSlug !== t.slug) {
        return reply.status(400).send({
          error: "slug_mismatch",
          message:
            "Slug-Bestätigung stimmt nicht. Bitte den exakten Tenant-Slug eingeben.",
        });
      }

      // Audit BEVOR wir löschen — sonst ist tenantId in den Logs zwar
      // noch da (Audit-Logs cascaden nicht), aber die Reihenfolge ist
      // einfacher zu lesen wenn der Delete-Event vor dem Cascade kommt.
      await logEvent({
        tenantId: t.id,
        actorType: "super_admin",
        actorId: sa.admin.id,
        action: "super.tenant.delete",
        targetType: "tenant",
        targetId: t.id,
        payload: {
          slug: t.slug,
          name: t.name,
          archivedAt: t.archivedAt,
          karenzDays: KARENZ_DAYS,
        },
        ipAddress: req.ip,
      });

      // DB-Cascade-Delete. Räumt User, Gallery, File, Rendition,
      // BillingSubscription etc. weg. Stripe-Customer in Stripe bleibt.
      await prisma.tenant.delete({ where: { id: t.id } });

      // Worker enqueued — räumt S3-Prefix t/<tenantId>/. Bei großen
      // Tenants kann das mehrere Minuten laufen, läuft asynchron im
      // Cleanup-Stream. Wenn enqueue selbst failt, loggen wir das —
      // der Tenant ist DB-seitig schon weg, das soll die HTTP-Antwort
      // nicht failen lassen.
      await enqueue(Queues.CLEANUP, {
        type: "cleanup_tenant",
        tenantId: t.id,
      }).catch((err) => {
        app.log.warn(
          { err, tenantId: t.id },
          "cleanup_tenant enqueue failed"
        );
      });

      return reply.status(204).send();
    }
  );

  // -------------------------------------------------------------------------
  // POST /super/tenants/:id/owners — weiteren Owner einladen
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/super/tenants/:id/owners",
    async (req, reply) => {
      const sa = req.requireSuperAdmin();
      const body = addOwnerSchema.parse(req.body);

      const tenant = await prisma.tenant.findUnique({
        where: { id: req.params.id },
      });
      if (!tenant) return reply.status(404).send({ error: "not_found" });
      if (tenant.status !== "active") {
        return reply
          .status(409)
          .send({ error: "tenant_inactive", message: "Cannot invite owner to inactive tenant" });
      }

      // Existiert die E-Mail in diesem Tenant schon?
      const existing = await prisma.user.findUnique({
        where: {
          tenantId_email: {
            tenantId: tenant.id,
            email: body.email.toLowerCase(),
          },
        },
      });
      if (existing) {
        return reply
          .status(409)
          .send({ error: "email_taken" });
      }

      const placeholderHash = await hashPassword(
        crypto.randomUUID() + crypto.randomUUID()
      );
      const user = await prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: body.email.toLowerCase(),
          passwordHash: placeholderHash,
          name: body.name,
          role: "owner",
          status: "invited",
        },
      });

      const { token } = await createSetupToken({ userId: user.id });
      const setupUrl = buildSetupUrl(token);

      let mailSent = false;
      try {
        const tpl = tmplOwnerSetup({
          displayName: body.name,
          tenantName: tenant.name,
          setupUrl,
          invitedBy: sa.admin.displayName,
          validHours: 72,
        });
        await sendMail({ to: body.email, ...tpl });
        mailSent = true;
      } catch (err) {
        logger.warn({ err, userId: user.id }, "owner invite: mail send failed");
      }

      await logEvent({
        tenantId: tenant.id,
        actorType: "super_admin",
        actorId: sa.admin.id,
        action: "super.owner.invite",
        targetType: "user",
        targetId: user.id,
        payload: { email: body.email, mailSent },
        ipAddress: req.ip,
      });

      return reply.status(201).send({
        owner: {
          id: user.id,
          email: user.email,
          name: user.name,
          status: user.status,
        },
        setup: { url: setupUrl, mailSent },
      });
    }
  );

  // -------------------------------------------------------------------------
  // GET /super/stats — globale Übersicht
  // -------------------------------------------------------------------------
  app.get("/super/stats", async () => {
    const [
      tenantsByStatus,
      totalUsers,
      totalGalleries,
      totalFiles,
      pendingDeletions,
    ] = await Promise.all([
      prisma.tenant.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.user.count(),
      prisma.gallery.count(),
      prisma.file.count(),
      // Tenants in der 60-Tage-Karenzphase mit Owner-Email + Termin-
      // Daten, damit das Dashboard direkt eine Mahnliste rendern kann
      // ohne separate Roundtrips.
      prisma.tenant.findMany({
        where: { status: "pending_deletion" },
        select: {
          id: true,
          name: true,
          displayName: true,
          slug: true,
          selfDeletionRequestedAt: true,
          selfDeletionScheduledFor: true,
          users: {
            where: { role: "owner", status: "active" },
            select: { email: true, name: true },
            take: 1,
          },
        },
        orderBy: { selfDeletionScheduledFor: "asc" },
      }),
    ]);

    return {
      tenants: tenantsByStatus.reduce(
        (acc, row) => ({ ...acc, [row.status]: row._count._all }),
        {} as Record<string, number>
      ),
      totalUsers,
      totalGalleries,
      totalFiles,
      pendingDeletions: pendingDeletions.map((t) => ({
        id: t.id,
        name: t.displayName ?? t.name,
        slug: t.slug,
        requestedAt: t.selfDeletionRequestedAt,
        scheduledFor: t.selfDeletionScheduledFor,
        ownerEmail: t.users[0]?.email ?? null,
        ownerName: t.users[0]?.name ?? null,
      })),
    };
  });

  // -------------------------------------------------------------------------
  // POST /super/tenants/:id/export — Datenexport für einen Tenant
  // -------------------------------------------------------------------------
  // Erstellt ein TenantExport für alle Galerien dieses Tenants. Wenn
  // der Tenant archiviert ist (Karenz), wird zusätzlich ein
  // ExportToken generiert und eine Mail an alle Owner geschickt mit
  // dem Download-Link — sodass der Tenant ohne Login an seine Daten
  // kommt (DSGVO: Recht auf Datenübertragbarkeit).
  //
  // Bei nicht-archivierten Tenants wird kein Token erzeugt — wenn
  // der Super-Admin den Export für seinen eigenen Backup-Zweck baut,
  // kann er sich die Files über /super/exports/:id mit Super-Admin-
  // Session abholen. (Diesen Endpoint bauen wir gleich auch.)
  app.post<{ Params: { id: string } }>(
    "/super/tenants/:id/export",
    async (req, reply) => {
      const sa = req.requireSuperAdmin();
      const t = await prisma.tenant.findUnique({
        where: { id: req.params.id },
        include: {
          users: {
            where: { role: "owner", status: "active" },
            select: { id: true, email: true, name: true },
          },
        },
      });
      if (!t) return reply.status(404).send({ error: "not_found" });

      const isArchived = t.status === "archived";

      try {
        const result = await createExport({
          tenantId: t.id,
          source: "super_admin",
          galleryIds: null,
          triggeredBySuperAdminId: sa.admin.id,
          // Token nur bei archivierten Tenants — die haben keinen
          // funktionierenden Login mehr.
          createToken: isArchived,
        });

        // Mail an Tenant-Owner mit dem Token-Link verschicken — nur
        // bei archived Tenants (sonst kann der Owner sich einloggen
        // und im Studio auf die Export-Seite gehen).
        if (isArchived && result.token && t.users.length > 0) {
          const link = `${config.PUBLIC_URL}/e/${result.token}`;
          for (const owner of t.users) {
            try {
              await sendMail({
                to: owner.email,
                subject: `Ihr Datenexport von Lumio ist bereit – ${t.name}`,
                text:
                  `Hallo ${owner.name ?? owner.email},\n\n` +
                  `Ihr Lumio-Konto „${t.name}" wurde archiviert und Ihre Daten ` +
                  `werden in Kürze endgültig gelöscht. Sie können Ihre Galerien ` +
                  `(Originaldateien + Metadaten) als ZIP-Archiv unter folgendem ` +
                  `Link herunterladen — der Link ist 30 Tage gültig:\n\n` +
                  `${link}\n\n` +
                  `Der Export wird gerade erstellt. Pro Galerie dauert das ` +
                  `je nach Größe einige Sekunden bis Minuten. Auf der ` +
                  `Download-Seite sehen Sie den jeweiligen Status und können ` +
                  `fertige Galerien direkt herunterladen.\n\n` +
                  `Falls Sie weitere Fragen haben, antworten Sie auf diese ` +
                  `Mail.\n\n— Lumio`,
              });
            } catch (err) {
              app.log.warn(
                { err, ownerId: owner.id },
                "export mail failed"
              );
            }
          }
        }

        await logEvent({
          tenantId: t.id,
          actorType: "super_admin",
          actorId: sa.admin.id,
          action: "super.tenant.export",
          targetType: "tenant_export",
          targetId: result.exportId,
          payload: {
            archived: isArchived,
            tokenIssued: !!result.token,
            itemCount: result.itemCount,
            mailsTo: isArchived ? t.users.map((u) => u.email) : [],
          },
          ipAddress: req.ip,
        });

        return reply.status(201).send({
          exportId: result.exportId,
          itemCount: result.itemCount,
          tokenIssued: !!result.token,
          mailsSent: isArchived ? t.users.length : 0,
        });
      } catch (err) {
        if (err instanceof Error && err.message === "no_galleries_to_export") {
          return reply.status(400).send({
            error: "no_galleries",
            message: "Tenant hat keine Galerien zum Exportieren.",
          });
        }
        throw err;
      }
    }
  );

  // -------------------------------------------------------------------------
  // GET /super/tenants/:id/exports — Liste der Exports
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    "/super/tenants/:id/exports",
    async (req, reply) => {
      req.requireSuperAdmin();
      const tenant = await prisma.tenant.findUnique({
        where: { id: req.params.id },
        select: { id: true },
      });
      if (!tenant) return reply.status(404).send({ error: "not_found" });
      const exports = await prisma.tenantExport.findMany({
        where: { tenantId: tenant.id },
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { items: true } },
          token: { select: { token: true, expiresAt: true, accessCount: true } },
        },
      });
      return {
        exports: exports.map((e) => ({
          id: e.id,
          source: e.source,
          status: e.status,
          itemCount: e._count.items,
          expiresAt: e.expiresAt,
          createdAt: e.createdAt,
          token: e.token
            ? {
                value: e.token.token,
                expiresAt: e.token.expiresAt,
                accessCount: e.token.accessCount,
              }
            : null,
        })),
      };
    }
  );

  // -------------------------------------------------------------------------
  // POST /super/maintenance/run-export-cleanup
  // -------------------------------------------------------------------------
  // Manueller Trigger fuer den Sweeper. Wird normalerweise alle 6h
  // automatisch ausgelöst, aber bei Bedarf (Storage-Druck, Tests)
  // kann der Super-Admin direkt anstossen.
  app.post(
    "/super/maintenance/run-export-cleanup",
    async (req) => {
      const sa = req.requireSuperAdmin();
      await enqueue(Queues.CLEANUP, {
        type: "cleanup_expired_exports",
      });
      await logEvent({
        tenantId: null,
        actorType: "super_admin",
        actorId: sa.admin.id,
        action: "super.maintenance.run_export_cleanup",
        targetType: "system",
        targetId: "exports",
        ipAddress: req.ip,
      });
      return { enqueued: true };
    }
  );

  // -------------------------------------------------------------------------
  // GET /super/audit-log
  // -------------------------------------------------------------------------
  // Browse-Endpunkt fuer Audit-Eintraege (Events). Cursor-basierte Pagination
  // ueber createdAt + id (id als Tie-Breaker bei identischem Zeitstempel,
  // sonst koennten Eintraege bei identischem ms-Timestamp doppelt erscheinen
  // oder uebersprungen werden).
  //
  // Filter:
  //   tenantId — auf einen Tenant einschraenken
  //   action — Prefix-Suche (z.B. "share." oder "super.")
  //   actorType — user | access | system | super_admin
  //   from, to — ISO-Datum als Zeitfenster
  //   limit — 1..100, default 25
  //   cursor — opaques Token aus voriger Antwort fuer "naechste Seite"
  //
  // Plus: count() fuer den Filter, damit das Frontend "X Eintraege gefunden"
  // anzeigen kann. Bei riesigen Mengen wird das langsam — aber bei der
  // Groessenordnung Lumio (Solo-SaaS, kleine Tenant-Anzahl) ist es noch
  // OK. Falls das mal eng wird: separater count-Endpoint mit Cache.
  const auditLogQuerySchema = z.object({
    tenantId: z.string().uuid().optional(),
    actionPrefix: z.string().max(60).optional(),
    actorType: z.enum(["user", "access", "system", "super_admin"]).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().optional(),
  });

  app.get("/super/audit-log", async (req, reply) => {
    req.requireSuperAdmin();
    const q = auditLogQuerySchema.parse(req.query);

    // Cursor-Decoding: "<iso>:<uuid>". Wenn parse misslingt, ignorieren
    // (defensive — Frontend duerfte nie was Kaputtes schicken).
    let cursorDate: Date | null = null;
    let cursorId: string | null = null;
    if (q.cursor) {
      const idx = q.cursor.lastIndexOf(":");
      if (idx > 0) {
        const d = new Date(q.cursor.slice(0, idx));
        if (!isNaN(d.getTime())) {
          cursorDate = d;
          cursorId = q.cursor.slice(idx + 1);
        }
      }
    }

    const where: Record<string, unknown> = {};
    if (q.tenantId) where.tenantId = q.tenantId;
    if (q.actorType) where.actorType = q.actorType;
    if (q.actionPrefix) where.action = { startsWith: q.actionPrefix };
    if (q.from || q.to) {
      const cf: Record<string, Date> = {};
      if (q.from) cf.gte = new Date(q.from);
      if (q.to) cf.lte = new Date(q.to);
      where.createdAt = cf;
    }

    // Cursor: wir suchen Eintraege STRENG vor (createdAt, id) des Cursors.
    // Weil wir desc sortieren, ist "vor" das, was kleiner ist.
    if (cursorDate && cursorId) {
      where.OR = [
        { createdAt: { lt: cursorDate } },
        {
          AND: [
            { createdAt: cursorDate },
            { id: { lt: cursorId } },
          ],
        },
      ];
    }

    // limit+1 holen um zu wissen ob's eine naechste Seite gibt
    const events = await prisma.event.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: q.limit + 1,
      select: {
        id: true,
        tenantId: true,
        actorType: true,
        actorId: true,
        action: true,
        targetType: true,
        targetId: true,
        payload: true,
        ipAddress: true,
        createdAt: true,
        tenant: { select: { name: true, displayName: true, slug: true } },
      },
    });

    const hasMore = events.length > q.limit;
    const rows = hasMore ? events.slice(0, q.limit) : events;
    const last = rows[rows.length - 1];
    const nextCursor =
      hasMore && last ? `${last.createdAt.toISOString()}:${last.id}` : null;

    return {
      events: rows.map((e) => ({
        id: e.id,
        tenantId: e.tenantId,
        tenantName: e.tenant
          ? e.tenant.displayName ?? e.tenant.name
          : null,
        tenantSlug: e.tenant?.slug ?? null,
        actorType: e.actorType,
        actorId: e.actorId,
        action: e.action,
        targetType: e.targetType,
        targetId: e.targetId,
        payload: e.payload,
        ipAddress: e.ipAddress,
        createdAt: e.createdAt,
      })),
      nextCursor,
    };
    void reply;
  });

  // -------------------------------------------------------------------------
  // GET /super/audit-log/distinct-actions
  // -------------------------------------------------------------------------
  // Liefert alle vorhandenen distinct-action-Strings — fuer das Filter-
  // Dropdown im Frontend. Cached koennten wir das spaeter, aber bei der
  // aktuellen Groesse reicht ein groupBy.
  app.get("/super/audit-log/distinct-actions", async (req) => {
    req.requireSuperAdmin();
    const grouped = await prisma.event.groupBy({
      by: ["action"],
      _count: { _all: true },
      orderBy: { _count: { action: "desc" } },
      take: 100,
    });
    return {
      actions: grouped.map((g) => ({
        action: g.action,
        count: g._count._all,
      })),
    };
  });
}
