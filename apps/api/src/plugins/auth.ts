/**
 * Lumio API — Auth & Tenant Plugins
 *
 * Hängt zwei Decorator-Felder an jeden Request:
 *
 *   request.session:  null | { user, session }    — nur wenn Cookie gesetzt + gültig
 *   request.tenantId: string                      — aktiver Tenant (immer gesetzt)
 *
 * Plus zwei Hilfen:
 *
 *   request.requireAuth():    wirft 401, wenn nicht eingeloggt
 *   request.requireOwner():   wirft 403, wenn user.role !== "owner"
 *
 * Tenant-Auflösung (in dieser Reihenfolge):
 *   1) Eingeloggter User → user.tenantId
 *   2) Custom Domain     → tenants.custom_domain = Host-Header
 *   3) Subdomain         → tenants.slug = leftmost label, wenn LUMIO_DOMAIN_BASE gesetzt
 *   4) Single-Mode       → der einzige Tenant
 *   5) Sonst             → 400 (im multi-Mode unauflösbar)
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";

import { config } from "../config.js";
import { prisma } from "../db.js";
import { getDefaultTenantId } from "../bootstrap.js";
import { validateSession, type SessionContext } from "../services/auth.js";
import { validateApiToken } from "../services/apiToken.js";

export const SESSION_COOKIE = "lumio_session";

declare module "fastify" {
  interface FastifyRequest {
    session: SessionContext | null;
    tenantId: string;
    requireAuth(): SessionContext;
    requireOwner(): SessionContext;
  }
}

async function plugin(app: FastifyInstance) {
  app.decorateRequest("session", null);
  app.decorateRequest("tenantId", "");

  app.decorateRequest("requireAuth", function (this: FastifyRequest) {
    if (!this.session) {
      throw app.httpErrors.unauthorized("authentication required");
    }
    return this.session;
  });

  app.decorateRequest("requireOwner", function (this: FastifyRequest) {
    const s = this.requireAuth();
    if (s.user.role !== "owner" && s.user.role !== "admin") {
      throw app.httpErrors.forbidden("owner role required");
    }
    return s;
  });

  app.addHook("preHandler", async (req: FastifyRequest, _reply: FastifyReply) => {
    // 1a) Session aus Cookie auflösen
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) {
      req.session = await validateSession(token);
    }

    // 1b) Bearer-Token (Plugin/CLI) — wenn kein Cookie-Session da ist.
    //     Cookie hat Priorität, weil Browser-Sessions die Norm sind. Plugins
    //     schicken nur Authorization, nie Cookies.
    if (!req.session) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        const bearer = authHeader.slice("Bearer ".length).trim();
        const result = await validateApiToken(bearer);
        if (result) {
          // User-Daten holen, damit req.session dieselbe Shape hat wie bei
          // Cookie-Auth. SessionContext erwartet {user, session} — bei
          // Bearer-Tokens haben wir keine 'session'-Row, also bauen wir
          // eine pseudo aus dem ApiToken-Eintrag.
          const user = await prisma.user.findUnique({
            where: { id: result.userId },
          });
          if (user && user.status === "active") {
            // Pseudo-Session-Objekt, damit req.session dieselbe Shape hat
            // wie bei Cookie-Login. Wir haben keine echte sessions-Row,
            // nutzen die Token-ID stattdessen — die Felder werden in
            // den Routen entweder gar nicht oder nur als Anzeige verwendet.
            req.session = {
              user,
              session: {
                id: result.tokenId,
                userId: user.id,
                tokenHash: "",
                expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
                ipAddress: req.ip,
                userAgent: req.headers["user-agent"] ?? null,
                createdAt: new Date(),
              },
            };
          }
        }
      }
    }

    // 2. Tenant auflösen
    req.tenantId = await resolveTenant(req);
  });
}

async function resolveTenant(req: FastifyRequest): Promise<string> {
  // (1) Eingeloggter User
  if (req.session?.user.tenantId) {
    return req.session.user.tenantId;
  }

  // (2) Custom Domain
  const host = (req.headers.host ?? "").split(":")[0].toLowerCase();
  if (host) {
    const byDomain = await prisma.tenant.findFirst({
      where: { customDomain: host, status: "active" },
      select: { id: true },
    });
    if (byDomain) return byDomain.id;
  }

  // (3) Subdomain
  const base = process.env.LUMIO_DOMAIN_BASE?.toLowerCase();
  if (base && host.endsWith("." + base)) {
    const slug = host.slice(0, -(base.length + 1));
    if (slug && slug !== "www") {
      const bySlug = await prisma.tenant.findUnique({
        where: { slug },
        select: { id: true, status: true },
      });
      if (bySlug && bySlug.status === "active") return bySlug.id;
    }
  }

  // (4) Single-Mode-Fallback
  const single = await getDefaultTenantId();
  if (single) return single;

  // (5) Im multi-Mode ohne Auflösung — Caller entscheidet, ob das ein Fehler ist.
  //     Wir setzen einen leeren String, jede Route die einen Tenant braucht,
  //     prüft das selbst (oder via requireTenant()).
  return "";
}

export default fp(plugin, { name: "lumio-auth" });
