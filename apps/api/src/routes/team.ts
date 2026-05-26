/**
 * Lumio API — Team-Management (Tenant-intern)
 *
 *   GET    /team                — Liste aller User im aktuellen Tenant
 *   POST   /team                — User einladen (Setup-Mail)
 *   POST   /team/:userId/resend — Setup-Token neu erzeugen + Mail
 *   PATCH  /team/:userId        — role / status ändern
 *   DELETE /team/:userId        — User entfernen
 *
 * Permissions:
 *   - GET ist für alle eingeloggten User offen (Team-Liste sehen
 *     gehört zur Selbstverortung; jeder soll wissen wer Kollegen
 *     sind und welche Rollen sie haben).
 *   - Alle schreibenden Aktionen erfordern role='owner'. Der existie-
 *     rende requireOwner-Decorator akzeptiert ALSO Admin — den nehmen
 *     wir hier explizit AUS, weil Admins sonst andere Owner demoten
 *     oder entfernen könnten und sich selbst zum Owner machen.
 *
 * Sicherheitsregeln:
 *   - Letzten aktiven Owner kann man NICHT downgraden/disablen/löschen.
 *     Sonst ist der Tenant verwaist und Self-Service-Recovery nicht
 *     mehr möglich. (Super-Admin könnte zwar einen neuen Owner
 *     einladen, aber der Tenant-Owner soll diesen Weg nicht versehent-
 *     lich blockieren.)
 *   - Du kannst dich selbst nicht löschen — würde dir die Session
 *     unter den Füßen wegziehen und ist als Sicherung gegen Fehlklicks
 *     sinnvoll. Demoten (zu admin/member) ist erlaubt, falls der User
 *     bewusst zurückstufen will.
 *   - Passwort-Reset: bewusst NICHT hier. Owner soll einem User
 *     "Setup-Mail erneut schicken" (resend) können, aber kein Direkt-
 *     reset — Passwort-Reset gehört dem User selbst, sonst gibt's
 *     "Login-Diebstahl"-Angriffsfläche.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import crypto from "node:crypto";

import { prisma } from "../db.js";
import { hashPassword } from "../services/auth.js";
import { createSetupToken, buildSetupUrl } from "../services/setupToken.js";
import { sendMail, tmplOwnerSetup } from "../services/mail.js";
import { logEvent } from "../services/audit.js";


const inviteSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(120),
  role: z.enum(["owner", "admin", "member"]).default("admin"),
});

const updateSchema = z.object({
  role: z.enum(["owner", "admin", "member"]).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  name: z.string().min(1).max(120).optional(),
});


export async function registerTeamRoutes(app: FastifyInstance) {
  /** Helper: aktive Owner zählen. Wird vor Demote/Disable/Delete
   *  geprüft, damit der letzte Owner nicht weg kann. */
  async function activeOwnerCount(tenantId: string): Promise<number> {
    return prisma.user.count({
      where: { tenantId, role: "owner", status: "active" },
    });
  }

  /** Member duerfen das Team gar nicht sehen — nur Owner und Admin.
   *  Mitarbeiter sollen sich auf ihre Galerien konzentrieren, das
   *  Team-Management ist Studio-Leitung. */
  function requireOwnerOrAdmin(req: FastifyRequest) {
    const s = req.requireAuth();
    if (s.user.role !== "owner" && s.user.role !== "admin") {
      throw app.httpErrors.forbidden("owner or admin role required");
    }
    return s;
  }

  /** Schreibende Aktionen sind fuer Owner und Admin offen — mit
   *  Einschraenkungen pro Aktion:
   *  - Admin darf keine Owner anlegen/bearbeiten/loeschen
   *  - Admin darf keinen User zum Owner machen
   *  Diese feineren Regeln werden pro Endpoint geprueft, dieser Helper
   *  filtert nur generell Member raus. */
  function requireOwnerOrAdminWrite(req: FastifyRequest) {
    return requireOwnerOrAdmin(req);
  }

  /** Wirft 403 wenn ein Admin versucht Owner-Rolle zu vergeben oder
   *  einen Owner zu modifizieren/loeschen. Owner duerfen alles
   *  (vorbehaltlich der Last-Owner-Schutzregel). */
  function checkAdminCannotTouchOwner(
    actorRole: string,
    targetRole: string | null,
    newRole: string | null
  ) {
    if (actorRole === "owner") return;
    // Admin: weder Owner-Targets anfassen noch Owner-Rolle vergeben.
    if (targetRole === "owner") {
      throw app.httpErrors.forbidden(
        "Nur Owner können andere Owner verwalten."
      );
    }
    if (newRole === "owner") {
      throw app.httpErrors.forbidden(
        "Nur Owner können die Owner-Rolle vergeben."
      );
    }
  }

  // -------------------------------------------------------------------------
  // GET /team
  // -------------------------------------------------------------------------
  app.get("/team", async (req) => {
    requireOwnerOrAdmin(req);
    const users = await prisma.user.findMany({
      where: { tenantId: req.tenantId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
        totpEnabled: true,
      },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    });
    return { users };
  });

  // -------------------------------------------------------------------------
  // POST /team — neuen User einladen
  // -------------------------------------------------------------------------
  app.post("/team", async (req, reply) => {
    const s = requireOwnerOrAdminWrite(req);
    const body = inviteSchema.parse(req.body);

    // Admin darf keine neuen Owner anlegen — sonst koennte er sich
    // selbst zum Owner-Aequivalent eskalieren ueber Umweg.
    checkAdminCannotTouchOwner(s.user.role, null, body.role);

    // Tenant laden — Name brauchen wir für die Mail-Vorlage.
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      select: { id: true, name: true, status: true },
    });
    if (!tenant || tenant.status !== "active") {
      return reply.status(409).send({
        error: "tenant_inactive",
        message: "Einladung nur für aktive Tenants möglich.",
      });
    }

    // E-Mail-Kollision pro Tenant prüfen.
    const existing = await prisma.user.findUnique({
      where: {
        tenantId_email: {
          tenantId: tenant.id,
          email: body.email.toLowerCase(),
        },
      },
    });
    if (existing) {
      return reply.status(409).send({
        error: "email_taken",
        message: "Es gibt bereits einen User mit dieser E-Mail-Adresse im Team.",
      });
    }

    // Placeholder-Passwort: unbenutzbar (256+ Bit Random), wird vom
    // Setup-Token-Flow überschrieben sobald der eingeladene User
    // sein eigenes Passwort setzt.
    const placeholderHash = await hashPassword(
      crypto.randomUUID() + crypto.randomUUID()
    );
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: body.email.toLowerCase(),
        passwordHash: placeholderHash,
        name: body.name,
        role: body.role,
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
        invitedBy: s.user.name ?? s.user.email,
        validHours: 72,
      });
      await sendMail({ to: body.email, ...tpl });
      mailSent = true;
    } catch (err) {
      app.log.warn(
        { err, userId: user.id },
        "team invite: mail send failed"
      );
    }

    await logEvent({
      tenantId: tenant.id,
      actorType: "user",
      actorId: s.user.id,
      action: "team.invite",
      targetType: "user",
      targetId: user.id,
      payload: { email: body.email, role: body.role, mailSent },
      ipAddress: req.ip,
    });

    return reply.status(201).send({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
      },
      mailSent,
      // Setup-URL nur zurueckgeben falls Mail NICHT durchging — dann
      // kann der einladende Owner den Link manuell weiterleiten.
      // Bei erfolgreichem Mailversand wuerden wir den Token via
      // Response auch ohne grund offenlegen, das wollen wir nicht.
      setupUrl: mailSent ? null : setupUrl,
    });
  });

  // -------------------------------------------------------------------------
  // POST /team/:userId/resend — Setup-Mail neu schicken
  // -------------------------------------------------------------------------
  // Nur fuer User die noch im 'invited'-Status sind. Generiert einen
  // neuen Setup-Token (invalidiert alte) und verschickt Mail.
  app.post<{ Params: { userId: string } }>(
    "/team/:userId/resend",
    async (req, reply) => {
      const s = requireOwnerOrAdminWrite(req);
      const user = await prisma.user.findFirst({
        where: { id: req.params.userId, tenantId: req.tenantId },
      });
      if (!user) return reply.status(404).send({ error: "not_found" });

      // Admin darf einem Owner keine neue Setup-Mail schicken — der
      // Token wuerde dem Admin keinen Owner-Zugriff geben (er landet
      // im Postfach des Owners), aber wir halten die Mauer komplett
      // dicht.
      checkAdminCannotTouchOwner(s.user.role, user.role, null);

      if (user.status !== "invited") {
        return reply.status(409).send({
          error: "not_invited",
          message: "Resend ist nur für User im Status 'eingeladen' möglich.",
        });
      }
      const tenant = await prisma.tenant.findUnique({
        where: { id: req.tenantId },
        select: { name: true },
      });

      const { token } = await createSetupToken({ userId: user.id });
      const setupUrl = buildSetupUrl(token);

      let mailSent = false;
      try {
        const tpl = tmplOwnerSetup({
          displayName: user.name ?? user.email,
          tenantName: tenant?.name ?? "Lumio",
          setupUrl,
          invitedBy: s.user.name ?? s.user.email,
          validHours: 72,
        });
        await sendMail({ to: user.email, ...tpl });
        mailSent = true;
      } catch (err) {
        app.log.warn(
          { err, userId: user.id },
          "team resend: mail send failed"
        );
      }

      await logEvent({
        tenantId: req.tenantId,
        actorType: "user",
        actorId: s.user.id,
        action: "team.resend_invite",
        targetType: "user",
        targetId: user.id,
        payload: { mailSent },
        ipAddress: req.ip,
      });

      return { mailSent, setupUrl: mailSent ? null : setupUrl };
    }
  );

  // -------------------------------------------------------------------------
  // PATCH /team/:userId — role / status / name
  // -------------------------------------------------------------------------
  app.patch<{ Params: { userId: string } }>(
    "/team/:userId",
    async (req, reply) => {
      const s = requireOwnerOrAdminWrite(req);
      const body = updateSchema.parse(req.body);
      const target = await prisma.user.findFirst({
        where: { id: req.params.userId, tenantId: req.tenantId },
      });
      if (!target) return reply.status(404).send({ error: "not_found" });

      // Admin darf weder Owner anfassen noch jemanden zum Owner machen.
      checkAdminCannotTouchOwner(s.user.role, target.role, body.role ?? null);

      // Schutz vor "letztem Owner kappen": Wenn target ein aktiver
      // Owner ist UND der Wechsel ihn deaktiviert oder zu admin/member
      // demoted, müssen mindestens 1 anderer aktiver Owner uebrig
      // bleiben.
      const wouldRemoveOwnerStatus =
        (body.role && body.role !== "owner" && target.role === "owner") ||
        (body.status === "disabled" && target.status === "active" && target.role === "owner");
      if (wouldRemoveOwnerStatus) {
        const count = await activeOwnerCount(req.tenantId);
        if (count <= 1) {
          return reply.status(409).send({
            error: "last_owner",
            message:
              "Mindestens ein aktiver Owner muss übrig bleiben. Bevor du diesen User ändern kannst, mache einen anderen User zum Owner.",
          });
        }
      }

      // Self-disable verbieten — User wuerde sich aussperren.
      // Demote ist erlaubt (bewusste Zurueckstufung).
      if (target.id === s.user.id && body.status === "disabled") {
        return reply.status(409).send({
          error: "cannot_self_disable",
          message: "Du kannst dich nicht selbst deaktivieren.",
        });
      }

      const updated = await prisma.user.update({
        where: { id: target.id },
        data: {
          ...(body.role !== undefined ? { role: body.role } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.name !== undefined ? { name: body.name } : {}),
        },
      });

      // Bei status=disabled alle aktiven Sessions des Users beenden,
      // damit Login-Verlust sofort wirksam wird. validateSession
      // pruft den Status sowieso, aber explizites DELETE ist
      // hygienischer.
      if (body.status === "disabled") {
        await prisma.session.deleteMany({ where: { userId: target.id } });
      }

      await logEvent({
        tenantId: req.tenantId,
        actorType: "user",
        actorId: s.user.id,
        action: "team.update",
        targetType: "user",
        targetId: target.id,
        payload: {
          changes: body,
          previous: {
            role: target.role,
            status: target.status,
            name: target.name,
          },
        },
        ipAddress: req.ip,
      });

      return {
        user: {
          id: updated.id,
          email: updated.email,
          name: updated.name,
          role: updated.role,
          status: updated.status,
        },
      };
    }
  );

  // -------------------------------------------------------------------------
  // DELETE /team/:userId
  // -------------------------------------------------------------------------
  // Hartes Löschen aus dem Tenant. Sessions, API-Tokens, WebAuthn-
  // Credentials gehen via Cascade weg. Galerien dieses Users wandern
  // NICHT mit ihm raus — sie bleiben im Tenant. Gallery.owner hat
  // KEIN onDelete=Cascade, sondern restrict; deshalb pruefen wir
  // unten den Gallery-Count und geben einen klaren 409 mit Hand-
  // lungsempfehlung statt einen Prisma-FK-Fehler. Spaeter sollten
  // wir einen Ownership-Transfer-Endpoint bauen ("Galerien an User X
  // uebergeben"), aktuell muss der einladende Owner das per Gallery-
  // Edit-Flow machen.
  app.delete<{ Params: { userId: string } }>(
    "/team/:userId",
    async (req, reply) => {
      const s = requireOwnerOrAdminWrite(req);
      const target = await prisma.user.findFirst({
        where: { id: req.params.userId, tenantId: req.tenantId },
      });
      if (!target) return reply.status(404).send({ error: "not_found" });

      // Admin darf Owner nicht loeschen.
      checkAdminCannotTouchOwner(s.user.role, target.role, null);

      if (target.id === s.user.id) {
        return reply.status(409).send({
          error: "cannot_self_delete",
          message: "Du kannst dich nicht selbst löschen.",
        });
      }

      if (target.role === "owner") {
        const count = await activeOwnerCount(req.tenantId);
        // Wenn target aktiv ist und der letzte Owner: Stop.
        // Wenn target schon disabled ist, war er sowieso nicht in
        // der activeOwnerCount drin — dann ist's egal.
        if (target.status === "active" && count <= 1) {
          return reply.status(409).send({
            error: "last_owner",
            message:
              "Mindestens ein aktiver Owner muss übrig bleiben.",
          });
        }
      }

      // Galerien-Ownership-Check. Gallery.owner hat KEIN onDelete=
      // Cascade, also wuerde Prisma den Delete mit einer FK-Violation
      // ablehnen. Wir geben dem User stattdessen einen klaren Fehler
      // mit Handlungsempfehlung.
      const galleryCount = await prisma.gallery.count({
        where: { ownerId: target.id },
      });
      if (galleryCount > 0) {
        return reply.status(409).send({
          error: "owns_galleries",
          message: `Dieser User besitzt noch ${galleryCount} ${galleryCount === 1 ? "Galerie" : "Galerien"}. Übertrage die Galerien zuerst an einen anderen User oder lösche sie. Oder deaktiviere den User stattdessen, das blockiert den Login ohne Daten zu verlieren.`,
          galleryCount,
        });
      }

      // Pre-Audit-Log: nach delete koennten wir die Felder nicht mehr
      // lesen, aber wir wollen sie im Audit haben.
      await logEvent({
        tenantId: req.tenantId,
        actorType: "user",
        actorId: s.user.id,
        action: "team.delete",
        targetType: "user",
        targetId: target.id,
        payload: {
          email: target.email,
          role: target.role,
          status: target.status,
        },
        ipAddress: req.ip,
      });

      await prisma.user.delete({ where: { id: target.id } });
      return reply.status(204).send();
    }
  );
}
