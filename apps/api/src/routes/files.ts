/**
 * Lumio API — File & Upload Routes
 *
 * Upload-Flow:
 *   POST /uploads/init       — Browser meldet n Files an; API erzeugt File-Records + Presigned PUT-URLs
 *   POST /uploads/complete   — Browser meldet "fertig"; API setzt status=processing + queued Worker-Job
 *
 * Datei-Operationen:
 *   GET    /files/:id        — Metadaten (Studio-Auth oder gültiger Access-Token)
 *   DELETE /files/:id        — Löschen (Studio-Auth, löscht auch alle Renditions in S3)
 *   GET    /files/:id/download                — Single-File Download (Original)
 *   GET    /galleries/:id/download/zip        — ZIP-Stream über alle/ausgewählte Files
 *   GET    /galleries/:id/download/selection  — ZIP der vom aktuellen Access ausgewählten Files
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const uploadInitSchema = z.object({
  galleryId: z.string().uuid(),
  files: z
    .array(
      z.object({
        filename: z.string().min(1).max(500),
        sizeBytes: z.number().int().positive(),
        mimeType: z.string().min(1),
      })
    )
    .min(1)
    .max(1000), // pro Init-Call max 1000 Files
});

export async function registerFileRoutes(app: FastifyInstance) {
  app.post("/uploads/init", async (req, reply) => {
    const body = uploadInitSchema.parse(req.body);
    // TODO:
    //   1. Auth + Gallery-Ownership prüfen
    //   2. Plan-Limits prüfen (storageBytesUsed + sum(files) <= storageGib)
    //   3. Pro File: File-Record anlegen, kind aus mime-type ableiten
    //   4. Presigned PUT-URL erzeugen (Multipart, wenn > 100 MB)
    //   5. Antwort: { uploads: [{ fileId, uploadUrl, multipart? }] }
    return reply
      .status(501)
      .send({ error: "not_implemented", count: body.files.length });
  });

  app.post("/uploads/complete", async (_req, reply) => {
    // TODO:
    //   1. Multipart completion an S3 schicken, falls multipart
    //   2. File-Status auf "processing" setzen
    //   3. Worker-Job in Redis-Queue legen mit fileId
    return reply.status(501).send({ error: "not_implemented" });
  });

  app.get<{ Params: { id: string } }>("/files/:id/download", async (_req, reply) => {
    // TODO:
    //   1. Auth/Access-Token prüfen; gallery.downloadEnabled prüfen
    //   2. Presigned GET-URL für original-storageKey
    //   3. 302-Redirect (oder JSON mit URL je nach Accept-Header)
    //   4. DownloadLog schreiben
    return reply.status(501).send({ error: "not_implemented" });
  });

  app.get<{ Params: { id: string } }>(
    "/galleries/:id/download/zip",
    async (_req, reply) => {
      // TODO: Streaming-ZIP über Worker-Job; sehr große Galerien optional in mehreren Teilen
      return reply.status(501).send({ error: "not_implemented" });
    }
  );
}
