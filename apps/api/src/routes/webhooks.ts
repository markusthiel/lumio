/**
 * Lumio API — Webhook Settings Routes
 *
 *   GET    /webhooks                    — alle Webhooks des Tenants
 *   POST   /webhooks                    — neuen Webhook anlegen (Secret wird einmalig ausgeliefert)
 *   GET    /webhooks/:id                — Detail
 *   PATCH  /webhooks/:id                — Webhook ändern (events/active/label/url)
 *   DELETE /webhooks/:id                — Löschen
 *   POST   /webhooks/:id/test           — Test-Delivery senden, sofort
 *   GET    /webhooks/:id/deliveries     — Audit-Log der letzten Deliveries
 *
 * Secret-Lifecycle: beim Create wird ein zufälliges 32-Byte-Hex-Secret
 * generiert und EINMAL im Response zurückgegeben. Spätere GETs liefern
 * es nicht mehr — der Studio-User soll es notieren oder beim Empfänger
 * abgleichen. Wer es verliert, muss den Webhook neu anlegen.
 *
 * Events sind eine Whitelist (siehe services/webhooks.ts); ungültige
 * Werte werden mit 400 abgelehnt, statt sie still zu schlucken.
 */
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { logEvent } from "../services/audit.js";
import {
  isSupportedEvent,
  sendTestDelivery,
  SUPPORTED_EVENTS,
} from "../services/webhooks.js";

const eventsSchema = z
  .array(z.string())
  .min(1)
  .max(SUPPORTED_EVENTS.length)
  .refine(
    (arr) => arr.every(isSupportedEvent),
    "events contains an unsupported entry"
  );

const createSchema = z.object({
  label: z.string().min(1).max(120),
  url: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://"), "url must be https"),
  events: eventsSchema,
  active: z.boolean().default(true),
});

const updateSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  url: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://"), "url must be https")
    .optional(),
  events: eventsSchema.optional(),
  active: z.boolean().optional(),
});

function generateSecret(): string {
  // 32 Bytes = 64 Hex-Zeichen. Bei HMAC-SHA256 wäre alles >= 32 Bytes
  // (256 bit) als Key gut; mehr schadet nicht, kürzer wäre suspekt.
  return randomBytes(32).toString("hex");
}

/** Stellt sicher, dass ein Webhook zum Tenant gehört, sonst 404. */
async function ownedWebhook(tenantId: string, id: string) {
  return prisma.webhook.findFirst({
    where: { id, tenantId },
  });
}

