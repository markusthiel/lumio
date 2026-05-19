/**
 * Lumio API — Proofing Routes
 *
 * Wird mit gültigem Access-Token aufgerufen (Kunden-Seite).
 *
 *   POST   /files/:fileId/selection   — color/rating/like setzen (idempotent, upsert pro access)
 *   DELETE /files/:fileId/selection   — Auswahl zurücknehmen
 *   POST   /files/:fileId/comments    — neuer Kommentar
 *   GET    /files/:fileId/comments    — Kommentare auflisten (nur eigene, oder alle wenn canSeeOthers)
 *   DELETE /comments/:id              — eigenen Kommentar löschen
 *
 * Studio-Side:
 *   GET    /galleries/:id/proofing/summary  — Übersicht: Auswahl pro File, pro Access
 *   GET    /galleries/:id/proofing/export   — CSV/XMP-Export der Auswahl
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const selectionSchema = z.object({
  color: z.enum(["red", "yellow", "green"]).nullable().optional(),
  rating: z.number().int().min(0).max(5).nullable().optional(),
  liked: z.boolean().optional(),
  status: z.enum(["pick", "reject", "maybe"]).nullable().optional(),
});

const commentSchema = z.object({
  body: z.string().min(1).max(5000),
  parentId: z.string().uuid().optional(),
  annotation: z.unknown().optional(), // SVG-Pfade oder Punkte
});

export async function registerProofingRoutes(app: FastifyInstance) {
  app.post<{ Params: { fileId: string } }>(
    "/files/:fileId/selection",
    async (req, reply) => {
      const body = selectionSchema.parse(req.body);
      // TODO:
      //   1. Access-Token prüfen, gallery.selectionLimit beachten
      //   2. Upsert in selections-Tabelle
      //   3. WebSocket-Broadcast für Live-Collaboration (Phase 2)
      return reply.status(501).send({ error: "not_implemented", echo: body });
    }
  );

  app.post<{ Params: { fileId: string } }>(
    "/files/:fileId/comments",
    async (req, reply) => {
      const body = commentSchema.parse(req.body);
      return reply.status(501).send({ error: "not_implemented", echo: body });
    }
  );

  app.get<{ Params: { id: string } }>(
    "/galleries/:id/proofing/export",
    async (_req, reply) => {
      // TODO: Studio-Auth; Format-Query (?format=csv|xmp|json)
      return reply.status(501).send({ error: "not_implemented" });
    }
  );
}
