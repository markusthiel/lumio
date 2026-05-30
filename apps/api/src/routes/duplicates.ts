/**
 * Lumio API — Duplicate Detection Routes
 *
 * Bit-genaue Duplikat-Erkennung pro Galerie basierend auf SHA-256-
 * Hashes. Workflow:
 *
 *   1. Studio klickt "Duplikate finden"
 *   2. POST /galleries/:id/duplicates/scan
 *        → wenn alle Files schon einen Hash haben: 200 mit
 *          { scanRequired: false, groups: [...] } direkt zurueck
 *        → sonst: Backfill-Job in lumio:jobs:backfill queuen,
 *          { scanRequired: true } zurueck
 *   3. Studio polled GET /galleries/:id/duplicates/scan-status
 *      bis status==='done', zeigt waehrenddessen einen Progress-Bar
 *   4. Wenn done: GET /galleries/:id/duplicates fuer die Gruppen
 *
 * Die eigentliche Loesch-Aktion laeuft ueber den bestehenden
 * /files/bulk-action-Endpoint — der hat schon S3-Cleanup, Audit-Log,
 * ZIP-Cache-Invalidation. Wir bauen also keinen eigenen Delete hier.
 */
import type { FastifyInstance } from "fastify";
import Redis from "ioredis";

import { prisma } from "../db.js";
import { config } from "../config.js";
import { enqueue, Queues } from "../services/queue.js";
import { presignGet } from "../services/storage.js";
import { galleryAccessWhere } from "../lib/gallery-access.js";


const REDIS_PROGRESS_PREFIX = "lumio:dup-scan:";

let _redis: Redis | null = null;
function redis(): Redis {
  if (_redis) return _redis;
  _redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
  });
  return _redis;
}


