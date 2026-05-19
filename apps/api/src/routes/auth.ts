/**
 * Lumio API — Authentication Routes
 *
 * Studio-Login. Galerie-Zugang läuft separat über Tokens (siehe galleries.ts).
 *
 * Endpoints:
 *   POST   /auth/login         — E-Mail + Passwort
 *   POST   /auth/logout        — Session löschen
 *   GET    /auth/me            — aktueller User
 *   POST   /auth/register      — Studio-Registrierung (nur im multi-Mode mit Self-Service)
 *   POST   /auth/password-reset/request
 *   POST   /auth/password-reset/confirm
 *   POST   /auth/totp/setup    — 2FA aktivieren
 *   POST   /auth/totp/verify
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totpCode: z.string().optional(),
});

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post("/auth/login", async (req, reply) => {
    const body = loginSchema.parse(req.body);
    // TODO:
    //   1. User per email + tenant (im single-Mode default-Tenant) suchen
    //   2. Passwort mit argon2.verify prüfen
    //   3. 2FA-Code prüfen, falls aktiviert
    //   4. Session-Token erzeugen, in Cookie setzen, in Session-Tabelle persistieren
    //   5. event_log schreiben
    return reply
      .status(501)
      .send({ error: "not_implemented", message: "auth/login: pending", email: body.email });
  });

  app.post("/auth/logout", async (_req, reply) => {
    // TODO: Session aus DB löschen, Cookie clearen
    return reply.status(501).send({ error: "not_implemented" });
  });

  app.get("/auth/me", async (_req, reply) => {
    // TODO: Session-Cookie auslesen, User zurückgeben
    return reply.status(501).send({ error: "not_implemented" });
  });
}
