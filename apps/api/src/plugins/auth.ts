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
import { isTenantOperational } from "../services/tenant.js";
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
                impersonatedBySuperAdminId: null,
                createdAt: new Date(),
              },
              isImpersonated: false,
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
  // (1) Eingeloggter User. Hat absolute Priorität — wenn ein Cookie
  //     einen Tenant A trägt, kann ein X-Lumio-Tenant-Header für
  //     Tenant B das NICHT überstimmen. Sonst hätte jemand mit einem
  //     gültigen Cookie für A einfach durch Header-Manipulation auf
  //     B zugreifen können.
  if (req.session?.user.tenantId) {
    return req.session.user.tenantId;
  }

  // (2) Expliziter X-Lumio-Tenant-Header. Vor allem für die Mobile-App
  //     gedacht, die über die nackte API-URL (z.B. studio.lumio-cloud.de)
  //     spricht — ohne Subdomain, ohne Custom-Domain. Der Header
  //     trägt den Tenant-Slug; wir matchen auf tenants.slug.
  //
  //     Sicherheit: nur akzeptiert wenn KEIN Session-Cookie da ist
  //     (siehe oben). Wer eine Login-Anfrage mit Header schickt, kann
  //     nur Tenants ansprechen, in denen er auch Credentials hat —
  //     der Login-Pfad prüft tenantId + email zusammen.
  const headerSlug = req.headers["x-lumio-tenant"];
  if (typeof headerSlug === "string" && headerSlug.length > 0) {
    const slug = headerSlug.trim().toLowerCase();
    if (/^[a-z0-9-]+$/.test(slug) && slug.length <= 40) {
      const byHeader = await prisma.tenant.findUnique({
        where: { slug },
        select: { id: true, status: true },
      });
      if (byHeader && isTenantOperational(byHeader.status)) return byHeader.id;
    }
  }

  // (3) Custom Domain
  const host = (req.headers.host ?? "").split(":")[0].toLowerCase();
  if (host) {
    const byDomain = await prisma.tenant.findFirst({
      where: {
        customDomain: host,
        status: { in: ["active", "pending_deletion"] },
      },
      select: { id: true },
    });
    if (byDomain) return byDomain.id;
  }

  // (4) Subdomain
  // Reservierte Subdomains werden NICHT als Tenant-Slug interpretiert:
  // - www = klassischer Apex-Alias
  // - studio = zentraler Studio-Login-Host (faellt auf single/default
  //            zurueck und zeigt im Multi-Mode den Apex-Picker-Flow)
  // - api, admin, app = generische Service-Hostnames die Tenants nicht
  //            kapern duerfen
  // Diese Liste muss synchron mit RESERVED_SLUGS in super-tenants
  // bleiben (Tenant-Anlage verbietet diese Slugs).
  const RESERVED_SUBDOMAINS = new Set(["www", "studio", "api", "admin", "app"]);
  const base = process.env.LUMIO_DOMAIN_BASE?.toLowerCase();
  if (base && host.endsWith("." + base)) {
    const slug = host.slice(0, -(base.length + 1));
    if (slug && !RESERVED_SUBDOMAINS.has(slug)) {
      const bySlug = await prisma.tenant.findUnique({
        where: { slug },
        select: { id: true, status: true },
      });
      if (bySlug && isTenantOperational(bySlug.status)) return bySlug.id;
    }
  }

  // (5) Single-Mode-Fallback
  const single = await getDefaultTenantId();
  if (single) return single;

  // (6) Im multi-Mode ohne Auflösung — Caller entscheidet, ob das ein Fehler ist.
  //     Wir setzen einen leeren String, jede Route die einen Tenant braucht,
  //     prüft das selbst (oder via requireTenant()).
  return "";
}

export default fp(plugin, { name: "lumio-auth" });
