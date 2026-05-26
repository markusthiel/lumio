/**
 * Lumio API — Job Queue
 *
 * Sehr leichtgewichtige Queue zwischen Node-API (Producer) und
 * Python-Worker (Consumer). Wir verwenden Redis-Streams statt BullMQ
 * oder Celery-Internals, weil beide Seiten verschiedene Sprachen sind
 * und wir kein Wire-Format-Lock-in haben wollen.
 *
 * Streams:
 *   lumio:jobs:file_processing   — Bilder/RAW, ein Job pro File
 *   lumio:jobs:video_processing  — Videos, ein Job pro File
 *   lumio:jobs:zip_build         — ZIP-Erstellung für Gallery-Downloads
 *
 * Payload: JSON. Konsumenten ack-en mit XACK; nicht-ack-ed Messages
 * werden via XPENDING/XCLAIM nach 60s an einen anderen Consumer übergeben.
 */
import Redis from "ioredis";
import { config } from "../config.js";
import { logger } from "../logger.js";

let _redis: Redis | null = null;

function redis(): Redis {
  if (_redis) return _redis;
  _redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null, // BullMQ-kompatibel und ok für Streams
    enableReadyCheck: true,
  });
  _redis.on("error", (err) => {
    logger.warn({ err: err.message }, "redis error");
  });
  return _redis;
}

export const Queues = {
  FILE_PROCESSING: "lumio:jobs:file_processing",
  VIDEO_PROCESSING: "lumio:jobs:video_processing",
  ZIP_BUILD: "lumio:jobs:zip_build",
  WEBHOOK_DELIVERY: "lumio:jobs:webhook_delivery",
  /** Stripe-Webhook-Verarbeitung. Jeder Job verweist auf eine
   * stripe_webhook_events-Row, der Worker liest den Payload daraus
   * (statt ihn nochmal im Stream zu duplizieren — Payload kann groß
   * sein und Stream-Storage wäre teuer). */
  STRIPE_WEBHOOK: "lumio:jobs:stripe_webhook",
  /** Background-Backfills (z.B. SHA-256 für alte Files). Eigene Queue
   * statt FILE_PROCESSING, weil ein langer Backfill sonst die Upload-
   * Verarbeitung blockieren würde — der Worker hat begrenzte Slots. */
  BACKFILL: "lumio:jobs:backfill",
  /** Storage-Cleanup nach Galerie- oder Tenant-Delete. Eigene Queue
   * weil ein Cleanup einer 50k-File-Galerie länger laufen kann und
   * sonst die normale Pipeline blockieren würde. */
  CLEANUP: "lumio:jobs:cleanup",
  /** Tenant-Export-Builds (DSGVO / Backup / Self-Service). Eigene
   * Queue, damit ein langer Export nicht die regulaere ZIP-Pipeline
   * fuer Customer-Downloads blockiert. */
  EXPORT: "lumio:jobs:export",
} as const;
export type QueueName = (typeof Queues)[keyof typeof Queues];

export type FileProcessingJob =
  | {
      type: "process_file" | "process_raw" | "process_watermark";
      fileId: string;
      tenantId: string;
      galleryId: string;
    }
  | {
      /** Branding-Asset-Optimierung (z.B. WebP-Konvertierung von
       *  Login-Background-Bildern). Hat keine fileId/galleryId — das
       *  Asset gehoert direkt zum Branding. */
      type: "process_branding_asset";
      brandingId: string;
      /** Welches Asset wird optimiert: "loginBackground" (aktuell der
       *  einzige Kind, der einen Worker-Roundtrip braucht). */
      kind: "loginBackground";
    };

export interface VideoProcessingJob {
  type: "process_video";
  fileId: string;
  tenantId: string;
  galleryId: string;
}

export interface ZipBuildJob {
  type: "build_zip";
  tenantId: string;
  galleryId: string;
  fileIds: string[] | null;
  label: string;
  accessId?: string;
  zipDownloadId: string;
  variant?: "original" | "web";
}

export interface WebhookDeliveryJob {
  type: "webhook_delivery";
  deliveryId: string;
}

export interface StripeWebhookJob {
  type: "stripe_webhook";
  /** Stripe's Event-ID. Worker lookups das via stripe_webhook_events. */
  eventId: string;
}

export interface BackfillJob {
  type: "backfill_sha256";
  galleryId: string;
  tenantId: string;
}

export interface CleanupJob {
  type: "cleanup_gallery" | "cleanup_tenant" | "cleanup_expired_exports";
  tenantId?: string;
  /** Nur bei cleanup_gallery. */
  galleryId?: string;
}

export interface ExportJob {
  type: "export_zip";
  exportItemId: string;
  tenantId: string;
  galleryId: string;
}

export type AnyJob =
  | FileProcessingJob
  | VideoProcessingJob
  | ZipBuildJob
  | WebhookDeliveryJob
  | StripeWebhookJob
  | BackfillJob
  | CleanupJob
  | ExportJob;

/**
 * Job in den passenden Stream legen. Gibt die Stream-ID zurück (für Logging).
 */
export async function enqueue(
  queue: QueueName,
  job: AnyJob
): Promise<string> {
  const id = await redis().xadd(
    queue,
    "*",
    "payload",
    JSON.stringify(job),
    "enqueuedAt",
    String(Date.now())
  );
  logger.debug({ queue, id, type: job.type }, "job enqueued");
  return id ?? "";
}

/** Closeable für sauberen Shutdown. */
export async function closeQueue(): Promise<void> {
  if (_redis) {
    await _redis.quit().catch(() => {});
    _redis = null;
  }
}
