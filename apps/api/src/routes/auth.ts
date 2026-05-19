/**
 * Lumio API — Authentication Routes
 *
 *   POST   /auth/login      — E-Mail + Passwort
 *   POST   /auth/logout     — Session löschen
 *   GET    /auth/me         — aktueller User
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

const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1).max(1000),
  totpCode: z.string().optional(),
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
        rateLimit: { max: 20, timeWindow: "1 minute" }, // gegen Brute-Force
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

      // Konstantes Timing: auch bei nicht existentem User wird ein Hash verifiziert
      const validPwd = user
        ? await verifyPassword(user.passwordHash, body.password)
        : await verifyPassword(DUMMY_HASH, body.password);

      if (!user || user.status !== "active" || !validPwd) {
        return reply.status(401).send({
          error: "invalid_credentials",
          message: "Invalid email or password",
        });
      }

      // 2FA — vollständige Implementierung in Phase 2 (Roadmap)
      if (user.totpEnabled) {
        return reply
          .status(501)
          .send({ error: "not_implemented", message: "2FA pending" });
      }

      const { token } = await createSession({
        userId: user.id,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"] ?? null,
      });

      reply.setCookie(SESSION_COOKIE, token, cookieOpts(30));

      // Audit — Failures dürfen den Login nicht torpedieren
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
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
        totpEnabled: user.totpEnabled,
      },
    };
  });
}