export async function registerDuplicateRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // POST /galleries/:id/duplicates/scan — Scan starten (oder direkt
  // Ergebnis zurueckgeben, wenn alle Files schon einen Hash haben).
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/galleries/:id/duplicates/scan",
    async (req, reply) => {
      const s = req.requireAuth();
      const gallery = await prisma.gallery.findFirst({
        where: {
          id: req.params.id,
          tenantId: req.tenantId,
          ...galleryAccessWhere(s),
        },
        select: { id: true, tenantId: true },
      });
      if (!gallery) {
        return reply.status(404).send({ error: "not_found" });
      }

      // Files ohne Hash zaehlen — nur ready-Files brauchen Backfill,
      // weil uploading/processing/failed entweder noch ihren Hash
      // ueber die Pipeline bekommen oder gar keiner gehashtes
      // Material haben.
      const missingCount = await prisma.file.count({
        where: {
          galleryId: gallery.id,
          status: "ready",
          sha256: null,
        },
      });

      if (missingCount === 0) {
        // Alles schon gehashed → direkt scannen-Status liefern, der
        // Caller kann gleich GET /duplicates aufrufen.
        return {
          scanRequired: false,
          missingCount: 0,
        };
      }

      // Bei sehr kleinen Galerien (< ~50 ungehashte Files) koennten
      // wir synchron hashen — Browser wartet kurz. Pragmatisch
      // einheitlich asynchron: User sieht immer Progress, kein
      // Unterscheidungsfall. Backfill-Task enqueuen, initial Status
      // setzen damit ein direktes Polling sofort 'queued' sieht.
      await redis().set(
        REDIS_PROGRESS_PREFIX + gallery.id,
        JSON.stringify({
          total: missingCount,
          done: 0,
          ok: 0,
          failed: 0,
          status: "queued",
        }),
        "EX",
        3600,
      );

      await enqueue(Queues.BACKFILL, {
        type: "backfill_sha256",
        galleryId: gallery.id,
        tenantId: gallery.tenantId,
      });

      return {
        scanRequired: true,
        missingCount,
      };
    },
  );

  // -------------------------------------------------------------------------
  // GET /galleries/:id/duplicates/scan-status — Progress polling
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    "/galleries/:id/duplicates/scan-status",
    async (req, reply) => {
      const s = req.requireAuth();
      const gallery = await prisma.gallery.findFirst({
        where: {
          id: req.params.id,
          tenantId: req.tenantId,
          ...galleryAccessWhere(s),
        },
        select: { id: true },
      });
      if (!gallery) {
        return reply.status(404).send({ error: "not_found" });
      }

      const raw = await redis().get(REDIS_PROGRESS_PREFIX + gallery.id);
      if (!raw) {
        // Kein Progress-Eintrag — entweder nie gestartet, oder
        // bereits abgelaufen (TTL 1h). Wir liefern 'idle', das
        // Frontend interpretiert das als "kein laufender Scan".
        return {
          status: "idle" as const,
          total: 0,
          done: 0,
          ok: 0,
          failed: 0,
        };
      }
      try {
        const parsed = JSON.parse(raw);
        return {
          status: parsed.status,
          total: parsed.total ?? 0,
          done: parsed.done ?? 0,
          ok: parsed.ok ?? 0,
          failed: parsed.failed ?? 0,
        };
      } catch {
        return {
          status: "idle" as const,
          total: 0,
          done: 0,
          ok: 0,
          failed: 0,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /galleries/:id/duplicates — Gruppen mit identischem SHA
  // -------------------------------------------------------------------------
  // Liefert nur Files mit identischem sha256, gruppiert. Files ohne
  // sha256 werden ignoriert (Frontend sollte vorher den Scan
  // ausfuehren). Pro File geben wir thumbUrl + Metadaten zurueck,
  // damit das Studio die Gruppen ohne weitere Round-Trips rendern
  // kann.
  app.get<{ Params: { id: string } }>(
    "/galleries/:id/duplicates",
    async (req, reply) => {
      const s = req.requireAuth();
      const gallery = await prisma.gallery.findFirst({
        where: {
          id: req.params.id,
          tenantId: req.tenantId,
          ...galleryAccessWhere(s),
        },
        select: { id: true },
      });
      if (!gallery) {
        return reply.status(404).send({ error: "not_found" });
      }

      // Files mit nicht-null sha256 holen, sortiert nach (sha256, createdAt)
      // damit das Group-By in JS trivial wird. createdAt aufsteigend, damit
      // pro Gruppe das aelteste File zuerst kommt — UI markiert das neueste
      // (= letzte) als Default-zu-loeschen.
      const files = await prisma.file.findMany({
        where: {
          galleryId: gallery.id,
          sha256: { not: null },
        },
        include: {
          renditions: { select: { kind: true, storageKey: true } },
        },
        orderBy: [{ sha256: "asc" }, { createdAt: "asc" }],
      });

      // Group-By: alle Files zusammenfassen die mehrfach vorkommen.
      const groups: Record<string, typeof files> = {};
      for (const f of files) {
        const k = f.sha256!;
        (groups[k] ??= []).push(f);
      }

      // Nur echte Duplikat-Gruppen ausgeben (size > 1), thumbUrls
      // dazu signieren. Parallelisierte Presigns sind ok — jedes
      // ist ein lokaler SDK-Sign-Call, kein S3-Roundtrip.
      const result = await Promise.all(
        Object.entries(groups)
          .filter(([, group]) => group.length > 1)
          .map(async ([sha256, group]) => {
            const items = await Promise.all(
              group.map(async (f) => {
                const thumb = f.renditions.find((r) => r.kind === "thumb");
                const thumbUrl = thumb
                  ? await presignGet({ key: thumb.storageKey })
                  : null;
                return {
                  id: f.id,
                  originalFilename: f.originalFilename,
                  sizeBytes: Number(f.sizeBytes),
                  createdAt: f.createdAt,
                  width: f.width,
                  height: f.height,
                  thumbUrl,
                };
              }),
            );
            return {
              sha256,
              count: items.length,
              files: items,
            };
          }),
      );

      // Groesste Gruppen zuerst — die fallen am ehesten auf und
      // bringen das groesste Aufraeumpotenzial.
      result.sort((a, b) => b.count - a.count);

      return {
        galleryId: gallery.id,
        groupCount: result.length,
        totalDuplicates: result.reduce((sum, g) => sum + (g.count - 1), 0),
        groups: result,
      };
    },
  );
}
