/**
 * Lumio API — Upload-Links
 *
 * Öffentliche Drag-and-Drop-Endpunkte pro Galerie. Studio-User legt
 * einen Link mit Token an, teilt die URL (z.B. an einen Trauzeugen),
 * Empfänger lädt Bilder hoch ohne sich einzuloggen.
 *
 * Studio-Routes (auth = Owner):
 *   GET    /galleries/:id/upload-links
 *   POST   /galleries/:id/upload-links
 *   PATCH  /galleries/:id/upload-links/:linkId
 *   DELETE /galleries/:id/upload-links/:linkId
 *
 * Public-Routes (Token-basiert, kein Login):
 *   GET    /u/:token              → Meta für die Upload-Page
 *   POST   /u/:token/unlock       → Passwort prüfen, Session-Cookie setzen
 *   POST   /u/:token/uploads/init → Presigned URLs holen
 *   POST   /u/:token/uploads/complete → Upload abschließen
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { randomBytes } from "crypto";

import { prisma } from "../db.js";
import { config } from "../config.js";
import { hashPassword, verifyPassword } from "../services/auth.js";
import { detectFileKind } from "../services/filekind.js";
import { effectiveAllowedKinds, isKindAllowed } from "../services/upload-allow.js";
import {
  effectiveUploadLimitBytes,
  formatLimit,
} from "../services/upload-limit.js";
import { invalidateZipCacheForGallery } from "../services/zip-cache.js";
import {
  originalKey,
  presignPut,
  createMultipartUpload,
  presignUploadPart,
  completeMultipartUpload,
  numberOfParts,
  chunkSizeBytes,
  MULTIPART_THRESHOLD,
  deleteObject,
} from "../services/storage.js";
import { enqueue, Queues } from "../services/queue.js";
import { notifyUploadReceived } from "../services/notifier.js";
import { publish } from "../services/events.js";
import { checkStorageLimit } from "../services/usage.js";
import { logEvent } from "../services/audit.js";
import { galleryAccessWhere } from "../lib/gallery-access.js";

const MAX_FILES_PER_INIT = 100; // bewusst niedriger als bei /uploads/init
                                 // weil die UX einer Drag-Drop-Page anders ist

// --------- Studio-Routes ---------

const createSchema = z.object({
  label: z.string().min(1).max(120),
  password: z.string().min(4).max(200).optional(),
  maxFiles: z.number().int().positive().max(10000).nullable().optional(),
  maxBytesTotal: z
    .number()
    .int()
    .positive()
    .max(100 * 1024 * 1024 * 1024) // 100 GB Cap pro Link
    .nullable()
    .optional(),
  // Per-File-Limit für DIESEN Link in Bytes. Null/undefined = Tenant-
  // Limit erben. Wenn gesetzt: wird in der Route gegen Tenant-Limit
  // gegengeprüft (Link darf nicht über Tenant), nicht hier im Schema —
  // Schema kennt den Tenant nicht.
  maxFileBytes: z
    .number()
    .int()
    .positive()
    .max(100 * 1024 * 1024 * 1024)
    .nullable()
    .optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const patchSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  active: z.boolean().optional(),
  password: z.string().min(4).max(200).nullable().optional(),
  // null = Limit entfernen, undefined = nicht ändern
  maxFiles: z.number().int().positive().max(10000).nullable().optional(),
  maxBytesTotal: z
    .number()
    .int()
    .positive()
    .max(100 * 1024 * 1024 * 1024)
    .nullable()
    .optional(),
  maxFileBytes: z
    .number()
    .int()
    .positive()
    .max(100 * 1024 * 1024 * 1024)
    .nullable()
    .optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

// --------- Public-Routes ---------

const unlockSchema = z.object({
  password: z.string().min(1).max(200),
});

const uploadInitSchema = z.object({
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
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().positive(),
        eTag: z.string().min(1),
      })
    )
    .optional(),
});

// --------- Helpers ---------

/** Erzeugt einen URL-safen Token, ca. 43 Chars. */
function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Cookie-Name für die Upload-Session (nach erfolgreichem Passwort). */
function uploadCookieName(linkId: string): string {
  return `lumio_upload_${linkId.replace(/-/g, "")}`;
}

/** Lädt einen UploadLink anhand des Tokens und prüft Aktivität +
 * Expiry. Returnt null wenn unauthentic oder abgelaufen. */
async function loadLink(token: string) {
  const link = await prisma.uploadLink.findUnique({
    where: { token },
    include: {
      gallery: {
        select: {
          id: true,
          tenantId: true,
          status: true,
          // tenant.maxUploadMib brauchen wir im Init-Endpoint zur
          // effektiven Limit-Berechnung
          tenant: { select: { maxUploadMib: true, uploadAllowedKinds: true } },
        },
      },
    },
  });
  if (!link) return null;
  if (!link.active) return null;
  if (link.gallery.status === "archived") return null;
  if (link.expiresAt && link.expiresAt < new Date()) return null;
  return link;
}

/** Prüft ob die Upload-Page für diesen Link unlocked ist (Passwort
 * bereits eingegeben). Bei links ohne passwordHash automatisch true. */