export async function registerWebhookRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // GET /webhooks
  // -------------------------------------------------------------------------
  app.get("/webhooks", async (req) => {
    req.requireAuth();
    const webhooks = await prisma.webhook.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        label: true,
        url: true,
        events: true,
        active: true,
        lastDeliveryAt: true,
        lastDeliveryOk: true,
        createdAt: true,
        // secret NICHT — wird nur beim Create ausgeliefert
      },
    });
    return { webhooks, supportedEvents: SUPPORTED_EVENTS };
  });

  // -------------------------------------------------------------------------
  // POST /webhooks
  // -------------------------------------------------------------------------
  app.post("/webhooks", async (req, reply) => {
    const s = req.requireAuth();
    const body = createSchema.parse(req.body);
    const secret = generateSecret();
    const webhook = await prisma.webhook.create({
      data: {
        tenantId: req.tenantId,
        label: body.label,
        url: body.url,
        secret,
        events: body.events,
        active: body.active,
      },
    });
    await logEvent({
      tenantId: req.tenantId,
      actorType: "user",
      actorId: s.user.id,
      action: "webhook.create",
      targetType: "webhook",
      targetId: webhook.id,
      payload: { label: webhook.label, url: webhook.url, events: webhook.events },
      ipAddress: req.ip,
    });
    return reply.status(201).send({
      webhook: {
        id: webhook.id,
        label: webhook.label,
        url: webhook.url,
        events: webhook.events,
        active: webhook.active,
        createdAt: webhook.createdAt,
      },
      // Einmalige Ausgabe — wird so nie wieder zurückgegeben.
      secret,
    });
  });

  // -------------------------------------------------------------------------
  // GET /webhooks/:id
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>("/webhooks/:id", async (req, reply) => {
    req.requireAuth();
    const wh = await ownedWebhook(req.tenantId, req.params.id);
    if (!wh) return reply.status(404).send({ error: "not_found" });
    return {
      webhook: {
        id: wh.id,
        label: wh.label,
        url: wh.url,
        events: wh.events,
        active: wh.active,
        lastDeliveryAt: wh.lastDeliveryAt,
        lastDeliveryOk: wh.lastDeliveryOk,
        createdAt: wh.createdAt,
      },
    };
  });

  // -------------------------------------------------------------------------
  // PATCH /webhooks/:id
  // -------------------------------------------------------------------------
  app.patch<{ Params: { id: string } }>(
    "/webhooks/:id",
    async (req, reply) => {
      const s = req.requireAuth();
      const existing = await ownedWebhook(req.tenantId, req.params.id);
      if (!existing) return reply.status(404).send({ error: "not_found" });
      const body = updateSchema.parse(req.body);
      const webhook = await prisma.webhook.update({
        where: { id: existing.id },
        data: {
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.url !== undefined ? { url: body.url } : {}),
          ...(body.events !== undefined ? { events: body.events } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
        },
      });
      await logEvent({
        tenantId: req.tenantId,
        actorType: "user",
        actorId: s.user.id,
        action: "webhook.update",
        targetType: "webhook",
        targetId: webhook.id,
        payload: body,
        ipAddress: req.ip,
      });
      return {
        webhook: {
          id: webhook.id,
          label: webhook.label,
          url: webhook.url,
          events: webhook.events,
          active: webhook.active,
          createdAt: webhook.createdAt,
        },
      };
    }
  );

  // -------------------------------------------------------------------------
  // DELETE /webhooks/:id
  // -------------------------------------------------------------------------
  app.delete<{ Params: { id: string } }>(
    "/webhooks/:id",
    async (req, reply) => {
      const s = req.requireAuth();
      const existing = await ownedWebhook(req.tenantId, req.params.id);
      if (!existing) return reply.status(404).send({ error: "not_found" });
      await prisma.webhook.delete({ where: { id: existing.id } });
      await logEvent({
        tenantId: req.tenantId,
        actorType: "user",
        actorId: s.user.id,
        action: "webhook.delete",
        targetType: "webhook",
        targetId: existing.id,
        payload: { label: existing.label, url: existing.url },
        ipAddress: req.ip,
      });
      return reply.status(204).send();
    }
  );

  // -------------------------------------------------------------------------
  // POST /webhooks/:id/test — Sendet einen "test.ping" sofort, synchron.
  // -------------------------------------------------------------------------
  // Bewusst synchron im Request-Pfad: der Studio-User klickt "Testen"
  // und will jetzt sofort sehen, ob's tut. 10s-Timeout im Service.
  app.post<{ Params: { id: string } }>(
    "/webhooks/:id/test",
    async (req, reply) => {
      req.requireAuth();
      const wh = await ownedWebhook(req.tenantId, req.params.id);
      if (!wh) return reply.status(404).send({ error: "not_found" });
      const result = await sendTestDelivery({
        url: wh.url,
        secret: wh.secret,
        webhookId: wh.id,
      });
      // lastDelivery in der DB updaten, damit der UI-Stand stimmt
      await prisma.webhook.update({
        where: { id: wh.id },
        data: {
          lastDeliveryAt: new Date(),
          lastDeliveryOk: result.ok,
        },
      });
      return result;
    }
  );

  // -------------------------------------------------------------------------
  // GET /webhooks/:id/deliveries — Audit der letzten 50 Deliveries
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    "/webhooks/:id/deliveries",
    async (req, reply) => {
      req.requireAuth();
      const wh = await ownedWebhook(req.tenantId, req.params.id);
      if (!wh) return reply.status(404).send({ error: "not_found" });
      const deliveries = await prisma.webhookDelivery.findMany({
        where: { webhookId: wh.id },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          eventType: true,
          status: true,
          httpStatus: true,
          errorMessage: true,
          attempts: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      return { deliveries };
    }
  );
}
