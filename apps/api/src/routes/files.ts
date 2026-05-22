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
  effectiveUploadLimitBytes,
  formatLimit,
} from "../services/upload-limit.js";
import { invalidateZipCacheForGallery } from "../services/zip-cache.js";
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
import { publish } from "../services/events.js";
import { logEvent } from "../services/audit.js";
import { checkStorageLimit } from "../services/usage.js";

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

    // Gallery-Ownership + Tenant-Settings in einem Query — wir brauchen
    // maxUploadMib für die Limit-Berechnung.
    const gallery = await prisma.gallery.findFirst({
      where: {
        id: body.galleryId,
        tenantId: req.tenantId,
        ownerId: s.user.id,
      },
      select: {
        id: true,
        tenant: { select: { maxUploadMib: true } },
      },
    });
    if (!gallery) {
      return reply
        .status(404)
        .send({ error: "gallery_not_found", message: "Gallery not found" });
    }

    // Effektives Pro-File-Limit aus Tenant-Settings + ENV-Default +
    // Hard-Cap. Studio-Uploads kennen keinen Upload-Link, daher kein
    // linkMaxFileBytes.
    const maxBytes = effectiveUploadLimitBytes({
      tenantMaxUploadMib: gallery.tenant.maxUploadMib,
    });
    for (const f of body.files) {
      if (BigInt(f.sizeBytes) > maxBytes) {
        return reply.status(413).send({
          error: "file_too_large",
          message: `File ${f.filename} exceeds limit of ${formatLimit(maxBytes)}`,
          limitBytes: maxBytes.toString(),
        });
      }
    }

    // Plan-Limit-Check: Speicher reicht aus? Nur wenn Billing aktiv
    // ist (sonst — z.B. selbst-gehostete Instanz — gibt's keine Limits).
    // additionalBytes summiert ALLE Files dieses Init-Calls, weil das
    // Frontend potenziell mehrere Files in einem Batch hochlädt.
    if (config.BILLING_ENABLED && req.tenantId) {
      const additionalBytes = body.files.reduce(
        (sum, f) => sum + BigInt(f.sizeBytes),
        0n
      );
      const check = await checkStorageLimit(req.tenantId, additionalBytes);
      if (!check.ok) {
        return reply.status(402).send(check);
      }
    }

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
        publish(file.gallery.id, {
          type: "file.status",
          fileId: file.id,
          status: "failed",
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
    publish(file.gallery.id, {
      type: "file.status",
      fileId: file.id,
      status: "processing",
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

    // ZIP-Cache invalidieren — neues File ist in der Galerie, alte
    // ZIPs hätten es nicht drin. Beim nächsten Customer-Download
    // wird neu gebaut. Wir machen das schon hier statt erst beim
    // process_*-Worker-Erfolg, weil der File-Eintrag jetzt zwar
    // status=processing hat (also noch nicht in den ZIP-Where-
    // Clauses, die nur status='ready' wollen), aber sobald
    // er ready wird, ist's konsistent — und Customer-Downloads
    // während processing sind ohnehin selten.
    await invalidateZipCacheForGallery(file.gallery.id, {
      log: app.log,
      reason: "file_uploaded",
    });

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

    await deleteObject(file.storageKey).catch((err) =>
      app.log.warn({ err, key: file.storageKey }, "s3 delete original failed")
    );
    for (const r of file.renditions) {
      await deleteObject(r.storageKey).catch((err) =>
        app.log.warn({ err, key: r.storageKey }, "s3 delete rendition failed")
      );
    }

    await prisma.file.delete({ where: { id: file.id } });
    void abortMultipartUpload;

    // ZIP-Cache invalidieren — gelöschtes File darf in keinem
    // existierenden ZIP mehr referenziert sein, sonst würde der
    // Worker beim nächsten Re-Build mit NoSuchKey skippen oder ein
    // alter ZIP-Cache würde den toten storageKey enthalten.
    await invalidateZipCacheForGallery(file.galleryId, {
      log: app.log,
      reason: "file_deleted",
    });

    await logEvent({
      tenantId: req.tenantId,
      actorType: "user",
      actorId: s.user.id,
      action: "file.delete",
      targetType: "file",
      targetId: file.id,
      payload: { galleryId: file.galleryId, filename: file.originalFilename },
      ipAddress: req.ip,
    });

    return reply.status(204).send();
  });

  // -------------------------------------------------------------------------
  // POST /files/bulk-action
  // -------------------------------------------------------------------------
  // Massenoperationen auf File-Sets innerhalb EINER Galerie. Verlangt
  // immer galleryId + fileIds — wir prüfen den Ownership einmal an der
  // Galerie statt pro File (deutlich schneller bei großen Sets).
  //
  // Actions:
  //   - delete  : S3-Objekte + DB-Rows löschen
  //   - hide    : status = 'hidden' (für Kunden unsichtbar, im Studio
  //               weiterhin sichtbar)
  //   - show    : status = 'ready' (Re-Aktivierung)
  app.post<{
    Body: {
      galleryId: string;
      fileIds: string[];
      action: "delete" | "hide" | "show";
    };
  }>("/files/bulk-action", async (req, reply) => {
    const s = req.requireAuth();
    const body = req.body;

    if (
      !body ||
      typeof body.galleryId !== "string" ||
      !Array.isArray(body.fileIds) ||
      body.fileIds.length === 0 ||
      body.fileIds.length > 500 ||
      !["delete", "hide", "show"].includes(body.action)
    ) {
      return reply.status(400).send({ error: "bad_request" });
    }
    // Alle fileIds müssen UUIDs sein, sonst SQL-Injection-Risiko bei
    // Prisma `in` ist zwar abgedeckt, aber wir wollen auch dumme
    // Tippfehler abfangen
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!body.fileIds.every((id) => uuidRe.test(id))) {
      return reply.status(400).send({ error: "bad_file_id" });
    }

    // Ownership-Check
    const gallery = await prisma.gallery.findFirst({
      where: {
        id: body.galleryId,
        tenantId: req.tenantId,
        ownerId: s.user.id,
      },
      select: { id: true },
    });
    if (!gallery) {
      return reply.status(404).send({ error: "not_found" });
    }

    // Nur Files, die zu dieser Galerie gehören — auch wenn jemand
    // fremde IDs reinmogeln würde, gibt's hier keinen Treffer
    const files = await prisma.file.findMany({
      where: {
        id: { in: body.fileIds },
        galleryId: gallery.id,
      },
      include: {
        renditions: { select: { storageKey: true } },
      },
    });
    if (files.length === 0) {
      return { affected: 0 };
    }

    if (body.action === "delete") {
      // S3 zuerst, dann DB. Wenn S3 partiell scheitert: DB-Delete läuft
      // trotzdem (S3-Cleanup-Job räumt Verwaiste später auf).
      for (const f of files) {
        await deleteObject(f.storageKey).catch((err) =>
          app.log.warn({ err, key: f.storageKey }, "bulk: original delete failed")
        );
        for (const r of f.renditions) {
          await deleteObject(r.storageKey).catch((err) =>
            app.log.warn({ err, key: r.storageKey }, "bulk: rendition delete failed")
          );
        }
      }
      const result = await prisma.file.deleteMany({
        where: {
          id: { in: files.map((f) => f.id) },
          galleryId: gallery.id,
        },
      });
      for (const f of files) {
        publish(gallery.id, { type: "file.deleted", fileId: f.id });
      }
      await invalidateZipCacheForGallery(gallery.id, {
        log: app.log,
        reason: `bulk_delete_${result.count}`,
      });
      await logEvent({
        tenantId: req.tenantId,
        actorType: "user",
        actorId: s.user.id,
        action: "file.bulk",
        targetType: "gallery",
        targetId: gallery.id,
        payload: { op: "delete", count: result.count },
        ipAddress: req.ip,
      });
      return { affected: result.count };
    }

    // hide / show — nur Status flippen
    const newStatus = body.action === "hide" ? "hidden" : "ready";
    const result = await prisma.file.updateMany({
      where: {
        id: { in: files.map((f) => f.id) },
        galleryId: gallery.id,
        // Bei 'show' nur dort, wo's auch versteckt war, damit wir nicht
        // 'failed' oder 'pending' auf 'ready' fälschen
        ...(body.action === "show" ? { status: "hidden" } : {}),
      },
      data: { status: newStatus },
    });
    for (const f of files) {
      publish(gallery.id, {
        type: "file.status",
        fileId: f.id,
        status: newStatus,
      });
    }
    // hide entfernt die Files aus dem Customer-View und damit aus
    // künftigen ZIPs; show fügt sie wieder rein. Beide Richtungen
    // brauchen Cache-Invalidierung.
    await invalidateZipCacheForGallery(gallery.id, {
      log: app.log,
      reason: `bulk_${body.action}_${result.count}`,
    });
    await logEvent({
      tenantId: req.tenantId,
      actorType: "user",
      actorId: s.user.id,
      action: "file.bulk",
      targetType: "gallery",
      targetId: gallery.id,
      payload: { op: body.action, count: result.count },
      ipAddress: req.ip,
    });
    return { affected: result.count };
  });

  // -------------------------------------------------------------------------
  // PUT /files/reorder
  // -------------------------------------------------------------------------
  // Setzt die Sortierreihenfolge der Files in EINER Galerie. Der Aufrufer
  // schickt ein Array von { id, sortIndex } — wir validieren, dass alle IDs
  // tatsächlich zur Galerie gehören (sonst könnte man Files aus fremden
  // Galerien umordnen), und schreiben dann jeden sortIndex einzeln. Bei
  // bis zu ~1000 Files pro Galerie ist das günstig genug, dass wir uns
  // keinen Bulk-Update-Hack mit CASE-WHEN basteln müssen.
  app.put<{
    Body: {
      galleryId: string;
      order: { id: string; sortIndex: number }[];
    };
  }>("/files/reorder", async (req, reply) => {
    const s = req.requireAuth();
    const body = req.body;

    if (
      !body ||
      typeof body.galleryId !== "string" ||
      !Array.isArray(body.order) ||
      body.order.length === 0 ||
      body.order.length > 5000
    ) {
      return reply.status(400).send({ error: "bad_request" });
    }
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const item of body.order) {
      if (
        !item ||
        typeof item.id !== "string" ||
        !uuidRe.test(item.id) ||
        typeof item.sortIndex !== "number" ||
        !Number.isFinite(item.sortIndex) ||
        item.sortIndex < 0 ||
        item.sortIndex > 1_000_000
      ) {
        return reply.status(400).send({ error: "bad_order_entry" });
      }
    }

    // Ownership-Check über die Galerie
    const gallery = await prisma.gallery.findFirst({
      where: {
        id: body.galleryId,
        tenantId: req.tenantId,
        ownerId: s.user.id,
      },
      select: { id: true },
    });
    if (!gallery) {
      return reply.status(404).send({ error: "not_found" });
    }

    // Sicherstellen, dass alle IDs tatsächlich Files dieser Galerie sind.
    // Falls jemand IDs einer fremden Galerie reinmogeln würde, finden wir sie
    // hier NICHT und brechen ab — sauberer als stille No-ops.
    const ids = body.order.map((o) => o.id);
    const owned = await prisma.file.findMany({
      where: { id: { in: ids }, galleryId: gallery.id },
      select: { id: true },
    });
    if (owned.length !== ids.length) {
      return reply.status(400).send({ error: "unknown_file_id" });
    }

    // Updates parallel — Prisma's $transaction sorgt für Atomarität
    await prisma.$transaction(
      body.order.map((item) =>
        prisma.file.update({
          where: { id: item.id },
          data: { sortIndex: item.sortIndex },
        })
      )
    );
    return { affected: body.order.length };
  });
}
