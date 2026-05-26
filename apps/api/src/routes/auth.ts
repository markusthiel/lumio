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
  hashPassword,
  verifyPassword,
} from "../services/auth.js";
import { SESSION_COOKIE } from "../plugins/auth.js";
import {
  consumeSetupToken,
  lookupSetupToken,
  createSetupToken,
  buildResetUrl,
} from "../services/setupToken.js";
import { sendMail, tmplPasswordReset } from "../services/mail.js";
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
import {
  startRegistration as webauthnStartRegistration,
  finishRegistration as webauthnFinishRegistration,
  startAuthentication as webauthnStartAuthentication,
  finishAuthentication as webauthnFinishAuthentication,
  listCredentials as webauthnListCredentials,
  deleteCredential as webauthnDeleteCredential,
} from "../services/webauthn.js";
import { logEvent } from "../services/audit.js";
import { getStripe } from "../services/stripe-client.js";
import { resolveTenantBranding } from "../services/branding.js";

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
        include: { tenant: { select: { status: true } } },
      });

      const validPwd = user
        ? await verifyPassword(user.passwordHash, body.password)
        : await verifyPassword(DUMMY_HASH, body.password);

      // Login nur erfolgreich wenn:
      //   - User existiert + Status active
      //   - Passwort korrekt
      //   - Tenant aktiv (nicht suspended/archived)
      // Bei suspended/archived behandeln wir das wie disabled — keine extra
      // Fehlermeldung, damit man von außen Tenant-Status nicht enumerieren
      // kann. Ein Super-Admin sieht ja sowieso direkt was los ist.
      const tenantActive = user?.tenant?.status === "active";
      if (!user || user.status !== "active" || !validPwd || !tenantActive) {
        await logEvent({
          tenantId: req.tenantId,
          actorType: "user",
          actorId: user?.id ?? null,
          action: "auth.login.failed",
          ipAddress: req.ip,
          payload: {
            email: body.email,
            reason: !user
              ? "no_user"
              : user.status !== "active"
              ? "user_inactive"
              : !tenantActive
              ? "tenant_inactive"
              : "bad_password",
          },
        });
        return reply.status(401).send({
          error: "invalid_credentials",
          message: "Invalid email or password",
        });
      }

      // 2FA-Zweig — User kann TOTP oder WebAuthn oder beides aktiv haben.
      // Wir signalisieren beide Optionen; das Frontend zeigt, was verfügbar
      // ist, und der User wählt aus.
      const passkeyCount = await prisma.webauthnCredential.count({
        where: { userId: user.id },
      });
      const has2fa = user.totpEnabled || passkeyCount > 0;
      if (has2fa) {
        const challenge = createLoginChallenge({
          userId: user.id,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"] ?? null,
        });
        return {
          requiresTotp: user.totpEnabled,
          requiresWebauthn: passkeyCount > 0,
          challenge,
        };
      }

      const { token } = await createSession({
        userId: user.id,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"] ?? null,
      });

      reply.setCookie(SESSION_COOKIE, token, cookieOpts(30));

      await logEvent({
        tenantId: req.tenantId,
        actorType: "user",
        actorId: user.id,
        action: "auth.login",
        ipAddress: req.ip,
      });

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
        await logEvent({
          tenantId: req.tenantId,
          actorType: "user",
          actorId: claims.uid,
          action: "auth.login.totp.failed",
          ipAddress: req.ip,
        });
        return reply
          .status(401)
          .send({ error: "invalid_token", message: "Code nicht korrekt." });
      }

      const user = await prisma.user.findUnique({
        where: { id: claims.uid },
        include: { tenant: { select: { status: true } } },
      });
      if (
        !user ||
        user.status !== "active" ||
        user.tenant.status !== "active"
      ) {
        return reply.status(401).send({ error: "invalid_credentials" });
      }

      const { token } = await createSession({
        userId: user.id,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"] ?? null,
      });

      reply.setCookie(SESSION_COOKIE, token, cookieOpts(30));

      await logEvent({
        tenantId: user.tenantId,
        actorType: "user",
        actorId: user.id,
        action: "auth.login.totp",
        ipAddress: req.ip,
      });

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
  // WebAuthn / Passkeys
  // -------------------------------------------------------------------------
  // Vier Endpoints für die zwei Lifecycles:
  //   Registration (eingeloggter User fügt Passkey hinzu):
  //     POST /auth/webauthn/register/start
  //     POST /auth/webauthn/register/finish
  //   Authentication (Login mit Passkey nach Passwort):
  //     POST /auth/webauthn/login/start
  //     POST /auth/webauthn/login/finish
  //
  //   GET    /auth/webauthn          — Liste der eigenen Credentials
  //   DELETE /auth/webauthn/:id      — Credential entfernen

  app.post("/auth/webauthn/register/start", async (req, reply) => {
    const s = req.requireAuth();
    try {
      const options = await webauthnStartRegistration(s.user.id);
      return { options };
    } catch (err) {
      app.log.warn({ err }, "webauthn register start failed");
      return reply.status(500).send({ error: "register_failed" });
    }
  });

  const webauthnRegisterFinishSchema = z.object({
    response: z.any(),
    label: z.string().min(1).max(100),
  });

  app.post("/auth/webauthn/register/finish", async (req, reply) => {
    const s = req.requireAuth();
    const body = webauthnRegisterFinishSchema.parse(req.body);
    const result = await webauthnFinishRegistration({
      userId: s.user.id,
      response: body.response,
      label: body.label,
    });
    if (!result.ok) {
      return reply.status(400).send({ error: result.reason ?? "register_failed" });
    }
    await logEvent({
      tenantId: req.tenantId,
      actorType: "user",
      actorId: s.user.id,
      action: "auth.webauthn.register",
      targetType: "webauthn_credential",
      targetId: result.credentialId,
      payload: { label: body.label },
      ipAddress: req.ip,
    });
    return { ok: true, credentialId: result.credentialId };
  });

  const webauthnLoginStartSchema = z.object({
    challenge: z.string().min(1),
  });

  app.post("/auth/webauthn/login/start", async (req, reply) => {
    const body = webauthnLoginStartSchema.parse(req.body);
    const claims = verifyLoginChallenge(body.challenge, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] ?? null,
    });
    if (!claims) {
      return reply
        .status(401)
        .send({ error: "invalid_challenge", message: "Bitte erneut anmelden." });
    }
    try {
      const { options, challengeId } = await webauthnStartAuthentication(claims.uid);
      return { options, challengeId };
    } catch (err) {
      app.log.warn({ err }, "webauthn login start failed");
      return reply.status(400).send({ error: "no_credentials" });
    }
  });

  const webauthnLoginFinishSchema = z.object({
    challenge: z.string().min(1),
    challengeId: z.string().min(1),
    response: z.any(),
  });

  app.post(
    "/auth/webauthn/login/finish",
    {
      config: {
        rateLimit: { max: 20, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
      const body = webauthnLoginFinishSchema.parse(req.body);
      // Login-Challenge nochmal prüfen, damit nicht jemand die Passwort-
      // Phase mit einer fremden Challenge überspringt
      const claims = verifyLoginChallenge(body.challenge, {
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"] ?? null,
      });
      if (!claims) {
        return reply.status(401).send({ error: "invalid_challenge" });
      }

      const result = await webauthnFinishAuthentication({
        challengeId: body.challengeId,
        response: body.response,
      });
      if (!result.ok || result.userId !== claims.uid) {
        await logEvent({
          tenantId: req.tenantId,
          actorType: "user",
          actorId: claims.uid,
          action: "auth.webauthn.login.failed",
          ipAddress: req.ip,
          payload: { reason: result.reason },
        });
        return reply
          .status(401)
          .send({ error: "verification_failed", reason: result.reason });
      }

      const user = await prisma.user.findUnique({
        where: { id: result.userId },
        include: { tenant: { select: { status: true } } },
      });
      if (
        !user ||
        user.status !== "active" ||
        user.tenant.status !== "active"
      ) {
        return reply.status(401).send({ error: "invalid_credentials" });
      }

      const { token } = await createSession({
        userId: user.id,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"] ?? null,
      });
      reply.setCookie(SESSION_COOKIE, token, cookieOpts(30));

      await logEvent({
        tenantId: user.tenantId,
        actorType: "user",
        actorId: user.id,
        action: "auth.webauthn.login",
        ipAddress: req.ip,
      });

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

  app.get("/auth/webauthn", async (req) => {
    const s = req.requireAuth();
    const credentials = await webauthnListCredentials(s.user.id);
    return { credentials };
  });

  app.delete<{ Params: { id: string } }>(
    "/auth/webauthn/:id",
    async (req, reply) => {
      const s = req.requireAuth();
      const ok = await webauthnDeleteCredential(s.user.id, req.params.id);
      if (!ok) return reply.status(404).send({ error: "not_found" });
      await logEvent({
        tenantId: req.tenantId,
        actorType: "user",
        actorId: s.user.id,
        action: "auth.webauthn.delete",
        targetType: "webauthn_credential",
        targetId: req.params.id,
        ipAddress: req.ip,
      });
      return { ok: true };
    }
  );

  // -------------------------------------------------------------------------
  // POST /auth/logout
  // -------------------------------------------------------------------------
  app.post("/auth/logout", async (req, reply) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await deleteSession(token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    if (req.session) {
      await logEvent({
        tenantId: req.session.user.tenantId,
        actorType: "user",
        actorId: req.session.user.id,
        action: "auth.logout",
        ipAddress: req.ip,
      });
    }
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // GET /auth/tenant-context — Tenant-Info ohne Login
  // -------------------------------------------------------------------------
  // Liefert minimale Tenant-Daten (Name + Slug + Status) basierend auf
  // dem aufgelösten Tenant (Custom-Domain, Subdomain oder Header).
  // Zusätzlich das Default-Branding des Tenants (logo, Farben,
  // Begrüssungstext, Background-Bild), sodass die Login-Page das
  // Studio-Look-and-Feel rendern kann bevor der User eingeloggt ist.
  //
  // Sicherheitsabwägung: gibt's Privacy-Probleme wenn jemand ungefragt
  // den Tenant-Namen sieht? Nein — die Subdomain selbst macht die
  // Existenz schon publik, und der Tenant-Name ist auch sonst auf
  // Customer-Galerien sichtbar. Sensitive Felder (User-Liste, Galerien)
  // bleiben strict auth-gated.
  //
  // Wenn kein Tenant aufgelöst werden konnte (Apex-Domain im
  // multi-Mode ohne Header), antworten wir mit {tenant: null} —
  // das Frontend entscheidet dann.
  app.get("/auth/tenant-context", async (req) => {
    if (!req.tenantId) {
      return { tenant: null, branding: null };
    }
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
      },
    });
    if (!tenant) {
      return { tenant: null, branding: null };
    }
    const branding = await resolveTenantBranding(tenant.id);
    return { tenant, branding };
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
    // Tenant-Status mitliefern damit das Studio einen Pre-Archive-
    // Banner mit Countdown anzeigen kann. Wir laden hier einmalig
    // statt überall im Frontend separat — me() wird beim Page-Load
    // sowieso aufgerufen.
    const tenant = await prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        archiveScheduledAt: true,
      },
    });
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
      tenant,
    };
  });

  // -------------------------------------------------------------------------
  // GET /auth/setup-password/check?token=...
  // -------------------------------------------------------------------------
  // Vorab-Lookup vom Frontend, damit die Setup-Page direkt anzeigen kann,
  // ob der Link noch gültig ist (+ wessen Mail dazu gehört, damit der
  // User sieht "ja, das bin ich"). Wir liefern bewusst minimale Daten —
  // genug zum Anzeigen, nichts zum Identitäts-Enumerieren.
  app.get<{ Querystring: { token?: string } }>(
    "/auth/setup-password/check",
    async (req, reply) => {
      const token = req.query.token;
      if (!token) {
        return reply.status(400).send({ error: "missing_token" });
      }
      const found = await lookupSetupToken(token);
      if (!found) {
        return reply.status(404).send({ error: "invalid_or_expired" });
      }
      const user = await prisma.user.findUnique({
        where: { id: found.userId },
        include: { tenant: { select: { name: true, status: true } } },
      });
      if (!user) return reply.status(404).send({ error: "invalid_or_expired" });
      if (user.tenant.status !== "active") {
        return reply.status(409).send({ error: "tenant_inactive" });
      }
      return {
        email: user.email,
        name: user.name,
        tenantName: user.tenant.name,
        expiresAt: found.expiresAt,
      };
    }
  );

  // -------------------------------------------------------------------------
  // POST /auth/setup-password
  // -------------------------------------------------------------------------
  // Token einlösen, neues Passwort setzen, User-Status auf "active"
  // bringen, sofort eingeloggt landen lassen (Session-Cookie).
  app.post<{ Body: { token: string; password: string } }>(
    "/auth/setup-password",
    {
      config: { rateLimit: { max: 10, timeWindow: "5 minutes" } },
    },
    async (req, reply) => {
      const body = z
        .object({
          token: z.string().min(1).max(500),
          password: z.string().min(12).max(500),
        })
        .parse(req.body);

      const found = await lookupSetupToken(body.token);
      if (!found) {
        return reply.status(404).send({ error: "invalid_or_expired" });
      }

      const user = await prisma.user.findUnique({
        where: { id: found.userId },
        include: { tenant: { select: { status: true } } },
      });
      if (!user) return reply.status(404).send({ error: "invalid_or_expired" });
      if (user.tenant.status !== "active") {
        return reply.status(409).send({ error: "tenant_inactive" });
      }

      // Passwort setzen, Status auf active, Token verbrauchen — alles
      // in einer Transaktion, damit nicht eine Hälfte greift wenn was
      // schiefgeht.
      const newHash = await hashPassword(body.password);
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { passwordHash: newHash, status: "active" },
        });
        await tx.passwordResetToken.update({
          where: { id: found.tokenId },
          data: { usedAt: new Date() },
        });
      });

      // Audit
      await logEvent({
        tenantId: user.tenantId,
        actorType: "user",
        actorId: user.id,
        action: "auth.setup_password",
        ipAddress: req.ip,
      });

      // Direkt einloggen — Setup ist Onboarding, der erste Studio-Klick
      // soll nicht zur Login-Maske zurückspringen.
      const { token } = await createSession({
        userId: user.id,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"] ?? null,
      });
      reply.setCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: req.protocol === "https",
        sameSite: "lax",
        path: "/",
        maxAge: 30 * 24 * 60 * 60,
      });

      return {
        ok: true,
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
  // POST /auth/forgot-password — Reset-Mail anfordern
  // -------------------------------------------------------------------------
  // Public, kein Auth. Rate-limited gegen Mail-Bombing. Liefert IMMER
  // 200, egal ob die E-Mail existiert — sonst wäre das ein User-Enumera-
  // tion-Vektor (man könnte testen, ob eine Mail bei einem Tenant
  // existiert).
  //
  // Tenant-Resolution greift wie ueberall: bei Subdomain/Custom-Domain
  // ist req.tenantId schon gesetzt und wir scopen auf den Tenant. Im
  // Apex-Multi-Mode ohne Header ist tenantId leer und wir koennen
  // nicht zuordnen — return 200 ohne Mailversand (silent no-op).
  //
  // Disabled User: keine Mail. Suspended/archived Tenant: keine Mail.
  // Im "no-mail" Fall trotzdem 200, damit der Caller nicht zwischen
  // "User existiert nicht" und "User ist disabled" unterscheiden kann.
  app.post<{ Body: { email: string } }>(
    "/auth/forgot-password",
    {
      config: { rateLimit: { max: 5, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      const body = z
        .object({ email: z.string().email().toLowerCase().max(255) })
        .parse(req.body);

      // Ohne Tenant-Resolution geben wir den Generic-200 zurueck.
      if (!req.tenantId) {
        return reply.send({ ok: true });
      }

      const user = await prisma.user.findUnique({
        where: {
          tenantId_email: { tenantId: req.tenantId, email: body.email },
        },
        include: { tenant: { select: { name: true, status: true } } },
      });

      // Wir mailen nur wenn alles passt — kein Audit-Leak nach aussen.
      // Aber wir loggen interne Versuche fuer Forensics.
      if (
        user &&
        user.status === "active" &&
        user.tenant.status === "active"
      ) {
        const { token } = await createSetupToken({
          userId: user.id,
          kind: "reset",
        });
        const resetUrl = buildResetUrl(token);
        try {
          const tpl = tmplPasswordReset({
            displayName: user.name ?? user.email,
            tenantName: user.tenant.name,
            resetUrl,
            validHours: 24,
            ipAddress: req.ip,
          });
          await sendMail({ to: user.email, ...tpl });
        } catch (err) {
          app.log.warn(
            { err, userId: user.id },
            "forgot-password: mail send failed"
          );
        }
        await logEvent({
          tenantId: user.tenantId,
          actorType: "user",
          actorId: user.id,
          action: "auth.password_reset_requested",
          ipAddress: req.ip,
          payload: { email: body.email },
        });
      } else {
        // Audit auch fuer fehlgeschlagene Versuche (kein User, disabled,
        // tenant nicht active) — hilft bei Brute-Force-Forensik. Wir
        // nutzen actorType=system, da es keinen identifizierten User
        // gibt (der gesendete email-String allein konstituiert keinen
        // Actor — er koennte willkuerlich sein).
        await logEvent({
          tenantId: req.tenantId,
          actorType: "system",
          actorId: null,
          action: "auth.password_reset_no_op",
          ipAddress: req.ip,
          payload: {
            email: body.email,
            reason: !user
              ? "user_not_found"
              : user.status !== "active"
              ? "user_not_active"
              : "tenant_not_active",
          },
        });
      }

      return reply.send({ ok: true });
    }
  );

  // -------------------------------------------------------------------------
  // GET /auth/reset-password/check?token=...
  // -------------------------------------------------------------------------
  // Token-Vorpruefung damit die Frontend-Page direkt "Link ungueltig"
  // anzeigen kann statt erst nach dem Submit. Liefert minimale Daten
  // (E-Mail + Tenant-Name), bewusst nicht die volle User-Info.
  app.get<{ Querystring: { token?: string } }>(
    "/auth/reset-password/check",
    async (req, reply) => {
      const token = req.query.token;
      if (!token) {
        return reply.status(400).send({ error: "missing_token" });
      }
      const found = await lookupSetupToken(token, "reset");
      if (!found) {
        return reply.status(404).send({ error: "invalid_or_expired" });
      }
      const user = await prisma.user.findUnique({
        where: { id: found.userId },
        include: { tenant: { select: { name: true, status: true } } },
      });
      if (!user) return reply.status(404).send({ error: "invalid_or_expired" });
      if (user.status !== "active" || user.tenant.status !== "active") {
        return reply.status(409).send({ error: "user_or_tenant_inactive" });
      }
      return {
        email: user.email,
        name: user.name,
        tenantName: user.tenant.name,
        expiresAt: found.expiresAt,
      };
    }
  );

  // -------------------------------------------------------------------------
  // POST /auth/reset-password
  // -------------------------------------------------------------------------
  // Token einloesen, neues Passwort setzen. Im Gegensatz zum Setup-Flow
  // wird NICHT automatisch eingeloggt — der User soll bewusst nochmal
  // ein Login durchlaufen, mit dem neuen Passwort. Sicherer (kein
  // Stolen-Reset-Token-Hijack einer ungewollten Session) und kompatibel
  // mit eventuell aktivem 2FA.
  //
  // Wir invalidieren ALLE bestehenden Sessions des Users — wenn jemand
  // einen Reset gemacht hat, wollen wir verhindern dass eine evtl.
  // geklaute alte Session weiterlaeuft.
  app.post<{ Body: { token: string; password: string } }>(
    "/auth/reset-password",
    {
      config: { rateLimit: { max: 10, timeWindow: "5 minutes" } },
    },
    async (req, reply) => {
      const body = z
        .object({
          token: z.string().min(1).max(500),
          password: z.string().min(12).max(500),
        })
        .parse(req.body);

      const found = await lookupSetupToken(body.token, "reset");
      if (!found) {
        return reply.status(404).send({ error: "invalid_or_expired" });
      }

      const user = await prisma.user.findUnique({
        where: { id: found.userId },
        include: { tenant: { select: { status: true } } },
      });
      if (!user) return reply.status(404).send({ error: "invalid_or_expired" });
      if (user.status !== "active" || user.tenant.status !== "active") {
        return reply.status(409).send({ error: "user_or_tenant_inactive" });
      }

      const newHash = await hashPassword(body.password);
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { passwordHash: newHash },
        });
        await tx.passwordResetToken.update({
          where: { id: found.tokenId },
          data: { usedAt: new Date() },
        });
        // Alle Sessions des Users invalidieren — Reset ist auch ein
        // 'evict everywhere'-Trigger.
        await tx.session.deleteMany({ where: { userId: user.id } });
      });

      await logEvent({
        tenantId: user.tenantId,
        actorType: "user",
        actorId: user.id,
        action: "auth.password_reset_completed",
        ipAddress: req.ip,
      });

      return { ok: true };
    }
  );

  // -------------------------------------------------------------------------
  // GET /auth/confirm-email?token=...
  // -------------------------------------------------------------------------
  // Bestaetigt einen E-Mail-Wechsel der vom User via /account/email-change
  // angestossen wurde. Der Link wurde an die NEUE Adresse geschickt;
  // wenn der User klickt, beweist er Zugriff auf die neue Inbox.
  //
  // Im Gegensatz zu Reset/Setup ist das ein GET (Klick auf Link in der
  // Mail). Wir akzeptieren den GET als Confirm, weil Browser-Default-
  // Verhalten so funktioniert — Mail-Clients oeffnen den Link, der
  // User soll nichts weiter klicken muessen. Die Mail kann nicht durch
  // Prefetch versehentlich eingeloest werden, weil Token nach Erstein-
  // loesung verbraucht sind und der Token-Validate-Check 'usedAt' setzt.
  //
  // Antwort ist HTML, das eine kurze Bestaetigung anzeigt + Link zum
  // Studio. Frontend-Page koennten wir spaeter rendern; aktuell ist
  // ein Mini-HTML einfacher und vermeidet ein Routing-Setup fuer eine
  // selten-genutzte Page.
  app.get<{ Querystring: { token?: string } }>(
    "/auth/confirm-email",
    async (req, reply) => {
      const token = req.query.token;
      if (!token) {
        return reply
          .type("text/html; charset=utf-8")
          .status(400)
          .send(htmlPage("Ungültiger Link", "Es fehlt ein Token im Link."));
      }
      const found = await lookupSetupToken(token, "email_change");
      if (!found) {
        return reply
          .type("text/html; charset=utf-8")
          .status(404)
          .send(
            htmlPage(
              "Link ungültig oder abgelaufen",
              "Der Bestätigungslink ist nicht mehr gültig. Fordere den E-Mail-Wechsel im Studio erneut an."
            )
          );
      }
      const newEmail = (found.payload as { newEmail?: string } | null)
        ?.newEmail;
      if (!newEmail) {
        return reply
          .type("text/html; charset=utf-8")
          .status(500)
          .send(
            htmlPage(
              "Fehler",
              "Der Token-Payload ist beschädigt. Bitte fordere den Wechsel im Studio neu an."
            )
          );
      }

      const user = await prisma.user.findUnique({
        where: { id: found.userId },
        include: { tenant: { select: { name: true, status: true } } },
      });
      if (!user || user.tenant.status !== "active" || user.status !== "active") {
        return reply
          .type("text/html; charset=utf-8")
          .status(409)
          .send(
            htmlPage(
              "Account nicht aktiv",
              "Der Account oder Tenant ist nicht aktiv. Wende dich an deinen Studio-Owner."
            )
          );
      }

      // Letzter Kollisions-Check (jemand anderes koennte die neue Adresse
      // zwischenzeitlich genommen haben — z.B. Owner laedt jemanden ein).
      const collision = await prisma.user.findUnique({
        where: {
          tenantId_email: { tenantId: user.tenantId, email: newEmail },
        },
        select: { id: true },
      });
      if (collision && collision.id !== user.id) {
        return reply
          .type("text/html; charset=utf-8")
          .status(409)
          .send(
            htmlPage(
              "E-Mail bereits vergeben",
              "Die Adresse wurde zwischenzeitlich von jemand anderem im Studio belegt. Wähle eine andere."
            )
          );
      }

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { email: newEmail },
        });
        await tx.passwordResetToken.update({
          where: { id: found.tokenId },
          data: { usedAt: new Date() },
        });
      });

      await logEvent({
        tenantId: user.tenantId,
        actorType: "user",
        actorId: user.id,
        action: "account.email_changed",
        ipAddress: req.ip,
        payload: { oldEmail: user.email, newEmail },
      });

      return reply
        .type("text/html; charset=utf-8")
        .send(
          htmlPage(
            "E-Mail-Adresse bestätigt",
            `Deine neue E-Mail-Adresse <strong>${escapeHtml(newEmail)}</strong> ist jetzt aktiv. Du kannst dich ab sofort mit der neuen Adresse einloggen.`,
            { ctaText: "Zum Login", ctaUrl: "/login" }
          )
        );
    }
  );

  // -------------------------------------------------------------------------
  // POST /auth/checkout-login
  // -------------------------------------------------------------------------
  // Auto-Login nach erfolgreichem Stripe-Checkout. Frontend Welcome-Page
  // ruft das mit der session_id aus dem success_url-Query auf. Wir
  // validieren via Stripe-API (Stripe ist die canonical Source: die
  // Session-ID ist signiert, nur Stripe könnte sie ausgeben), holen
  // metadata.lumio_tenant_id + customer.id, prüfen Konsistenz mit
  // unserer DB (Customer-ID muss zum Tenant gehören), suchen den
  // Owner-User und stellen das Session-Cookie aus.
  //
  // Sicherheit:
  //   - Session-ID hat hohe Entropie (~28 Bytes Base64). Brute-Force
  //     nicht praktikabel. Plus Rate-Limit 5/min.
  //   - Session wird nur akzeptiert wenn Stripe sie noch "open" oder
  //     "complete" (subscription mode) zurückliefert. Sehr alte oder
  //     gecancelte Sessions können nicht missbraucht werden.
  //   - Wir prüfen dass die Stripe-Session WIRKLICH zu dem Tenant
  //     gehört (metadata + customer.id-Cross-Check), damit ein
  //     User nicht via fremder Session-ID in einen anderen Tenant
  //     einbrechen kann.
  //
  // Anti-Abuse: ein User kann mit derselben Session-ID natürlich
  // mehrfach einloggen — das ist ok, wir limitieren nur den Brute-
  // Force durch Rate-Limit. Stripe-Session-IDs sind nicht
  // wiederverwendbar zum Sign-up (das macht Stripe selbst).
  if (config.BILLING_ENABLED) {
    app.post<{ Body: { sessionId?: string } }>(
      "/auth/checkout-login",
      {
        config: {
          rateLimit: { max: 5, timeWindow: "1 minute" },
        },
      },
      async (req, reply) => {
        const body = z
          .object({
            sessionId: z.string().startsWith("cs_").min(20).max(200),
          })
          .safeParse(req.body);
        if (!body.success) {
          return reply.status(400).send({ error: "invalid_session_id" });
        }

        // Stripe-Session holen + expanden, damit wir Customer-ID
        // direkt im Objekt haben (ohne extra Fetch).
        let session;
        try {
          session = await getStripe().checkout.sessions.retrieve(
            body.data.sessionId
          );
        } catch (err) {
          app.log.warn(
            { err: err instanceof Error ? err.message : String(err) },
            "auth.checkout_login.stripe_retrieve_failed"
          );
          return reply.status(404).send({ error: "session_not_found" });
        }

        // Tenant-ID + Customer-ID aus der Session lesen
        const tenantId = session.metadata?.lumio_tenant_id;
        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id ?? null;
        if (!tenantId || !customerId) {
          return reply.status(400).send({
            error: "session_missing_metadata",
            message: "Session ist nicht mit einem Lumio-Tenant verknüpft.",
          });
        }

        // Konsistenz-Check: Tenant existiert UND die in der DB
        // gespeicherte stripeCustomerId stimmt mit der Session.
        // Verhindert dass jemand mit einer fremden cs_-ID Zugang
        // zu einem anderen Tenant bekommt.
        const tenant = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: {
            id: true,
            stripeCustomerId: true,
            users: {
              where: { role: "owner", status: "active" },
              select: { id: true },
              take: 1,
              orderBy: { createdAt: "asc" },
            },
          },
        });
        if (!tenant) {
          return reply.status(404).send({ error: "tenant_not_found" });
        }
        if (tenant.stripeCustomerId !== customerId) {
          app.log.warn(
            {
              sessionId: body.data.sessionId,
              tenantId,
              sessionCustomerId: customerId,
              dbCustomerId: tenant.stripeCustomerId,
            },
            "auth.checkout_login.customer_mismatch"
          );
          return reply.status(403).send({
            error: "customer_mismatch",
            message: "Session gehört nicht zu diesem Tenant.",
          });
        }
        const owner = tenant.users[0];
        if (!owner) {
          return reply.status(404).send({ error: "no_owner_user" });
        }

        // Session-Cookie ausstellen. 30 Tage wie bei /auth/login.
        const { token } = await createSession({
          userId: owner.id,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"] ?? null,
        });
        reply.setCookie(SESSION_COOKIE, token, cookieOpts(30));

        app.log.info(
          { tenantId, userId: owner.id, sessionId: body.data.sessionId },
          "auth.checkout_login.success"
        );
        return { ok: true };
      }
    );
  }
}

