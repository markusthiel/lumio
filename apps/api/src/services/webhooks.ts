/**
 * Lumio API — Webhook Service
 *
 * Stellt zwei Dinge bereit:
 *   1) signPayload() — HMAC-SHA256 über `timestamp + "." + body`. Wir
 *      schicken den Hex-Digest als `X-Lumio-Signature` und den Timestamp
 *      als `X-Lumio-Timestamp`. Empfänger verifizieren wie bei Stripe.
 *
 *   2) publishEvent() — sucht alle aktiven Webhooks im Tenant raus, die
 *      auf den Event subscribed sind, schreibt für jeden einen
 *      WebhookDelivery-Row mit status="pending" und legt einen Job in
 *      die Worker-Queue. Der Worker holt die Delivery, baut den Request
 *      mit Signatur, postet, und aktualisiert status/attempts.
 *
 * Warum erst persistieren, dann queuen:
 *
 *   - Wenn der Redis-Push fehlschlägt, ist die Delivery trotzdem in der
 *     DB und kann später von einem Backfill-Cron neu in den Stream
 *     gelegt werden.
 *
 *   - Der Worker braucht nur die deliveryId — alles andere (URL, Secret,
 *     Payload) holt er aus der Row. Das hält den Stream-Payload klein
 *     und macht Retry trivial: Worker re-queued einfach mit derselben
 *     deliveryId und einem nextAttemptAt-Timestamp.
 */
import { createHmac } from "node:crypto";

import { prisma } from "../db.js";
import { enqueue, Queues } from "./queue.js";
import { logger } from "../logger.js";

/**
 * Whitelist aller Events, die wir senden. Wer das hier nicht enthält,
 * existiert nicht — wir validieren beim Anlegen eines Webhooks dagegen,
 * damit ein Studio-User nicht stillschweigend tippt "selection.fianlized"
 * und sich dann wundert, warum nichts kommt.
 */
export const SUPPORTED_EVENTS = [
  "gallery.created",
  "gallery.deleted",
  "gallery.live",
  "selection.finalized",
  "comment.posted",
  "file.uploaded",
  "file.failed",
] as const;
export type WebhookEvent = (typeof SUPPORTED_EVENTS)[number];

export function isSupportedEvent(s: string): s is WebhookEvent {
  return (SUPPORTED_EVENTS as readonly string[]).includes(s);
}

/**
 * HMAC-SHA256 über "timestamp.body". Der Worker nimmt das so eins-zu-eins
 * für jeden Request, der Empfänger muss exakt dieselbe Konkatenation
 * signieren und mit timing-safe compare vergleichen.
 *
 * Header-Schema (Werte für das Beispiel timestamp=1730000000):
 *   X-Lumio-Timestamp: 1730000000
 *   X-Lumio-Signature: sha256=abcd1234...
 *
 * Das `sha256=`-Prefix ist GitHub-Konvention; macht den Algorithmus
 * explizit, falls wir später mal auf SHA-512 wechseln.
 */
export function signPayload(input: {
  body: string;
  secret: string;
  timestamp: number;
}): string {
  const mac = createHmac("sha256", input.secret);
  mac.update(`${input.timestamp}.${input.body}`);
  return `sha256=${mac.digest("hex")}`;
}

/**
 * Triggert einen Event für einen Tenant. Erstellt pro passendem aktivem
 * Webhook eine WebhookDelivery und enqueued einen Worker-Job.
 *
 * Wichtig: NIEMALS im Hot-Path "await"-en wir hier auf den eigentlichen
 * HTTP-POST. Die Funktion gibt sofort zurück, der Versand ist async.
 * Aufrufer können also gefahrlos mit `await publishEvent(...)` arbeiten,
 * ohne dass langsame Webhook-Empfänger ihre Studio-Request blockieren.
 *
 * Fehler hier (z.B. DB-Probleme beim Insert) werden geloggt und
 * geschluckt, NICHT geworfen — ein nicht-ausgelieferter Webhook darf
 * unter keinen Umständen eine Gallery-Erstellung scheitern lassen.
 */
