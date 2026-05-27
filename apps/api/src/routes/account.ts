/**
 * Lumio API — User-Self-Service
 *
 *   GET    /account                — eigene Daten anzeigen
 *   PATCH  /account                — Name aendern (einziges Feld
 *                                    das ohne Re-Auth aenderbar ist)
 *   POST   /account/password       — Passwort aendern (mit Re-Auth)
 *   POST   /account/email-change   — neue E-Mail anfordern (Doppel-
 *                                    Mail: Notice an alt, Confirm-
 *                                    Link an neu)
 *   GET    /auth/confirm-email     — Confirm-Link einloesen (public,
 *                                    siehe auth.ts; hier nur dokumentiert
 *                                    weil das Flow-zusammengehoert)
 *
 * Sicherheit:
 *  - Passwort-Aenderung erfordert das alte Passwort als Re-Auth.
 *    Verhindert dass eine geklaute Session direkt das Passwort
 *    aendern und damit den echten User aussperren kann.
 *  - E-Mail-Aenderung erfordert ebenfalls das aktuelle Passwort.
 *    Plus Double-Opt-In: die neue Adresse muss aktiv bestaetigt
 *    werden, und die alte Adresse bekommt eine Notice (Hijack-Detection).
 *  - Name-Aenderung ist OHNE Re-Auth — geringes Schadenspotenzial,
 *    bessere UX.
 *
 * Bewusst nicht hier:
 *  - 2FA-Setup (totp/webauthn) — eigene Endpoints in auth.ts.
 *
 * Self-Service-Tenant-Loeschung (DSGVO Art. 17):
 *  POST   /account/delete-request          — Loeschung anfordern
 *  POST   /account/delete-request/cancel   — Loeschung zuruecknehmen
 *  GET    /account/deletion-status         — aktuellen Stand abfragen
 *  Nur Owner duerfen das. Doppelte Bestaetigung (Passwort + studioName-
 *  Echo) verhindert versehentliche Loeschung.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { hashPassword, verifyPassword } from "../services/auth.js";
import {
  createSetupToken,
  lookupSetupToken,
  buildEmailChangeUrl,
} from "../services/setupToken.js";
import {
  sendMail,
  tmplEmailChangeConfirm,
  tmplEmailChangeNotice,
} from "../services/mail.js";
import { tenantDisplayName } from "../services/tenant.js";
import { logEvent } from "../services/audit.js";
import {
  requestDeletion,
  cancelDeletion,
} from "../services/tenant-deletion.js";


const updateNameSchema = z.object({
  name: z.string().min(1).max(120),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(500),
  newPassword: z.string().min(12).max(500),
});

const changeEmailSchema = z.object({
  currentPassword: z.string().min(1).max(500),
  newEmail: z.string().email().toLowerCase().max(255),
});


export async function registerAccountRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // GET /account — eigene Daten
  // -------------------------------------------------------------------------
  app.get("/account", async (req) => {
    const s = req.requireAuth();
    const user = await prisma.user.findUnique({
      where: { id: s.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        totpEnabled: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });
    // Check for pending email change (kind="email_change", noch
    // nicht eingeloest). Hilfreich fuer die UI, damit der User
    // sieht "du hast einen Wechsel zu xyz@bla angefordert".
    const pendingChange = await prisma.passwordResetToken.findFirst({
      where: {
        userId: s.user.id,
        kind: "email_change",
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { payload: true, expiresAt: true },
      orderBy: { createdAt: "desc" },
    });
    // Tenant-Info — wird in der UI gebraucht fuer Studio-Name-Anzeige
    // (z.B. Danger-Zone) und um den Pending-Deletion-State sichtbar
    // zu machen (Banner global im Layout).
    const tenant = await prisma.tenant.findUnique({
      where: { id: s.user.tenantId },
      select: {
        id: true,
        name: true,
        displayName: true,
        status: true,
        selfDeletionScheduledFor: true,
      },
    });
    return {
      user,
      pendingEmailChange: pendingChange
        ? {
            newEmail: (pendingChange.payload as { newEmail?: string } | null)
              ?.newEmail,
            expiresAt: pendingChange.expiresAt,
          }
        : null,
      tenant: tenant
        ? {
            id: tenant.id,
            name: tenant.name,
            displayName: tenant.displayName,
            status: tenant.status,
            selfDeletionScheduledFor:
              tenant.selfDeletionScheduledFor?.toISOString() ?? null,
          }
        : null,
    };
  });

  // -------------------------------------------------------------------------
  // PATCH /account — Name aendern
  // -------------------------------------------------------------------------
  app.patch("/account", async (req) => {
    const s = req.requireAuth();
    const body = updateNameSchema.parse(req.body);
    const updated = await prisma.user.update({
      where: { id: s.user.id },
      data: { name: body.name },
      select: { id: true, email: true, name: true, role: true, status: true },
    });
    await logEvent({
      tenantId: s.user.tenantId,
      actorType: "user",
      actorId: s.user.id,
      action: "account.name_updated",
      targetType: "user",
      targetId: s.user.id,
      payload: { name: body.name },
      ipAddress: req.ip,
    });
    return { user: updated };
  });

  // -------------------------------------------------------------------------
  // POST /account/password — Passwort aendern
  // -------------------------------------------------------------------------
  // Erfordert das aktuelle Passwort als Re-Auth. Bei Erfolg werden
  // alle ANDEREN Sessions invalidiert — die aktuelle bleibt aktiv
  // (sonst wuerde der User direkt rausfliegen, was schlechtes UX
  // waere; und ein Angreifer mit alter Session kann nichts mehr
  // damit anfangen).
  app.post(
    "/account/password",
    {
      config: { rateLimit: { max: 10, timeWindow: "5 minutes" } },
    },
    async (req, reply) => {
      const s = req.requireAuth();
      const body = changePasswordSchema.parse(req.body);

      // Aktuellen Hash holen
      const u = await prisma.user.findUnique({
        where: { id: s.user.id },
        select: { id: true, passwordHash: true },
      });
      if (!u) return reply.status(404).send({ error: "user_not_found" });

      const ok = await verifyPassword(u.passwordHash, body.currentPassword);
      if (!ok) {
        await logEvent({
          tenantId: s.user.tenantId,
          actorType: "user",
          actorId: s.user.id,
          action: "account.password_change_failed",
          ipAddress: req.ip,
          payload: { reason: "wrong_current_password" },
        });
        return reply.status(401).send({
          error: "wrong_current_password",
          message: "Aktuelles Passwort ist nicht korrekt.",
        });
      }

      const newHash = await hashPassword(body.newPassword);
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: u.id },
          data: { passwordHash: newHash },
        });
        // Alle ANDEREN Sessions ausser der aktuellen invalidieren.
        await tx.session.deleteMany({
          where: { userId: u.id, tokenHash: { not: s.session.tokenHash } },
        });
      });

      await logEvent({
        tenantId: s.user.tenantId,
        actorType: "user",
        actorId: s.user.id,
        action: "account.password_changed",
        ipAddress: req.ip,
      });

      return { ok: true };
    }
  );

  // -------------------------------------------------------------------------
  // POST /account/email-change — neue E-Mail anfordern
  // -------------------------------------------------------------------------
  // Re-Auth via Current-Password + Double-Opt-In:
  //   1) wir validieren Passwort
  //   2) pruefen, dass die neue Adresse im selben Tenant nicht
  //      bereits vergeben ist
  //   3) erzeugen einen email_change-Token mit payload={newEmail}
  //   4) schicken Bestaetigungsmail an die NEUE Adresse
  //   5) schicken Info-Mail an die ALTE Adresse
  //   6) Wechsel passiert erst beim Klick auf den Confirm-Link
  //      (separater Endpoint /auth/confirm-email).
  app.post(
    "/account/email-change",
    {
      config: { rateLimit: { max: 5, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      const s = req.requireAuth();
      const body = changeEmailSchema.parse(req.body);

      const u = await prisma.user.findUnique({
        where: { id: s.user.id },
        include: {
          tenant: { select: { name: true, displayName: true } },
        },
      });
      if (!u) return reply.status(404).send({ error: "user_not_found" });

      // Re-Auth
      const ok = await verifyPassword(u.passwordHash, body.currentPassword);
      if (!ok) {
        return reply.status(401).send({
          error: "wrong_current_password",
          message: "Aktuelles Passwort ist nicht korrekt.",
        });
      }

      // No-op wenn die neue Adresse identisch ist
      if (body.newEmail === u.email) {
        return reply.status(409).send({
          error: "same_email",
          message: "Die neue Adresse ist identisch mit deiner aktuellen.",
        });
      }

      // Kollision im selben Tenant: jemand anders hat die Adresse schon
      const collision = await prisma.user.findUnique({
        where: {
          tenantId_email: { tenantId: u.tenantId, email: body.newEmail },
        },
        select: { id: true },
      });
      if (collision) {
        return reply.status(409).send({
          error: "email_taken",
          message: "Diese E-Mail-Adresse ist im Studio bereits vergeben.",
        });
      }

      const { token } = await createSetupToken({
        userId: u.id,
        kind: "email_change",
        payload: { newEmail: body.newEmail, oldEmail: u.email },
      });
      const confirmUrl = buildEmailChangeUrl(token);
      const publicTenantName = tenantDisplayName(u.tenant);

      // Bestaetigungsmail an die NEUE Adresse. Mail-Fehler hier ist
      // kritisch (User koennte sich aussperren wenn er die Adresse
      // schon erwartet) — wir geben 502 zurueck wenn der Mailversand
      // fehlschlaegt, damit der Frontend-User es nochmal versuchen
      // kann statt zu glauben es waere durch.
      try {
        const tplConfirm = tmplEmailChangeConfirm({
          displayName: u.name ?? u.email,
          tenantName: publicTenantName,
          oldEmail: u.email,
          newEmail: body.newEmail,
          confirmUrl,
          validHours: 24,
        });
        await sendMail({ to: body.newEmail, ...tplConfirm });
      } catch (err) {
        // Token loeschen damit kein Geister-Wechsel haengenbleibt
        await prisma.passwordResetToken.deleteMany({
          where: { userId: u.id, kind: "email_change", usedAt: null },
        });
        app.log.error(
          { err, userId: u.id },
          "email-change: confirm mail failed"
        );
        return reply.status(502).send({
          error: "mail_send_failed",
          message:
            "Die Bestätigungsmail konnte nicht versendet werden. Versuche es bitte gleich erneut.",
        });
      }

      // Info-Mail an die ALTE Adresse — best-effort, kein Hard-Fail.
      try {
        const tplNotice = tmplEmailChangeNotice({
          displayName: u.name ?? u.email,
          tenantName: publicTenantName,
          newEmail: body.newEmail,
        });
        await sendMail({ to: u.email, ...tplNotice });
      } catch (err) {
        app.log.warn(
          { err, userId: u.id },
          "email-change: notice mail to old address failed"
        );
      }

      await logEvent({
        tenantId: u.tenantId,
        actorType: "user",
        actorId: u.id,
        action: "account.email_change_requested",
        ipAddress: req.ip,
        payload: { oldEmail: u.email, newEmail: body.newEmail },
      });

      return { ok: true, newEmail: body.newEmail };
    }
  );

  // -------------------------------------------------------------------------
  // DELETE /account/email-change — ausstehenden Wechsel zurueckziehen
  // -------------------------------------------------------------------------
  app.delete("/account/email-change", async (req) => {
    const s = req.requireAuth();
    const deleted = await prisma.passwordResetToken.deleteMany({
      where: { userId: s.user.id, kind: "email_change", usedAt: null },
    });
    if (deleted.count > 0) {
      await logEvent({
        tenantId: s.user.tenantId,
        actorType: "user",
        actorId: s.user.id,
        action: "account.email_change_cancelled",
        ipAddress: req.ip,
      });
    }
    return { ok: true, cancelled: deleted.count };
  });

  // ===========================================================================
  // Self-Service Tenant-Loeschung
  // ===========================================================================

  /**
   * POST /account/delete-request
   * Body: { password: string, confirmStudioName: string }
   *
   * Doppelte Bestaetigung:
   *   1. Re-Auth via Passwort (geklaute Session kann nicht einfach loeschen)
   *   2. Studio-Name muss exakt eingetippt werden (UI-side schon, hier nochmal
   *      defensiv)
   *
   * Nur Owner duerfen das anfordern. Team-Mitglieder, Admins, etc. nicht —
   * sonst koennte ein "Team-Verraeter" mit Zugriff das ganze Studio killen.
   */
  app.post("/account/delete-request", async (req, reply) => {
    const s = req.requireAuth();

    const body = z
      .object({
        password: z.string().min(1),
        confirmStudioName: z.string().min(1),
      })
      .parse(req.body);

    if (s.user.role !== "owner") {
      return reply.status(403).send({
        error: "owner_required",
        message: "Nur der Studio-Owner kann das Studio loeschen.",
      });
    }

    const fresh = await prisma.user.findUnique({
      where: { id: s.user.id },
      select: { passwordHash: true },
    });
    if (!fresh || !(await verifyPassword(body.password, fresh.passwordHash))) {
      return reply.status(401).send({
        error: "password_wrong",
        message: "Passwort ist nicht korrekt.",
      });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: s.user.tenantId },
      select: { name: true },
    });
    if (!tenant) return reply.status(404).send({ error: "tenant_not_found" });
    if (
      body.confirmStudioName.trim().toLowerCase() !==
      tenant.name.trim().toLowerCase()
    ) {
      return reply.status(400).send({
        error: "studio_name_mismatch",
        message: "Der eingegebene Studio-Name stimmt nicht.",
      });
    }

    const result = await requestDeletion({
      tenantId: s.user.tenantId,
      requestedById: s.user.id,
      ipAddress: req.ip,
    });

    return {
      status: result.status,
      scheduledFor: result.scheduledFor.toISOString(),
    };
  });

  /**
   * POST /account/delete-request/cancel
   * Loeschung zuruecknehmen waehrend der Karenzphase.
   */
  app.post("/account/delete-request/cancel", async (req, reply) => {
    const s = req.requireAuth();

    if (s.user.role !== "owner") {
      return reply.status(403).send({
        error: "owner_required",
        message: "Nur der Studio-Owner kann die Loeschung zuruecknehmen.",
      });
    }

    const result = await cancelDeletion({
      tenantId: s.user.tenantId,
      cancelledById: s.user.id,
      ipAddress: req.ip,
    });

    return { status: result.status };
  });

  /**
   * GET /account/deletion-status
   * Liefert den aktuellen Stand. Wird vom Frontend genutzt um den
   * Banner mit Countdown anzuzeigen.
   */
  app.get("/account/deletion-status", async (req) => {
    const s = req.requireAuth();
    const tenant = await prisma.tenant.findUnique({
      where: { id: s.user.tenantId },
      select: {
        status: true,
        selfDeletionRequestedAt: true,
        selfDeletionScheduledFor: true,
      },
    });
    return {
      isPendingDeletion: tenant?.status === "pending_deletion",
      requestedAt: tenant?.selfDeletionRequestedAt?.toISOString() ?? null,
      scheduledFor: tenant?.selfDeletionScheduledFor?.toISOString() ?? null,
    };
  });
}
