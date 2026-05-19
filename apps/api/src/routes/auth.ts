/**
 * Lumio API — Authentication Routes
 *
 *   POST   /auth/login         — E-Mail + Passwort. Liefert entweder eine
 *                                 Session ODER {requiresTotp, challenge}
 *                                 wenn 2FA aktiv ist.
 *   POST   /auth/login/totp    — Challenge + TOTP-Code → finale Session
 *   POST   /auth/logout        — Session löschen
 *   GET    /auth/me            — aktueller User
 *
 *   POST   /auth/totp/setup    — startet 2FA-Einrichtung (QR-Code)
 *   POST   /auth/totp/activate — verifiziert ersten Token, liefert Backup-Codes
 *   POST   /auth/totp/disable  — 2FA ausschalten (bestätigt mit aktuellem Token)
 *
 * Galerie-Zugang (Kunden-Seite) läuft separat über Tokens, siehe galleries.ts.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { config } from "../config.js";
import {
  createSession,
  deleteSession,
  verifyPassword,
} from "../services/auth.js";
import { SESSION_COOKIE } from "../plugins/auth.js";
import {
  createLoginChallenge,
  verifyLoginChallenge,
} from "../services/loginChallenge.js";
import {
  setupTotp,
  activateTotp,
  disableTotp,
  verifyTotpForUser,
  backupCodeCount,
} from "../services/totp.js";

const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1).max(1000),
});

const loginTotpSchema = z.object({
  challenge: z.string().min(1),
  token: z.string().min(1).max(32),
});

const activateTotpSchema = z.object({
  token: z.string().min(6).max(10),
});

const disableTotpSchema = z.object({
  token: z.string().min(6).max(32),
});

// Pre-computed Argon2id-Hash für ein Dummy-Passwort.
// Wird verwendet, wenn der User nicht existiert, damit `argon2.verify`
// immer in vergleichbarer Zeit läuft (gegen User-Enumeration via Timing).
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$YWFhYWFhYWFhYWFhYWFhYQ$Z9p7n5LcVCwQk6JNQK6Bs3i3qZKgkV2y8ksv9HzC3xc";

const cookieOpts = (maxAgeDays: number) => ({
  path: "/",
  httpOnly: true,
  sameSite: "lax" as const,
  secure: config.NODE_ENV === "production",
  maxAge: maxAgeDays * 24 * 60 * 60,
});

export async function registerAuthRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // POST /auth/login
  // -------------------------------------------------------------------------
  app.post(
    "/auth/login",
    {
      config: {
        rateLimit: { max: 20, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
      const body = loginSchema.parse(req.body);

      if (!req.tenantId) {
        return reply.status(400).send({
          error: "tenant_unresolved",
          message: "Tenant could not be resolved",
        });
      }

      const user = await prisma.user.findUnique({
        where: {
          tenantId_email: { tenantId: req.tenantId, email: body.email },
        },
      });

      const validPwd = user
        ? await verifyPassword(user.passwordHash, body.password)
        : await verifyPassword(DUMMY_HASH, body.password);

      if (!user || user.status !== "active" || !validPwd) {
        return reply.status(401).send({
          error: "invalid_credentials",
          message: "Invalid email or password",
        });
      }

      // 2FA-Zweig
      if (user.totpEnabled) {
        const challenge = createLoginChallenge({
          userId: user.id,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"] ?? null,
        });
        return {
          requiresTotp: true,
          challenge,
        };
      }

      const { token } = await createSession({
        userId: user.id,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"] ?? null,
      });

      reply.setCookie(SESSION_COOKIE, token, cookieOpts(30));

      await prisma.event
        .create({
          data: {
            tenantId: req.tenantId,
            actorType: "user",
            actorId: user.id,
            action: "auth.login",
            ipAddress: req.ip,
          },
        })
        .catch(() => {});

      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      };
    }
  );

  // -------------------------------------------------------------------------
  // POST /auth/login/totp
  // -------------------------------------------------------------------------
  app.post(
    "/auth/login/totp",
    {
      config: {
        rateLimit: { max: 20, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
      const body = loginTotpSchema.parse(req.body);

      const claims = verifyLoginChallenge(body.challenge, {
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"] ?? null,
      });
      if (!claims) {
        return reply
          .status(401)
          .send({ error: "invalid_challenge", message: "Bitte erneut anmelden." });
      }

      const ok = await verifyTotpForUser(claims.uid, body.token);
      if (!ok) {
        return reply
          .status(401)
          .send({ error: "invalid_token", message: "Code nicht korrekt." });
      }

      const user = await prisma.user.findUnique({
        where: { id: claims.uid },
      });
      if (!user || user.status !== "active") {
        return reply.status(401).send({ error: "invalid_credentials" });
      }

      const { token } = await createSession({
        userId: user.id,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"] ?? null,
      });

      reply.setCookie(SESSION_COOKIE, token, cookieOpts(30));

      await prisma.event
        .create({
          data: {
            tenantId: user.tenantId,
            actorType: "user",
            actorId: user.id,
            action: "auth.login.totp",
            ipAddress: req.ip,
          },
        })
        .catch(() => {});

      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      };
    }
  );

  // -------------------------------------------------------------------------
  // POST /auth/totp/setup
  // -------------------------------------------------------------------------
  app.post("/auth/totp/setup", async (req, reply) => {
    const s = req.requireAuth();
    try {
      const result = await setupTotp(s.user.id);
      // secret NICHT zurückgeben — der QR-Code enthält ihn schon und das
      // Frontend braucht ihn nicht im Klartext.
      return {
        qrDataUrl: result.qrDataUrl,
        otpauthUri: result.otpauthUri,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "error";
      return reply.status(400).send({ error: msg });
    }
  });

  // -------------------------------------------------------------------------
  // POST /auth/totp/activate
  // -------------------------------------------------------------------------
  app.post("/auth/totp/activate", async (req, reply) => {
    const s = req.requireAuth();
    const body = activateTotpSchema.parse(req.body);
    try {
      const { backupCodes } = await activateTotp(s.user.id, body.token);
      return { backupCodes };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "error";
      const status = msg === "invalid_token" ? 401 : 400;
      return reply.status(status).send({ error: msg });
    }
  });

  // -------------------------------------------------------------------------
  // POST /auth/totp/disable
  // -------------------------------------------------------------------------
  app.post("/auth/totp/disable", async (req, reply) => {
    const s = req.requireAuth();
    const body = disableTotpSchema.parse(req.body);
    const ok = await disableTotp(s.user.id, body.token);
    if (!ok) {
      return reply.status(401).send({ error: "invalid_token" });
    }
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // POST /auth/logout
  // -------------------------------------------------------------------------
  app.post("/auth/logout", async (req, reply) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await deleteSession(token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // GET /auth/me
  // -------------------------------------------------------------------------
  app.get("/auth/me", async (req, reply) => {
    if (!req.session) {
      return reply.status(401).send({ error: "unauthenticated" });
    }
    const { user } = req.session;
    const remainingBackup = user.totpEnabled
      ? await backupCodeCount(user.id)
      : 0;
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
        totpEnabled: user.totpEnabled,
        backupCodesRemaining: remainingBackup,
      },
    };
  });
}
