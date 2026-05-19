/**
 * Lumio API — Real-time Events Service
 *
 * In-Memory Pub/Sub für Gallery-Events. Wird vom WebSocket-Endpoint
 * (/ws/galleries/:id) konsumiert und von verschiedenen Stellen (Worker-
 * Notifier, File-Operations, Selection-Updates) gefüttert.
 *
 * Quellen:
 *   1) API-interne Aufrufer: rufen einfach publish() — synchroner Aufruf
 *      direkt an die lokalen Subscriber.
 *   2) Worker (anderer Container): published nach Redis-Channel
 *      `lumio:events:gallery:<id>`; wir abonnieren das beim API-Start
 *      und forwarden in den lokalen Bus.
 *
 * Subscriber-Lifecycle: subscribe() gibt ein unsubscribe-Callback zurück,
 * das die WebSocket-Route bei socket.close() aufrufen MUSS, sonst leaken
 * Subscriptions.
 */
import Redis from "ioredis";
import { config } from "../config.js";
import { logger } from "../logger.js";

export type GalleryEvent =
  | {
      type: "file.status";
      fileId: string;
      status: "uploading" | "processing" | "ready" | "failed" | "hidden";
      // optional: bei status=ready werden Bildmaße mitgeliefert, damit das
      // Frontend nicht zwingend nachladen muss
      width?: number | null;
      height?: number | null;
    }
  | {
      type: "file.deleted";
      fileId: string;
    }
  | {
      type: "file.added";
      fileId: string;
    }
  | {
      type: "selection.changed";
      fileId: string;
      // Studio-Kunden-Auswahlfeedback in Echtzeit (Phase 2 — Hook ist da)
    };

type Listener = (event: GalleryEvent) => void;

// galleryId → Set<Listener>
const subscribers = new Map<string, Set<Listener>>();

// Redis-Channel-Konvention: ein Channel pro Galerie, damit wir pro
// Subscription gezielt subscriben können
const REDIS_CHANNEL_PREFIX = "lumio:events:gallery:";

let _subRedis: Redis | null = null;
let _pubRedis: Redis | null = null;

function pubRedis(): Redis {
  if (_pubRedis) return _pubRedis;
  _pubRedis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  _pubRedis.on("error", (err) =>
    logger.warn({ err: err.message }, "events: pub redis error")
  );
  return _pubRedis;
}

function subRedis(): Redis {
  if (_subRedis) return _subRedis;
  _subRedis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  _subRedis.on("error", (err) =>
    logger.warn({ err: err.message }, "events: sub redis error")
  );
  _subRedis.on("messageBuffer", (channelBuf, msgBuf) => {
    const channel = channelBuf.toString();
    const message = msgBuf.toString();
    if (!channel.startsWith(REDIS_CHANNEL_PREFIX)) return;
    const galleryId = channel.slice(REDIS_CHANNEL_PREFIX.length);
    try {
      const event = JSON.parse(message) as GalleryEvent;
      // Achtung: nicht selbst wieder nach Redis re-publishen, sonst Loop.
      dispatchLocal(galleryId, event);
    } catch (err) {
      logger.warn({ err, channel }, "events: invalid redis message");
    }
  });
  return _subRedis;
}

function dispatchLocal(galleryId: string, event: GalleryEvent): void {
  const set = subscribers.get(galleryId);
  if (!set || set.size === 0) return;
  for (const listener of set) {
    try {
      listener(event);
    } catch (err) {
      logger.warn({ err, galleryId, type: event.type }, "events: listener failed");
    }
  }
}

export function subscribe(galleryId: string, listener: Listener): () => void {
  let set = subscribers.get(galleryId);
  if (!set) {
    set = new Set();
    subscribers.set(galleryId, set);
    // Erste Subscription für diese Galerie: Redis-Channel abonnieren,
    // damit Worker-Events ankommen
    void subRedis().subscribe(REDIS_CHANNEL_PREFIX + galleryId);
  }
  set.add(listener);
  return () => {
    const s = subscribers.get(galleryId);
    if (!s) return;
    s.delete(listener);
    if (s.size === 0) {
      subscribers.delete(galleryId);
      // Letzte Subscription weg: Redis-Channel verlassen
      void subRedis().unsubscribe(REDIS_CHANNEL_PREFIX + galleryId);
    }
  };
}

/**
 * Event veröffentlichen. Geht parallel an lokale Subscriber (synchron) und
 * an alle anderen API-Instanzen via Redis. Falls in Zukunft mehrere API-
 * Pods laufen, sehen Browser auf Pod A also auch Events von Pod B.
 *
 * Worker (anderer Container) publishen direkt in den Redis-Channel mit
 * Schema "lumio:events:gallery:<galleryId>", JSON-Payload mit "type", ...
 */
export function publish(galleryId: string, event: GalleryEvent): void {
  dispatchLocal(galleryId, event);
  void pubRedis()
    .publish(REDIS_CHANNEL_PREFIX + galleryId, JSON.stringify(event))
    .catch((err) =>
      logger.warn({ err, galleryId }, "events: redis publish failed")
    );
}

// Für Tests / Debugging
export function subscriberCount(galleryId: string): number {
  return subscribers.get(galleryId)?.size ?? 0;
}

export async function closeEvents(): Promise<void> {
  if (_subRedis) {
    await _subRedis.quit().catch(() => {});
    _subRedis = null;
  }
  if (_pubRedis) {
    await _pubRedis.quit().catch(() => {});
    _pubRedis = null;
  }
}
