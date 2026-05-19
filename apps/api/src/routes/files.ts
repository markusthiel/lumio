/**
 * Lumio API — File & Upload Routes
 *
 * Upload-Flow:
 *   1. POST /uploads/init       → Browser meldet n Files an.
 *                                 API legt File-Records (status=uploading) an
 *                                 und gibt Presigned URLs zurück.
 *                                 Für Files > 100 MB: Multipart-Init mit Part-URLs.
 *   2. (Browser PUT direkt zu S3)
 *   3. POST /uploads/complete   → Browser meldet Fertigstellung. API
 *                                 vervollständigt ggf. Multipart-Upload, setzt
 *                                 status=processing und feuert Worker-Job.
 *
 * Datei-Operationen:
 *   GET    /files/:id/download  — Original-Download (Presigned redirect)
 *   DELETE /files/:id           — File löschen
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { config } from "../config.js";
import { detectFileKind } from "../services/filekind.js";
import {
  originalKey,
  presignPut,
  presignGet,
  createMultipartUpload,
  presignUploadPart,
  completeMultipartUpload,
  abortMultipartUpload,
  numberOfParts,
  chunkSizeBytes,
  MULTIPART_THRESHOLD,
  deleteObject,
} from "../services/storage.js";
import { enqueue, Queues } from "../services/queue.js";

const MAX_FILES_PER_INIT = 1000;

const uploadInitSchema = z.object({
  galleryId: z.string().uuid(),
  files: z
    .array(
      z.object({
        filename: z.string().min(1).max(500),
        sizeBytes: z.number().int().positive(),
        mimeType: z.string().min(1).max(200),
      })
    )
    .min(1)
    .max(MAX_FILES_PER_INIT),
});

const uploadCompleteSchema = z.object({
  fileId: z.string().uuid(),
  // Bei Multipart: ETags der Parts vom Browser
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().positive(),
        eTag: z.string().min(1),
      })
    )
    .optional(),
});

export async function registerFileRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // POST /uploads/init
  // -------------------------------------------------------------------------
  app.post("/uploads/init", async (req, reply) => {
    const s = req.requireAuth();
    const body = uploadInitSchema.parse(req.body);

    // Gallery-Ownership prüfen
    const gallery = await prisma.gallery.findFirst({
      where: {
        id: body.galleryId,
        tenantId: req.tenantId,
        ownerId: s.user.id,
      },
      select: { id: true },
    });
    if (!gallery) {
      return reply
        .status(404)
        .send({ error: "gallery_not_found", message: "Gallery not found" });
    }

    // Globales Größenlimit pro File
    const maxBytes = config.MAX_FILE_SIZE_MIB * 1024 * 1024;
    for (const f of body.files) {
      if (f.sizeBytes > maxBytes) {
        return reply.status(413).send({
          error: "file_too_large",
          message: `File ${f.filename} exceeds limit of ${config.MAX_FILE_SIZE_MIB} MiB`,
        });
      }
    }

    // TODO (Phase 2): wenn BILLING_ENABLED, hier Plan-Limits prüfen
    //   (storage_bytes_used + sum(sizeBytes) <= plan.storage_gib * 1024^3)

    // Per File: Record anlegen + Presigned URL(s) erzeugen
    const uploads = [];
    for (const f of body.files) {
      const kind = detectFileKind(f.filename, f.mimeType);

      // Wir legen den File-Record erst an, weil wir die fileId für den
      // S3-Key brauchen.
      const fileRow = await prisma.file.create({
        data: {
          galleryId: gallery.id,
          originalFilename: f.filename,
          storageKey: "", // wird im nächsten Schritt gesetzt
          mimeType: f.mimeType,
          sizeBytes: BigInt(f.sizeBytes),
          kind,
          status: "uploading",
        },
      });

      const key = originalKey({
        tenantId: req.tenantId,
        galleryId: gallery.id,
        fileId: fileRow.id,
        filename: f.filename,
      });

      await prisma.file.update({
        where: { id: fileRow.id },
        data: { storageKey: key },
      });

      // Single vs. Multipart entscheiden
      if (f.sizeBytes <= MULTIPART_THRESHOLD) {
        const uploadUrl = await presignPut({
          key,
          contentType: f.mimeType,
          contentLength: f.sizeBytes,
        });
        uploads.push({
          fileId: fileRow.id,
          method: "single" as const,
          uploadUrl,
          // Browser sendet diese Headers beim PUT
          headers: { "Content-Type": f.mimeType },
        });
      } else {
        const { uploadId } = await createMultipartUpload({
          key,
          contentType: f.mimeType,
        });
        const totalParts = numberOfParts(f.sizeBytes);
        const partSize = chunkSizeBytes();
        const partUrls = [];
        for (let i = 1; i <= totalParts; i++) {
          const url = await presignUploadPart({
            key,
            uploadId,
            partNumber: i,
          });
          partUrls.push({ partNumber: i, uploadUrl: url });
        }
        uploads.push({
          fileId: fileRow.id,
          method: "multipart" as const,
          uploadId,
          partSize,
          totalParts,
          parts: partUrls,
        });
      }
    }

    return reply.status(201).send({ galleryId: gallery.id, uploads });
  });

  // -------------------------------------------------------------------------
  // POST /uploads/complete
  // -------------------------------------------------------------------------
  app.post("/uploads/complete", async (req, reply) => {
    const s = req.requireAuth();
    const body = uploadCompleteSchema.parse(req.body);

    // File holen und Gallery-Ownership prüfen
    const file = await prisma.file.findFirst({
      where: { id: body.fileId },
      include: {
        gallery: { select: { id: true, tenantId: true, ownerId: true } },
      },
    });
    if (
      !file ||
      file.gallery.tenantId !== req.tenantId ||
      file.gallery.ownerId !== s.user.id
    ) {
      return reply.status(404).send({ error: "not_found" });
    }
    if (file.status !== "uploading") {
      // Idempotent: Wiederholungen ignorieren, sobald wir mal bei processing/ready sind
      return { fileId: file.id, status: file.status };
    }

    // Multipart abschließen, falls nötig
    if (body.parts && body.parts.length > 0) {
      try {
        await completeMultipartUpload({
          key: file.storageKey,
          uploadId: req.headers["x-upload-id"] as string, // wir senden's via Header
          parts: body.parts.map((p) => ({
            PartNumber: p.partNumber,
            ETag: p.eTag,
          })),
        });
      } catch (err) {
        app.log.warn({ err, fileId: file.id }, "multipart complete failed");
        await prisma.file.update({
          where: { id: file.id },
          data: { status: "failed", errorMessage: "multipart_complete_failed" },
        });
        return reply
          .status(500)
          .send({ error: "multipart_failed", fileId: file.id });
      }
    }

    // Status auf processing setzen
    await prisma.file.update({
      where: { id: file.id },
      data: { status: "processing" },
    });

    // Worker-Job in passenden Stream legen
    const isRaw = file.kind === "raw";
    const isVideo = file.kind === "video";
    await enqueue(
      isVideo ? Queues.VIDEO_PROCESSING : Queues.FILE_PROCESSING,
      {
        type: isVideo
          ? "process_video"
          : isRaw
          ? "process_raw"
          : "process_file",
        fileId: file.id,
        tenantId: file.gallery.tenantId,
        galleryId: file.gallery.id,
      }
    );

    return { fileId: file.id, status: "processing" };
  });

  // -------------------------------------------------------------------------
  // GET /files/:id/download — Original-Download
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    "/files/:id/download",
    async (req, reply) => {
      const s = req.requireAuth();
      const file = await prisma.file.findFirst({
        where: { id: req.params.id },
        include: {
          gallery: { select: { tenantId: true, ownerId: true } },
        },
      });
      if (
        !file ||
        file.gallery.tenantId !== req.tenantId ||
        file.gallery.ownerId !== s.user.id
      ) {
        return reply.status(404).send({ error: "not_found" });
      }

      const url = await presignGet({
        key: file.storageKey,
        responseContentDisposition: `attachment; filename="${encodeURIComponent(
          file.originalFilename
        )}"`,
      });
      return reply.redirect(url);
    }
  );

  // -------------------------------------------------------------------------
  // DELETE /files/:id
  // -------------------------------------------------------------------------
  app.delete<{ Params: { id: string } }>("/files/:id", async (req, reply) => {
    const s = req.requireAuth();
    const file = await prisma.file.findFirst({
      where: { id: req.params.id },
      include: {
        renditions: { select: { storageKey: true } },
        gallery: { select: { tenantId: true, ownerId: true } },
      },
    });
    if (
      !file ||
      file.gallery.tenantId !== req.tenantId ||
      file.gallery.ownerId !== s.user.id
    ) {
      return reply.status(404).send({ error: "not_found" });
    }

    // Wenn der Upload noch nicht abgeschlossen ist und es ein Multipart-Upload
    // ist: best-effort abbrechen. Ohne uploadId aktuell nicht möglich,
    // das hier zu komplettieren — der S3-Cleanup-Job räumt verwaiste
    // Multipart-Uploads ohnehin nach n Tagen auf (Bucket-Policy).

    // S3-Objekte löschen (Originale + Renditions)
    await deleteObject(file.storageKey).catch((err) =>
      app.log.warn({ err, key: file.storageKey }, "s3 delete original failed")
    );
    for (const r of file.renditions) {
      await deleteObject(r.storageKey).catch((err) =>
        app.log.warn({ err, key: r.storageKey }, "s3 delete rendition failed")
      );
    }

    await prisma.file.delete({ where: { id: file.id } });

    // Linter-Hint silencen
    void abortMultipartUpload;

    return reply.status(204).send();
  });
}
