/**
 * Lumio API — Super-Admin Authentication Routes
 *
 * Eigene Login-/Logout-/Me-Endpoints, separat vom Tenant-User-Auth.
 * Cookie: SUPER_ADMIN_COOKIE (siehe super-auth.ts).
 *
 * Routes:
 *   POST /super/auth/login    — E-Mail + Passwort → Session-Cookie
 *   POST /super/auth/logout   — Session löschen + Cookie clearen
 *   GET  /super/auth/me       — aktuell eingeloggten Super-Admin liefern
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import {
  SUPER_ADMIN_COOKIE,
  createSuperAdminSession,
  revokeSuperAdminSession,
  verifySuperAdminPassword,
} from "../services/super-auth.js";
import { logEvent } from "../services/audit.js";

const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(500),
});

// Dummy-Hash, damit Login-Anfragen mit unbekannter E-Mail dieselbe
// CPU-Last erzeugen wie mit echter — verhindert Timing-Enumeration.
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$ZHVtbXlzYWx0ZHVtbXlzYWx0$" +
  "abcdefghijklmnopqrstuvwxyz0123456789abcd";

export async function registerSuperAuthRoutes(app: FastifyInstance) {
  app.post(
    "/super/auth/login",
    {
      config: {
        rateLimit: { max: 10, timeWindow: "5 minutes" },
      },
    },
    async (req, reply) => {
      const body = loginSchema.parse(req.body);

      const admin = await prisma.superAdmin.findUnique({
        where: { email: body.email.toLowerCase() },
      });

      // Wir verifizieren immer ein Passwort — auch wenn admin null ist,
      // gegen den Dummy-Hash. Sonst verrät die Antwortzeit, ob die
      // E-Mail existiert.
      const validPwd = admin
        ? await verifySuperAdminPassword(admin.passwordHash, body.password)
        : await verifySuperAdminPassword(DUMMY_HASH, body.password);

      if (!admin || !validPwd) {
        // Audit: failed login (kein tenantId — Super-Admin ist global)
        await logEvent({
          tenantId: null,
          actorType: "super_admin",
          actorId: admin?.id ?? null,
          action: "super.login.failed",
          ipAddress: req.ip,
          payload: { email: body.email, reason: !admin ? "no_user" : "bad_password" },
        });
        return reply.status(401).send({
          error: "invalid_credentials",
          message: "Invalid email or password",
        });
      }

      const { token } = await createSuperAdminSession({
        superAdminId: admin.id,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"] ?? null,
      });

      await prisma.superAdmin.update({
        where: { id: admin.id },
        data: { lastLoginAt: new Date() },
      });

      await logEvent({
        tenantId: null,
        actorType: "super_admin",
        actorId: admin.id,
        action: "super.login.success",
        ipAddress: req.ip,
      });

      reply.setCookie(SUPER_ADMIN_COOKIE, token, {
        httpOnly: true,
        secure: req.protocol === "https",
        sameSite: "lax",
        path: "/",
        maxAge: 30 * 24 * 60 * 60, // 30 Tage in Sekunden
      });

      return {
        admin: {
          id: admin.id,
          email: admin.email,
          displayName: admin.displayName,
        },
      };
    }
  );

  app.post("/super/auth/logout", async (req, reply) => {
    if (req.superAdmin) {
      await revokeSuperAdminSession(req.superAdmin.session.id);
      await logEvent({
        tenantId: null,
        actorType: "super_admin",
        actorId: req.superAdmin.admin.id,
        action: "super.logout",
        ipAddress: req.ip,
      });
    }
    reply.clearCookie(SUPER_ADMIN_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/super/auth/me", async (req, reply) => {
    if (!req.superAdmin) {
      return reply.status(401).send({ error: "not_authenticated" });
    }
    return {
      admin: {
        id: req.superAdmin.admin.id,
        email: req.superAdmin.admin.email,
        displayName: req.superAdmin.admin.displayName,
        lastLoginAt: req.superAdmin.admin.lastLoginAt,
      },
    };
  });
}