function isUnlocked(
  req: FastifyRequest,
  link: { id: string; passwordHash: string | null }
): boolean {
  if (!link.passwordHash) return true;
  const cookie = req.cookies?.[uploadCookieName(link.id)];
  // Wir signieren den Cookie nicht via JWT — bei dem hier sind die
  // Folgen eines Bypasses überschaubar (uploaden, nicht lesen). Trotzdem
  // verifizieren wir per HMAC im Cookie-Plugin. Wenn Fastify-Cookie
  // unsigned Cookie zurückgibt, gilt nicht-unlocked.
  return cookie === "ok";
}

async function findOwnedGallery(req: FastifyRequest, galleryId: string) {
  const s = req.requireAuth();
  return prisma.gallery.findFirst({
    where: { id: galleryId, tenantId: req.tenantId, ...galleryAccessWhere(s) },
    select: { id: true, tenantId: true },
  });
}

// =============================================================================

export async function registerUploadLinkRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // GET /galleries/:id/upload-links — Liste der Links für die Galerie
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    "/galleries/:id/upload-links",
    async (req, reply) => {
      const gallery = await findOwnedGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const links = await prisma.uploadLink.findMany({
        where: { galleryId: gallery.id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          token: true,
          label: true,
          active: true,
          maxFiles: true,
          maxBytesTotal: true,
          maxFileBytes: true,
          expiresAt: true,
          uploadCount: true,
          bytesUploaded: true,
          lastUploadAt: true,
          createdAt: true,
          // passwordHash nur kurz für die hasPassword-Ableitung — wird
          // nicht ans Frontend gegeben
          passwordHash: true,
        },
      });

      return links.map((l) => ({
        ...l,
        passwordHash: undefined,
        hasPassword: l.passwordHash !== null,
        maxBytesTotal: l.maxBytesTotal?.toString() ?? null,
        maxFileBytes: l.maxFileBytes?.toString() ?? null,
        bytesUploaded: l.bytesUploaded.toString(),
      }));
    }
  );

  app.get<{ Params: { id: string; linkId: string } }>(
    "/galleries/:id/upload-links/:linkId",
    async (req, reply) => {
      const gallery = await findOwnedGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const link = await prisma.uploadLink.findFirst({
        where: { id: req.params.linkId, galleryId: gallery.id },
        select: {
          id: true,
          token: true,
          label: true,
          active: true,
          maxFiles: true,
          maxBytesTotal: true,
          maxFileBytes: true,
          expiresAt: true,
          uploadCount: true,
          bytesUploaded: true,
          lastUploadAt: true,
          createdAt: true,
          passwordHash: true,
        },
      });
      if (!link) return reply.status(404).send({ error: "not_found" });

      return {
        ...link,
        passwordHash: undefined,
        hasPassword: link.passwordHash !== null,
        maxBytesTotal: link.maxBytesTotal?.toString() ?? null,
        maxFileBytes: link.maxFileBytes?.toString() ?? null,
        bytesUploaded: link.bytesUploaded.toString(),
      };
    }
  );

  // -------------------------------------------------------------------------
  // POST /galleries/:id/upload-links — Neuen Link anlegen
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/galleries/:id/upload-links",
    async (req, reply) => {
      const gallery = await findOwnedGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const body = createSchema.parse(req.body);

      // Link-Per-File-Limit darf nicht über Tenant-Limit. Wir holen
      // das Tenant-Limit und werten effektiv aus — Link soll runter
      // dürfen, nie rauf.
      if (body.maxFileBytes !== undefined && body.maxFileBytes !== null) {
        const tenant = await prisma.tenant.findUnique({
          where: { id: req.tenantId },
          select: { maxUploadMib: true },
        });
        const tenantLimit = effectiveUploadLimitBytes({
          tenantMaxUploadMib: tenant?.maxUploadMib ?? null,
        });
        if (BigInt(body.maxFileBytes) > tenantLimit) {
          return reply.status(400).send({
            error: "link_limit_exceeds_tenant",
            message: `Link limit ${formatLimit(BigInt(body.maxFileBytes))} exceeds tenant limit ${formatLimit(tenantLimit)}`,
            tenantLimitBytes: tenantLimit.toString(),
          });
        }
      }

      const passwordHash = body.password
        ? await hashPassword(body.password)
        : null;

      const link = await prisma.uploadLink.create({
        data: {
          galleryId: gallery.id,
          token: generateToken(),
          label: body.label,
          passwordHash,
          maxFiles: body.maxFiles ?? null,
          maxBytesTotal:
            body.maxBytesTotal !== undefined && body.maxBytesTotal !== null
              ? BigInt(body.maxBytesTotal)
              : null,
          maxFileBytes:
            body.maxFileBytes !== undefined && body.maxFileBytes !== null
              ? BigInt(body.maxFileBytes)
              : null,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        },
      });

      await logEvent({
        tenantId: req.tenantId,
        actorType: "user",
        actorId: req.session?.user.id,
        action: "upload_link.create",
        targetType: "upload_link",
        payload: { galleryId: gallery.id, ...{ uploadLinkId: link.id, label: link.label } },
        ipAddress: req.ip,
      });

      return reply.status(201).send({
        id: link.id,
        token: link.token,
        label: link.label,
        active: link.active,
        hasPassword: link.passwordHash !== null,
        maxFiles: link.maxFiles,
        maxBytesTotal: link.maxBytesTotal?.toString() ?? null,
        maxFileBytes: link.maxFileBytes?.toString() ?? null,
        expiresAt: link.expiresAt,
        uploadCount: link.uploadCount,
        bytesUploaded: link.bytesUploaded.toString(),
        lastUploadAt: link.lastUploadAt,
        createdAt: link.createdAt,
      });
    }
  );

  // -------------------------------------------------------------------------
  // PATCH /galleries/:id/upload-links/:linkId
  // -------------------------------------------------------------------------
  app.patch<{ Params: { id: string; linkId: string } }>(
    "/galleries/:id/upload-links/:linkId",
    async (req, reply) => {
      const gallery = await findOwnedGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const body = patchSchema.parse(req.body);

      // Vorher Existenz prüfen + Ownership via galleryId-Filter
      const existing = await prisma.uploadLink.findFirst({
        where: { id: req.params.linkId, galleryId: gallery.id },
        select: { id: true },
      });
      if (!existing) return reply.status(404).send({ error: "not_found" });

      // Update-Data zusammenbauen. undefined → Feld nicht ändern,
      // null → Feld auf null setzen (Passwort entfernen etc.)
      const data: Record<string, unknown> = {};
      if (body.label !== undefined) data.label = body.label;
      if (body.active !== undefined) data.active = body.active;
      if (body.password !== undefined) {
        data.passwordHash = body.password
          ? await hashPassword(body.password)
          : null;
      }
      if (body.maxFiles !== undefined) data.maxFiles = body.maxFiles;
      if (body.maxBytesTotal !== undefined) {
        data.maxBytesTotal =
          body.maxBytesTotal !== null ? BigInt(body.maxBytesTotal) : null;
      }
      if (body.maxFileBytes !== undefined) {
        if (body.maxFileBytes !== null) {
          // Gegen Tenant-Limit prüfen — Link darf nur runter
          const tenant = await prisma.tenant.findUnique({
            where: { id: req.tenantId },
            select: { maxUploadMib: true },
          });
          const tenantLimit = effectiveUploadLimitBytes({
            tenantMaxUploadMib: tenant?.maxUploadMib ?? null,
          });
          if (BigInt(body.maxFileBytes) > tenantLimit) {
            return reply.status(400).send({
              error: "link_limit_exceeds_tenant",
              message: `Link limit ${formatLimit(BigInt(body.maxFileBytes))} exceeds tenant limit ${formatLimit(tenantLimit)}`,
              tenantLimitBytes: tenantLimit.toString(),
            });
          }
          data.maxFileBytes = BigInt(body.maxFileBytes);
        } else {
          data.maxFileBytes = null;
        }
      }
      if (body.expiresAt !== undefined) {
        data.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
      }

      const updated = await prisma.uploadLink.update({
        where: { id: existing.id },
        data,
      });

      await logEvent({
        tenantId: req.tenantId,
        actorType: "user",
        actorId: req.session?.user.id,
        action: "upload_link.update",
        targetType: "upload_link",
        payload: { galleryId: gallery.id, ...{
          uploadLinkId: updated.id,
          changed: Object.keys(data),
        } },
        ipAddress: req.ip,
      });

      return {
        id: updated.id,
        label: updated.label,
        active: updated.active,
        hasPassword: updated.passwordHash !== null,
        maxFiles: updated.maxFiles,
        maxBytesTotal: updated.maxBytesTotal?.toString() ?? null,
        maxFileBytes: updated.maxFileBytes?.toString() ?? null,
        expiresAt: updated.expiresAt,
      };
    }
  );

  // -------------------------------------------------------------------------
  // DELETE /galleries/:id/upload-links/:linkId
  // -------------------------------------------------------------------------
  app.delete<{ Params: { id: string; linkId: string } }>(
    "/galleries/:id/upload-links/:linkId",
    async (req, reply) => {
      const gallery = await findOwnedGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const existing = await prisma.uploadLink.findFirst({
        where: { id: req.params.linkId, galleryId: gallery.id },
        select: { id: true, label: true },
      });
      if (!existing) return reply.status(404).send({ error: "not_found" });

      await prisma.uploadLink.delete({ where: { id: existing.id } });

      // Files behalten (uploadLinkId wird per SetNull in der DB
      // genullt — sie bleiben in der Galerie sichtbar bzw. weiterhin
      // 'hidden' wenn sie nie freigegeben wurden).

      await logEvent({
        tenantId: req.tenantId,
        actorType: "user",
        actorId: req.session?.user.id,
        action: "upload_link.delete",
        targetType: "upload_link",
        payload: { galleryId: gallery.id, ...{ uploadLinkId: existing.id, label: existing.label } },
        ipAddress: req.ip,
      });

      return reply.status(204).send();
    }
  );

  // -------------------------------------------------------------------------
  // POST /galleries/:id/files/:fileId/approve
  //   Studio-User gibt einen via upload_link reingekommenen File frei
  //   → publicVisibility 'hidden' → 'visible'.
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string; fileId: string }; Body: unknown }>(
    "/galleries/:id/files/:fileId/approve",
    async (req, reply) => {
      const gallery = await findOwnedGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const file = await prisma.file.findFirst({
        where: { id: req.params.fileId, galleryId: gallery.id },
        select: { id: true, publicVisibility: true },
      });
      if (!file) return reply.status(404).send({ error: "not_found" });

      if (file.publicVisibility === "visible") {
        return { fileId: file.id, publicVisibility: "visible" };
      }

      await prisma.file.update({
        where: { id: file.id },
        data: { publicVisibility: "visible" },
      });

      await logEvent({
        tenantId: req.tenantId,
        actorType: "user",
        actorId: req.session?.user.id,
        action: "file.approve",
        targetType: "upload_link",
        payload: { galleryId: gallery.id, ...{ fileId: file.id } },
        ipAddress: req.ip,
      });

      // Realtime: Customer-Galerien können das File sehen sobald sie
      // refreshen. Studio-Browser-Tabs kriegen einen Push.
      publish(gallery.id, {
        type: "file.visibility",
        fileId: file.id,
        publicVisibility: "visible",
      });

      // ZIP-Cache invalidieren — File ist jetzt im Customer-View und
      // damit in künftigen ZIPs enthalten.
      await invalidateZipCacheForGallery(gallery.id, {
        log: app.log,
        reason: "file_approved",
      });

      return { fileId: file.id, publicVisibility: "visible" };
    }
  );

  // -------------------------------------------------------------------------
  // POST /galleries/:id/uploads/approve-bulk
  //   Mehrere Files in einem Call freigeben. Erwartet { fileIds: [] }.
  //   Returnt nur die IDs die wirklich freigegeben wurden — IDs die
  //   schon visible waren oder nicht zur Galerie gehören werden
  //   stillschweigend übersprungen (Idempotenz).
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/galleries/:id/uploads/approve-bulk",
    async (req, reply) => {
      const gallery = await findOwnedGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const bodySchema = z.object({
        fileIds: z.array(z.string().uuid()).min(1).max(500),
      });
      const body = bodySchema.safeParse(req.body);
      if (!body.success) {
        return reply.status(400).send({ error: "invalid_body" });
      }

      // Erst raussuchen welche Files überhaupt approve-relevant sind:
      // - gehören zur Galerie (Anti-Tampering)
      // - sind heute pending (publicVisibility=hidden)
      // visible-Files filtern wir raus damit wir keinen unnötigen
      // UPDATE machen und keinen Approve-Audit-Eintrag schreiben für
      // einen No-Op.
      const relevant = await prisma.file.findMany({
        where: {
          id: { in: body.data.fileIds },
          galleryId: gallery.id,
          publicVisibility: "hidden",
        },
        select: { id: true },
      });
      if (relevant.length === 0) {
        return { approved: [] };
      }
      const ids = relevant.map((f) => f.id);

      await prisma.file.updateMany({
        where: { id: { in: ids } },
        data: { publicVisibility: "visible" },
      });

      // Ein Audit-Event pro File. Bei großen Bulks (z.B. 200 Files)
      // könnte man ein einzelnes Aggregat-Event loggen, aber dann
      // verliert man die Auswertbarkeit pro File. Für die
      // Sichtbarkeits-History ist pro-File besser.
      for (const fileId of ids) {
        await logEvent({
          tenantId: req.tenantId,
          actorType: "user",
          actorId: req.session?.user.id,
          action: "file.approve",
          targetType: "upload_link",
          payload: { galleryId: gallery.id, fileId, bulk: true },
          ipAddress: req.ip,
        });
        publish(gallery.id, {
          type: "file.visibility",
          fileId,
          publicVisibility: "visible",
        });
      }

      // Cache einmal invalidieren statt N-mal — alle ids gehören
      // zur selben Galerie, also reicht ein Aufruf am Ende.
      await invalidateZipCacheForGallery(gallery.id, {
        log: app.log,
        reason: `bulk_approve_${ids.length}`,
      });

      return { approved: ids };
    }
  );

  // -------------------------------------------------------------------------
  // POST /galleries/:id/files/:fileId/reject
  //   Studio-User lehnt einen via upload_link reingekommenen File ab.
  //   S3-Objekte (Original + Renditions) werden physisch gelöscht,
  //   DB-Row bleibt mit publicVisibility="rejected" + Audit-Daten.
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string; fileId: string }; Body: unknown }>(
    "/galleries/:id/files/:fileId/reject",
    async (req, reply) => {
      const gallery = await findOwnedGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const bodySchema = z.object({
        reason: z.string().max(500).optional().nullable(),
      });
      const body = bodySchema.safeParse(req.body);
      if (!body.success) {
        return reply.status(400).send({ error: "invalid_body" });
      }

      const file = await prisma.file.findFirst({
        where: { id: req.params.fileId, galleryId: gallery.id },
        select: {
          id: true,
          publicVisibility: true,
          storageKey: true,
          renditions: { select: { storageKey: true } },
        },
      });
      if (!file) return reply.status(404).send({ error: "not_found" });

      // Idempotenz: schon rejected → einfach zurückgeben
      if (file.publicVisibility === "rejected") {
        return { fileId: file.id, publicVisibility: "rejected" };
      }

      await rejectFile({
        app,
        fileId: file.id,
        storageKey: file.storageKey,
        renditionKeys: file.renditions.map((r) => r.storageKey),
        reason: body.data.reason ?? null,
        actorUserId: req.session?.user.id ?? null,
        tenantId: req.tenantId,
        galleryId: gallery.id,
        ipAddress: req.ip,
      });

      // ZIP-Cache invalidieren — File ist jetzt rejected, S3-Objekte
      // sind weg, alte ZIPs die das File enthielten oder einen
      // dangling storageKey hätten sind ungültig.
      await invalidateZipCacheForGallery(gallery.id, {
        log: app.log,
        reason: "file_rejected",
      });

      return { fileId: file.id, publicVisibility: "rejected" };
    }
  );

  // -------------------------------------------------------------------------
  // POST /galleries/:id/uploads/reject-bulk
  //   Mehrere Files in einem Call ablehnen mit GEMEINSAMEM Grund.
  //   Returnt nur die IDs die tatsächlich abgelehnt wurden.
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/galleries/:id/uploads/reject-bulk",
    async (req, reply) => {
      const gallery = await findOwnedGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const bodySchema = z.object({
        fileIds: z.array(z.string().uuid()).min(1).max(500),
        reason: z.string().max(500).optional().nullable(),
      });
      const body = bodySchema.safeParse(req.body);
      if (!body.success) {
        return reply.status(400).send({ error: "invalid_body" });
      }

      // Nur Files dieser Galerie die NICHT schon rejected sind
      // (anti-tampering + idempotent gegen Doppelklicks).
      const relevant = await prisma.file.findMany({
        where: {
          id: { in: body.data.fileIds },
          galleryId: gallery.id,
          publicVisibility: { not: "rejected" },
        },
        select: {
          id: true,
          storageKey: true,
          renditions: { select: { storageKey: true } },
        },
      });
      if (relevant.length === 0) {
        return { rejected: [] };
      }

      // Sequenziell durchgehen — bei 200 Files sind das 200 S3-Deletes,
      // parallel wäre theoretisch schneller aber wir haben dann
      // Connection-Pool-Druck und Audit-Reihenfolge wäre nicht-deterministisch.
      // Bei Bulk-Rejects in dieser Größenordnung (~30 Min Junggesellenabend-
      // Fotos) sequenziell mit ~50ms pro S3-Delete = ~10s; akzeptabel.
      const rejectedIds: string[] = [];
      for (const f of relevant) {
        await rejectFile({
          app,
          fileId: f.id,
          storageKey: f.storageKey,
          renditionKeys: f.renditions.map((r) => r.storageKey),
          reason: body.data.reason ?? null,
          actorUserId: req.session?.user.id ?? null,
          tenantId: req.tenantId,
          galleryId: gallery.id,
          ipAddress: req.ip,
          bulk: true,
        });
        rejectedIds.push(f.id);
      }

      if (rejectedIds.length > 0) {
        await invalidateZipCacheForGallery(gallery.id, {
          log: app.log,
          reason: `bulk_reject_${rejectedIds.length}`,
        });
      }

      return { rejected: rejectedIds };
    }
  );

  // =========================================================================
  // Public-Routes (Token-basiert, kein Login)
  // =========================================================================

  // -------------------------------------------------------------------------
  // GET /u/:token — Meta für die Upload-Page
  // -------------------------------------------------------------------------
  app.get<{ Params: { token: string } }>(
    "/u/:token",
    async (req, reply) => {
      const link = await loadLink(req.params.token);
      if (!link) {
        return reply.status(404).send({ error: "not_found_or_expired" });
      }

      const gallery = await prisma.gallery.findUnique({
        where: { id: link.galleryId },
        select: { title: true, slug: true },
      });

      // Effektives Pro-File-Limit damit Drop-Zone schon vor dem
      // Upload zeigen kann was geht.
      const effectivePerFile = effectiveUploadLimitBytes({
        tenantMaxUploadMib: link.gallery.tenant.maxUploadMib,
        linkMaxFileBytes: link.maxFileBytes,
      });

      return {
        label: link.label,
        galleryTitle: gallery?.title ?? "",
        hasPassword: link.passwordHash !== null,
        unlocked: isUnlocked(req, link),
        // Limits-Info damit das Frontend Hinweise zeigen kann
        // ("noch X Files möglich")
        limits: {
          maxFiles: link.maxFiles,
          maxBytesTotal: link.maxBytesTotal?.toString() ?? null,
          maxFileBytes: link.maxFileBytes?.toString() ?? null,
          /** Effektives Pro-File-Limit (Tenant-Setting + Link-Override
           *  + Hard-Cap zusammen aufgelöst). Frontend nutzt das für
           *  den "max X GB pro Datei"-Hinweis in der Drop-Zone. */
          effectivePerFileBytes: effectivePerFile.toString(),
          usedFiles: link.uploadCount,
          usedBytes: link.bytesUploaded.toString(),
        },
      };
    }
  );

  // -------------------------------------------------------------------------
  // POST /u/:token/unlock — Passwort prüfen
  // -------------------------------------------------------------------------
  app.post<{ Params: { token: string }; Body: unknown }>(
    "/u/:token/unlock",
    async (req, reply) => {
      const link = await loadLink(req.params.token);
      if (!link) {
        return reply.status(404).send({ error: "not_found_or_expired" });
      }
      if (!link.passwordHash) {
        // Kein Passwort gesetzt — Unlock ist Identitätsfunktion.
        return { ok: true };
      }

      const body = unlockSchema.parse(req.body);
      const match = await verifyPassword(link.passwordHash, body.password);
      if (!match) {
        return reply.status(401).send({ error: "wrong_password" });
      }

      // Session-Cookie setzen. 24h, an Pfad gebunden damit er nicht
      // bei anderen Endpoints auftaucht. Kein signing/HMAC nötig —
      // worst-case Bypass = jemand kann ohne Passwort uploaden;
      // Storage-Limits und Quarantäne (publicVisibility='hidden')
      // begrenzen den Schaden.
      reply.setCookie(uploadCookieName(link.id), "ok", {
        path: `/api/v1/u/${req.params.token}`,
        httpOnly: true,
        sameSite: "lax",
        secure: config.NODE_ENV === "production",
        maxAge: 60 * 60 * 24,
      });

      return { ok: true };
    }
  );

  // -------------------------------------------------------------------------
  // POST /u/:token/uploads/init — Presigned URLs für Files holen
  // -------------------------------------------------------------------------
  app.post<{ Params: { token: string }; Body: unknown }>(
    "/u/:token/uploads/init",
    async (req, reply) => {
      const link = await loadLink(req.params.token);
      if (!link) {
        return reply.status(404).send({ error: "not_found_or_expired" });
      }
      if (!isUnlocked(req, link)) {
        return reply.status(401).send({ error: "password_required" });
      }

      const body = uploadInitSchema.parse(req.body);

      // Pro-File Limit: effektiv aus Tenant-Setting + Link-Override.
      // Link kann nur runter gehen, nie über Tenant (Validierung beim
      // Create/Patch). Hard-Cap greift OBEN als letzte Schutzlinie.
      const maxBytes = effectiveUploadLimitBytes({
        tenantMaxUploadMib: link.gallery.tenant.maxUploadMib,
        linkMaxFileBytes: link.maxFileBytes,
      });
      for (const f of body.files) {
        if (BigInt(f.sizeBytes) > maxBytes) {
          return reply.status(413).send({
            error: "file_too_large",
            message: `${f.filename}: max ${formatLimit(maxBytes)}`,
            limitBytes: maxBytes.toString(),
          });
        }
      }

      // Typ-Allowlist (identisch zum Studio-Upload).
      const allowedKinds = effectiveAllowedKinds(
        link.gallery.tenant.uploadAllowedKinds
      );
      for (const f of body.files) {
        const kind = detectFileKind(f.filename, f.mimeType);
        if (!isKindAllowed(kind, allowedKinds)) {
          return reply.status(415).send({
            error: "file_type_not_allowed",
            message: `${f.filename}: Dieser Dateityp ist nicht erlaubt.`,
            kind,
            allowedKinds,
          });
        }
      }

      // Per-Link-Limit: Anzahl Files
      const additionalFiles = body.files.length;
      if (
        link.maxFiles !== null &&
        link.uploadCount + additionalFiles > link.maxFiles
      ) {
        return reply.status(403).send({
          error: "link_file_limit_reached",
          message: `Dieser Link erlaubt nur ${link.maxFiles} Dateien insgesamt.`,
        });
      }

      // Per-Link-Limit: Gesamt-Bytes
      const additionalBytes = body.files.reduce(
        (sum, f) => sum + BigInt(f.sizeBytes),
        0n
      );
      if (
        link.maxBytesTotal !== null &&
        link.bytesUploaded + additionalBytes > link.maxBytesTotal
      ) {
        return reply.status(403).send({
          error: "link_size_limit_reached",
          message: `Dieser Link hat sein Gesamt-Größen-Limit erreicht.`,
        });
      }

      // Plan-Limit-Check für den Tenant (Billing-Check, identisch zum
      // Studio-Upload-Flow)
      if (config.BILLING_ENABLED) {
        const check = await checkStorageLimit(
          link.gallery.tenantId,
          additionalBytes
        );
        if (!check.ok) {
          return reply.status(402).send(check);
        }
      }

      // File-Records anlegen + Presigned URLs erzeugen.
      // uploadedVia='upload_link', publicVisibility='hidden'.
      const uploads = [];
      for (const f of body.files) {
        const kind = detectFileKind(f.filename, f.mimeType);

        const fileRow = await prisma.file.create({
          data: {
            galleryId: link.galleryId,
            originalFilename: f.filename,
            storageKey: "",
            mimeType: f.mimeType,
            sizeBytes: BigInt(f.sizeBytes),
            kind,
            status: "uploading",
            uploadedVia: "upload_link",
            uploadLinkId: link.id,
            publicVisibility: "hidden",
          },
        });

        const key = originalKey({
          tenantId: link.gallery.tenantId,
          galleryId: link.galleryId,
          fileId: fileRow.id,
          filename: f.filename,
        });

        await prisma.file.update({
          where: { id: fileRow.id },
          data: { storageKey: key },
        });

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

      return reply.status(201).send({ uploads });
    }
  );

  // -------------------------------------------------------------------------
  // POST /u/:token/uploads/complete — Upload abschließen
  // -------------------------------------------------------------------------
  app.post<{ Params: { token: string }; Body: unknown }>(
    "/u/:token/uploads/complete",
    async (req, reply) => {
      const link = await loadLink(req.params.token);
      if (!link) {
        return reply.status(404).send({ error: "not_found_or_expired" });
      }
      if (!isUnlocked(req, link)) {
        return reply.status(401).send({ error: "password_required" });
      }

      const body = uploadCompleteSchema.parse(req.body);

      // File holen — muss zu DIESEM Link gehören, sonst 404
      // (Anti-Tampering: niemand soll fileIds anderer Links abschließen)
      const file = await prisma.file.findFirst({
        where: {
          id: body.fileId,
          uploadLinkId: link.id,
          galleryId: link.galleryId,
        },
        select: {
          id: true,
          storageKey: true,
          sizeBytes: true,
          kind: true,
          status: true,
          originalFilename: true,
        },
      });
      if (!file) return reply.status(404).send({ error: "not_found" });
      if (file.status !== "uploading") {
        return { fileId: file.id, status: file.status };
      }

      // Multipart abschließen, falls nötig
      if (body.parts && body.parts.length > 0) {
        try {
          await completeMultipartUpload({
            key: file.storageKey,
            uploadId: req.headers["x-upload-id"] as string,
            parts: body.parts.map((p) => ({
              PartNumber: p.partNumber,
              ETag: p.eTag,
            })),
          });
        } catch (err) {
          app.log.warn({ err, fileId: file.id }, "multipart complete failed");
          await prisma.file.update({
            where: { id: file.id },
            data: {
              status: "failed",
              errorMessage: "multipart_complete_failed",
            },
          });
          publish(link.galleryId, {
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

      // Link-Counter inkrementieren — atomisch, damit parallele
      // Uploads sich nicht in die Quere kommen.
      await prisma.uploadLink.update({
        where: { id: link.id },
        data: {
          uploadCount: { increment: 1 },
          bytesUploaded: { increment: file.sizeBytes },
          lastUploadAt: new Date(),
        },
      });

      // Studio-Benachrichtigung (gebündelt/gethrottlet, fire-and-forget).
      void notifyUploadReceived({ uploadLinkId: link.id });

      // Realtime-Pushes an den Studio-Browser (oder Customer-Browser,
      // aber Customer sieht das File eh nicht weil publicVisibility=hidden)
      publish(link.galleryId, {
        type: "file.status",
        fileId: file.id,
        status: "processing",
      });
      publish(link.galleryId, {
        type: "upload_link.received",
        fileId: file.id,
        uploadLinkId: link.id,
        filename: file.originalFilename,
      });

      // Worker-Job enqueuen — gleiches Pattern wie Studio-Upload
      const isRaw = file.kind === "raw";
      const isVideo = file.kind === "video";
      const isPdf = file.kind === "pdf";
      await enqueue(
        isVideo ? Queues.VIDEO_PROCESSING : Queues.FILE_PROCESSING,
        {
          type: isVideo
            ? "process_video"
            : isRaw
            ? "process_raw"
            : isPdf
            ? "process_pdf"
            : "process_file",
          fileId: file.id,
          tenantId: link.gallery.tenantId,
          galleryId: link.galleryId,
        }
      );

      return { fileId: file.id, status: "processing" };
    }
  );

  // -------------------------------------------------------------------------
  // POST /u/:token/uploads/:fileId/resign — Presigned URLs neu ausstellen
  // -------------------------------------------------------------------------
  // Analog zum Studio-Resign (POST /uploads/:fileId/resign), aber via
  // Upload-Link-Token authentifiziert. Use-Case identisch: bei sehr
  // langen Uploads ueber langsame Netze laufen die Original-Signatures
  // (TTL 1h) ab, oder transiente Network-Probleme machen die alten
  // URLs unbrauchbar.
  //
  // Wichtige Constraint: das File muss tatsaechlich zu diesem Upload-
  // Link gehoeren — sonst koennte jemand mit einem Link Files aus
  // anderen Sessions resignen. uploadLinkId-Check im findFirst.
  app.post<{ Params: { token: string; fileId: string } }>(
    "/u/:token/uploads/:fileId/resign",
    async (req, reply) => {
      const link = await loadLink(req.params.token);
      if (!link) {
        return reply.status(404).send({ error: "not_found_or_expired" });
      }
      if (!isUnlocked(req, link)) {
        return reply.status(401).send({ error: "password_required" });
      }
      const body = (req.body ?? {}) as {
        uploadId?: string;
        partNumbers?: number[];
      };

      const file = await prisma.file.findFirst({
        where: {
          id: req.params.fileId,
          uploadLinkId: link.id,
        },
      });
      if (!file) {
        return reply.status(404).send({ error: "not_found" });
      }
      if (file.status !== "uploading") {
        return reply.status(409).send({
          error: "not_uploadable",
          status: file.status,
        });
      }

      if (Number(file.sizeBytes) <= MULTIPART_THRESHOLD) {
        const uploadUrl = await presignPut({
          key: file.storageKey,
          contentType: file.mimeType,
          contentLength: Number(file.sizeBytes),
        });
        return {
          fileId: file.id,
          method: "single" as const,
          uploadUrl,
          headers: { "Content-Type": file.mimeType },
        };
      }

      if (!body.uploadId) {
        return reply.status(400).send({
          error: "missing_upload_id",
          message: "uploadId required for multipart resign",
        });
      }

      const totalParts = numberOfParts(Number(file.sizeBytes));
      const partSize = chunkSizeBytes();
      const wanted =
        body.partNumbers && body.partNumbers.length > 0
          ? body.partNumbers
          : Array.from({ length: totalParts }, (_, i) => i + 1);

      const parts: { partNumber: number; uploadUrl: string }[] = [];
      for (const partNumber of wanted) {
        if (partNumber < 1 || partNumber > totalParts) continue;
        const url = await presignUploadPart({
          key: file.storageKey,
          uploadId: body.uploadId,
          partNumber,
        });
        parts.push({ partNumber, uploadUrl: url });
      }

      return {
        fileId: file.id,
        method: "multipart" as const,
        uploadId: body.uploadId,
        partSize,
        totalParts,
        parts,
      };
    }
  );
}

// ---------------------------------------------------------------------------
// rejectFile — gemeinsamer Helper für Single- und Bulk-Reject
// ---------------------------------------------------------------------------
//   1. S3-Objekte löschen (Original + alle Renditions). Errors werden
//      geloggt aber nicht thrown — wir wollen den DB-State sauber halten
//      auch wenn S3-Cleanup teilweise scheitert (verwaiste Objekte werden
//      später vom Storage-GC-Job aufgeräumt).
//   2. DB-Row updaten: publicVisibility="rejected", Audit-Felder setzen.
//   3. Audit-Log-Eintrag schreiben.
//   4. WS-Event 'file.visibility' pushen damit Studio-Tabs live updaten.
//
// Wir LÖSCHEN die Rendition-Rows ABSICHTLICH nicht — die haben kein
// publicVisibility-Konzept und werden ohne ihr S3-Backing einfach 404en
// wenn jemand versucht zu lesen. Das passiert aber gar nicht, weil der
// Customer-Endpoint nur visible-Files liefert. Im Studio zeigen wir kein
// Thumbnail mehr (file.thumbUrl im Mapping = null wenn rendition fehlt
// oder presignGet fehlschlägt). Saubere DB-Hygiene wäre die Rendition-
// Rows zu löschen, aber dann kollidiert es mit gleichzeitigen Worker-
// Tasks die Renditions schreiben. Verwaiste DB-Renditions ohne S3 sind
// Out-of-the-Way und werden vom Storage-GC ebenfalls aufgeräumt.
interface RejectFileOpts {
  app: { log: { warn: (obj: object, msg?: string) => void } };
  fileId: string;
  storageKey: string;
  renditionKeys: string[];
  reason: string | null;
  actorUserId: string | null;
  tenantId: string;
  galleryId: string;
  ipAddress: string;
  bulk?: boolean;
}

async function rejectFile(opts: RejectFileOpts): Promise<void> {
  // 1) S3: Original + Renditions löschen (best-effort)
  await deleteObject(opts.storageKey).catch((err) =>
    opts.app.log.warn(
      { err, key: opts.storageKey, fileId: opts.fileId },
      "s3 delete original failed on reject"
    )
  );
  for (const key of opts.renditionKeys) {
    await deleteObject(key).catch((err) =>
      opts.app.log.warn(
        { err, key, fileId: opts.fileId },
        "s3 delete rendition failed on reject"
      )
    );
  }

  // 2) DB: Reject-State persistieren
  await prisma.file.update({
    where: { id: opts.fileId },
    data: {
      publicVisibility: "rejected",
      rejectedAt: new Date(),
      rejectedBy: opts.actorUserId,
      rejectedReason: opts.reason,
    },
  });

  // 3) Audit
  await logEvent({
    tenantId: opts.tenantId,
    actorType: "user",
    actorId: opts.actorUserId,
    action: "file.reject",
    targetType: "upload_link",
    payload: {
      galleryId: opts.galleryId,
      fileId: opts.fileId,
      reason: opts.reason,
      bulk: opts.bulk ?? false,
    },
    ipAddress: opts.ipAddress,
  });

  // 4) WS-Push damit andere Studio-Tabs den State live sehen
  publish(opts.galleryId, {
    type: "file.visibility",
    fileId: opts.fileId,
    publicVisibility: "rejected",
  });
}