export async function publishEvent(input: {
  tenantId: string;
  eventType: WebhookEvent;
  payload: Record<string, unknown>;
}): Promise<void> {
  try {
    const webhooks = await prisma.webhook.findMany({
      where: {
        tenantId: input.tenantId,
        active: true,
        events: { has: input.eventType },
      },
      select: { id: true },
    });
    if (webhooks.length === 0) return;

    // Wir fügen Metadaten dazu, die jedem Event-Body beiliegen sollten.
    // event, eventId, timestamp gibt's auch im Signing-Header, aber im
    // Body sind sie leichter zu loggen für den Empfänger.
    const fullPayload = {
      event: input.eventType,
      timestamp: new Date().toISOString(),
      data: input.payload,
    };

    for (const wh of webhooks) {
      try {
        const delivery = await prisma.webhookDelivery.create({
          data: {
            webhookId: wh.id,
            eventType: input.eventType,
            // Prisma's InputJsonValue ist strikter als Record<string, unknown>.
            // Wir wissen, dass fullPayload reine JSON-Daten sind (Strings,
            // Zahlen, Bools, Arrays, Plain Objects) — der Cast ist also
            // semantisch sicher. Audit-Service handhabt das identisch.
            payload: fullPayload as never,
            status: "pending",
            // Beim ersten Versuch sofort — der Worker pickt up im
            // nächsten Tick. nextAttemptAt = now lässt den Retry-Scan
            // (siehe Worker) das Row sofort verarbeiten, ohne dass wir
            // den Stream-Push und die DB-Row aus der Synchronität
            // bringen müssen.
            nextAttemptAt: new Date(),
          },
        });
        await enqueue(Queues.WEBHOOK_DELIVERY, {
          type: "webhook_delivery",
          deliveryId: delivery.id,
        });
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), webhookId: wh.id },
          "webhook: failed to create delivery row"
        );
      }
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), eventType: input.eventType },
      "webhook: publishEvent failed (swallowed)"
    );
  }
}

/**
 * Verifiziert eine vom Studio gemeldete Test-Auslieferung. Wird über
 * den "Test" Button im SettingsPanel aufgerufen. Liefert true, wenn
 * der Webhook-Endpoint mit 2xx geantwortet hat.
 *
 * Implementierung ähnlich wie der Worker-Pfad, aber bewusst inline und
 * synchron im API-Request — bei Test-Buttons will der User sofort
 * sehen, ob's tut. Timeout 10s, damit ein hängender Endpoint nicht die
 * Studio-UI blockiert.
 */
export async function sendTestDelivery(input: {
  url: string;
  secret: string;
  webhookId: string;
}): Promise<{ ok: boolean; httpStatus?: number; errorMessage?: string }> {
  const fullPayload = {
    event: "test.ping",
    timestamp: new Date().toISOString(),
    data: {
      webhookId: input.webhookId,
      message: "Hi from Lumio — this is a test delivery to verify your endpoint.",
    },
  };
  const body = JSON.stringify(fullPayload);
  const ts = Math.floor(Date.now() / 1000);
  const sig = signPayload({ body, secret: input.secret, timestamp: ts });

  // Wir setzen eigenes Timeout via AbortController, statt fetch's
  // Default zu vertrauen — der ist bei Node sehr lang.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(input.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Lumio-Timestamp": String(ts),
        "X-Lumio-Signature": sig,
        "X-Lumio-Event": "test.ping",
        "User-Agent": "Lumio-Webhook/1.0",
      },
      body,
      signal: controller.signal,
    });
    if (res.ok) {
      return { ok: true, httpStatus: res.status };
    }
    return { ok: false, httpStatus: res.status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, errorMessage: msg };
  } finally {
    clearTimeout(timeoutId);
  }
}
