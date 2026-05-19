/**
 * Lumio API — Gallery Routes
 *
 * Studio-seitig (mit Auth-Cookie):
 *   GET    /galleries              — Liste eigener Galerien
 *   POST   /galleries              — neue Galerie
 *   GET    /galleries/:id          — Galerie-Details
 *   PATCH  /galleries/:id          — Einstellungen ändern
 *   DELETE /galleries/:id          — Galerie löschen
 *   POST   /galleries/:id/access   — Zugriffslink erzeugen
 *   GET    /galleries/:id/access   — Zugriffslinks listen
 *   DELETE /galleries/:id/access/:accessId
 *
 * Kunden-seitig (mit Access-Token in URL oder Cookie):
 *   GET    /g/:slug                — öffentliche Galerie-Daten (mit Token validieren)
 *   POST   /g/:slug/unlock         — Passwort/E-Mail eingeben
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const createGallerySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  mode: z.enum(["collaboration", "presentation"]).default("collaboration"),
  brandingId: z.string().uuid().optional(),
  downloadEnabled: z.boolean().default(true),
  watermarkEnabled: z.boolean().default(false),
  commentsEnabled: z.boolean().default(true),
  ratingsEnabled: z.boolean().default(true),
  selectionLimit: z.number().int().positive().optional(),
  expiresAt: z.string().datetime().optional(),
});

export async function registerGalleryRoutes(app: FastifyInstance) {
  // Studio-seitig
  app.get("/galleries", async (_req, reply) => {
    // TODO: Auth-Check → Galerien des aktuellen Users/Tenants pagniert zurück
    return reply.status(501).send({ error: "not_implemented" });
  });

  app.post("/galleries", async (req, reply) => {
    const body = createGallerySchema.parse(req.body);
    // TODO:
    //   1. Auth-Check + Tenant ermitteln
    //   2. Im billing-Mode: planLimits prüfen (max Galerien, Storage)
    //   3. slug generieren (z.B. nanoid 12)
    //   4. INSERT + Event-Log
    return reply.status(501).send({ error: "not_implemented", echo: body });
  });

  app.get<{ Params: { id: string } }>("/galleries/:id", async (_req, reply) => {
    return reply.status(501).send({ error: "not_implemented" });
  });

  // Kunden-seitig
  app.get<{ Params: { slug: string } }>("/g/:slug", async (req, reply) => {
    // TODO:
    //   1. Galerie per slug holen, prüfen status=live
    //   2. Access-Token aus Query oder Cookie holen, validieren
    //   3. Passwort-Check wenn passwordHash gesetzt und Token noch nicht "unlocked"
    //   4. expiresAt prüfen
    //   5. Mini-Payload zurück (Title, Branding, File-Liste mit Rendition-URLs)
    return reply
      .status(501)
      .send({ error: "not_implemented", slug: req.params.slug });
  });
}
