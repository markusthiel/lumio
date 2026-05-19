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
} as const;
export type QueueName = (typeof Queues)[keyof typeof Queues];

export interface FileProcessingJob {
  type: "process_file" | "process_raw";
  fileId: string;
  tenantId: string;
  galleryId: string;
}

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
  fileIds: string[] | null; // null = alle Files der Galerie
  label: string;
  accessId?: string; // wenn aus Kunden-Auswahl gebaut
}

export type AnyJob = FileProcessingJob | VideoProcessingJob | ZipBuildJob;

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
