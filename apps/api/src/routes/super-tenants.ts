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
 *   POST   /super/tenants/:id/archive    — Status → archived (hart, nicht reversibel via UI)
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
import { createSetupToken } from "../services/setupToken.js";
import { logEvent } from "../services/audit.js";
import { sendMail, tmplOwnerSetup } from "../services/mail.js";
import { logger } from "../logger.js";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

const createTenantSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(SLUG_RE, "slug must be lowercase letters, digits, hyphens"),
  name: z.string().min(1).max(120),
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
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(SLUG_RE, "slug must be lowercase letters, digits, hyphens")
    .optional(),
  name: z.string().min(1).max(120).optional(),
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

function buildSetupUrl(token: string): string {
  // PUBLIC_URL aus config: voll-qualifizierte Studio-URL (z.B.
  // https://lumio-cloud.de). Der Setup-Link öffnet im Frontend
  // /auth/setup-password?token=...
  const base = config.PUBLIC_URL.replace(/\/+$/, "");
  return `${base}/auth/setup-password?token=${encodeURIComponent(token)}`;
}

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
          status: true,
          customDomain: true,
          createdAt: true,
          updatedAt: true,
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
      return {
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
          name: tenant.name,
          status: tenant.status,
          customDomain: tenant.customDomain,
          createdAt: tenant.createdAt,
          updatedAt: tenant.updatedAt,
          galleryCount: tenant._count.galleries,
          users: tenant.users,
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
  // POST /super/tenants/:id/archive
  // -------------------------------------------------------------------------
  // Archivieren ist semantisch "stillgelegt — sollte über die UI nicht
  // mehr reaktivierbar sein". Wir behalten die Daten (kein DELETE),
  // damit Audit/Recovery via CLI möglich bleibt; aber die UI weigert
  // sich, archivierte Tenants zu reaktivieren oder zu suspendieren.
  // Wenn echt wieder lebendig: SQL bzw. CLI mit Begründung.
  app.post<{ Params: { id: string } }>(
    "/super/tenants/:id/archive",
    async (req, reply) => {
      const sa = req.requireSuperAdmin();
      const t = await prisma.tenant.findUnique({
        where: { id: req.params.id },
      });
      if (!t) return reply.status(404).send({ error: "not_found" });
      const updated = await prisma.tenant.update({
        where: { id: t.id },
        data: { status: "archived" },
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
        ipAddress: req.ip,
      });
      return { tenant: updated };
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
    ] = await Promise.all([
      prisma.tenant.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.user.count(),
      prisma.gallery.count(),
      prisma.file.count(),
    ]);

    return {
      tenants: tenantsByStatus.reduce(
        (acc, row) => ({ ...acc, [row.status]: row._count._all }),
        {} as Record<string, number>
      ),
      totalUsers,
      totalGalleries,
      totalFiles,
    };
  });
}