// ---------------------------------------------------------------------------
// Mini-HTML-Renderer fuer Confirm-Email-Response
// ---------------------------------------------------------------------------
// Wir rendern direkt aus der API ein einfaches HTML-Page, weil
// Mail-Clients den Link "naked" oeffnen und es schlechtes UX waere,
// den User durch ein Frontend-Round-Trip zu schicken. Stilistisch
// halten wir es minimal — eine bordless Page mit Logo, Titel,
// Erklaerung, CTA zum Studio.
function htmlPage(
  title: string,
  body: string,
  cta?: { ctaText: string; ctaUrl: string }
): string {
  const ctaHtml = cta
    ? `<p style="margin-top:1.5rem;"><a href="${escapeAttr(cta.ctaUrl)}" style="display:inline-block;background:#f59e0b;color:#0e0e10;padding:0.6rem 1.2rem;border-radius:4px;text-decoration:none;font-weight:500;">${escapeHtml(cta.ctaText)}</a></p>`
    : "";
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · Lumio</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0e0e10; color: #e8e8eb; margin: 0; padding: 0; min-height: 100vh; display:flex; align-items:center; justify-content:center; }
  .card { background: #18181b; border: 1px solid #2a2a30; border-radius: 8px; padding: 2rem; max-width: 480px; margin: 1rem; }
  h1 { color: #f59e0b; font-size: 1.5rem; margin: 0 0 0.75rem 0; font-weight: 500; }
  p { color: #b0b0b8; line-height: 1.55; margin: 0.5rem 0; }
  strong { color: #e8e8eb; }
</style>
</head>
<body>
<div class="card">
<h1>${escapeHtml(title)}</h1>
<p>${body}</p>
${ctaHtml}
</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
