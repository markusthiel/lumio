/**
 * Lumio API — API-Token-Routen
 *
 * Studio-User können sich persönliche Access-Tokens für Plugin- und
 * CLI-Zugriff anlegen. Tokens haben dieselben Rechte wie der User selbst
 * (kein Scope-Downgrade derzeit), aber zwei Vorteile gegenüber dem
 * Passwort:
 *   - revozierbar einzeln (z.B. wenn ein Laptop weg ist)
 *   - tauchen im Audit-Log mit eigenem actorId auf
 *
 *   GET    /auth/tokens          — Liste eigener Tokens (ohne Plaintext)
 *   POST   /auth/tokens          — Neuen Token erstellen → liefert Plaintext EINMAL
 *   DELETE /auth/tokens/:id      — Widerrufen
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  createApiToken,
  listApiTokens,
  revokeApiToken,
} from "../services/apiToken.js";
import { logEvent } from "../services/audit.js";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  // ISO-Datum, optional. Default: nie ablaufen (Plugin will langlebige
  // Tokens, damit der User nicht alle 90 Tage einen neuen erstellen muss).
  expiresAt: z.string().datetime().nullable().optional(),
});

export async function registerTokenRoutes(app: FastifyInstance) {
  app.get("/auth/tokens", async (req) => {
    const s = req.requireAuth();
    const tokens = await listApiTokens(s.user.id);
    return { tokens };
  });

  app.post("/auth/tokens", async (req, reply) => {
    const s = req.requireAuth();
    const body = createSchema.parse(req.body);
    const { plaintext, record } = await createApiToken({
      userId: s.user.id,
      name: body.name,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    });
    await logEvent({
      tenantId: req.tenantId,
      actorType: "user",
      actorId: s.user.id,
      action: "auth.token.create",
      targetType: "api_token",
      targetId: record.id,
      payload: { name: body.name },
      ipAddress: req.ip,
    });
    return reply.status(201).send({
      token: plaintext,
      id: record.id,
      name: record.name,
      createdAt: record.createdAt,
    });
  });

  app.delete<{ Params: { id: string } }>(
    "/auth/tokens/:id",
    async (req, reply) => {
      const s = req.requireAuth();
      const ok = await revokeApiToken(s.user.id, req.params.id);
      if (!ok) return reply.status(404).send({ error: "not_found" });
      await logEvent({
        tenantId: req.tenantId,
        actorType: "user",
        actorId: s.user.id,
        action: "auth.token.revoke",
        targetType: "api_token",
        targetId: req.params.id,
        ipAddress: req.ip,
      });
      return { ok: true };
    }
  );
}
