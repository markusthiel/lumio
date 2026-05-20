/**
 * Lumio API — Super-Admin Auth Plugin
 *
 * Hängt request.superAdmin an (null wenn nicht eingeloggt) und stellt
 * einen Guard request.requireSuperAdmin() bereit. Liest den eigenen
 * Cookie SUPER_ADMIN_COOKIE.
 *
 * Hooks: läuft als preHandler AFTER der normalen Auth — wir lesen das
 * Cookie unabhängig vom normalen Session-Cookie und stören das Tenant-
 * Resolving nicht.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";

import {
  lookupSuperAdminSession,
  SUPER_ADMIN_COOKIE,
  type SuperAdminContext,
} from "../services/super-auth.js";

declare module "fastify" {
  interface FastifyRequest {
    superAdmin: SuperAdminContext | null;
    requireSuperAdmin(): SuperAdminContext;
  }
}

async function plugin(app: FastifyInstance) {
  app.decorateRequest("superAdmin", null);

  app.decorateRequest("requireSuperAdmin", function (this: FastifyRequest) {
    if (!this.superAdmin) {
      throw app.httpErrors.unauthorized("super-admin authentication required");
    }
    return this.superAdmin;
  });

  app.addHook(
    "preHandler",
    async (req: FastifyRequest, _reply: FastifyReply) => {
      const token = req.cookies?.[SUPER_ADMIN_COOKIE];
      if (token) {
        req.superAdmin = await lookupSuperAdminSession(token);
      }
    }
  );
}

export default fp(plugin, { name: "lumio-super-admin", dependencies: [] });
