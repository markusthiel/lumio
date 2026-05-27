/**
 * Lumio API — Broadcast-Routes
 *
 * Public:
 *   GET /broadcasts/unsubscribe?t=<token> — Opt-Out (kein Auth)
 *
 * Super-Admin:
 *   GET    /super/broadcasts            — Liste mit Status
 *   POST   /super/broadcasts            — neu erstellen (start sofort)
 *   POST   /super/broadcasts/preview    — Markdown-HTML-Preview ohne Versand
 *   POST   /super/broadcasts/test-send  — Test-Mail an die eigene
 *                                          Super-Admin-Email
 *   GET    /super/broadcasts/:id        — Detail mit Counts
 *   DELETE /super/broadcasts/:id        — nur bei pending/failed
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { logEvent } from "../services/audit.js";
import {
  AUDIENCE_LABELS,
  listAudienceUsers,
  processBroadcast,
  renderBroadcastHtml,
  type Audience,
} from "../services/broadcast.js";
import { sendMail } from "../services/mail.js";
import { config } from "../config.js";

const audienceSchema = z.enum([
  "all_paid_owners",
  "all_trial_owners",
  "all_owners",
  "all_active_users",
] as const);

const createSchema = z.object({
  subject: z.string().min(1).max(200),
  bodyMarkdown: z.string().min(1).max(20000),
  audience: audienceSchema,
});

export async function registerBroadcastRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // Public: GET /broadcasts/unsubscribe?t=<token>
  // -------------------------------------------------------------------------
  // Setzt broadcastOptOut=true am User. Wir antworten mit einer kleinen
  // HTML-Seite (kein React, kein Login), damit der User die Bestaetigung
  // sieht — der Link kommt aus einer Mail, ein 'OK' im Body reicht nicht.
  app.get<{ Querystring: { t?: string } }>(
    "/broadcasts/unsubscribe",
    async (req, reply) => {
      const token = req.query.t;
      if (!token || typeof token !== "string") {
        return reply
          .type("text/html")
          .send(simpleHtml("Ungültiger Link", "Dieser Abmelde-Link ist ungültig."));
      }
      const user = await prisma.user.findUnique({
        where: { broadcastOptOutToken: token },
        select: { id: true, email: true, broadcastOptOut: true },
      });
      if (!user) {
        return reply
          .type("text/html")
          .send(simpleHtml("Ungültiger Link", "Dieser Abmelde-Link ist ungültig oder bereits abgelaufen."));
      }
      if (!user.broadcastOptOut) {
        await prisma.user.update({
          where: { id: user.id },
          data: { broadcastOptOut: true },
        });
      }
      return reply.type("text/html").send(
        simpleHtml(
          "Abgemeldet",
          `Du bekommst keine Newsletter und Produkt-Updates mehr von Lumio. System-Mails (Galerie-Einladungen, Passwort-Reset, Sicherheits-Hinweise) erhältst du weiterhin.`
        )
      );
    }
  );

  // -------------------------------------------------------------------------
  // GET /super/broadcasts
  // -------------------------------------------------------------------------
  app.get("/super/broadcasts", async (req) => {
    req.requireSuperAdmin();
    const rows = await prisma.broadcast.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        subject: true,
        audience: true,
        status: true,
        totalRecipients: true,
        sentCount: true,
        failedCount: true,
        optedOutSkippedCount: true,
        startedAt: true,
        finishedAt: true,
        createdAt: true,
        createdByEmail: true,
      },
    });
    return { broadcasts: rows, audienceLabels: AUDIENCE_LABELS };
  });

  // -------------------------------------------------------------------------
  // GET /super/broadcasts/:id
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    "/super/broadcasts/:id",
    async (req, reply) => {
      req.requireSuperAdmin();
      const row = await prisma.broadcast.findUnique({
        where: { id: req.params.id },
      });
      if (!row) return reply.status(404).send({ error: "not_found" });
      return { broadcast: row };
    }
  );

  // -------------------------------------------------------------------------
  // POST /super/broadcasts
  // -------------------------------------------------------------------------
  // Erstellt einen Broadcast und feuert den Versand sofort als
  // setImmediate-Background. Response kehrt schnell zurueck — Status
  // ueber GET /super/broadcasts/:id pollen.
  app.post("/super/broadcasts", async (req, reply) => {
    const sa = req.requireSuperAdmin();
    const body = createSchema.parse(req.body);

    // Dry-Run: nur Empfaenger zaehlen, fuers Audit-Log + Initial-Display
    const recipients = await listAudienceUsers(body.audience as Audience);

    // HTML wird beim Anlegen einmal gerendert und gespeichert (damit
    // selbst wenn das Layout-Template spaeter sich aendert, der Originaltext
    // rekonstruiert werden kann). Wir wissen aber den Opt-Out-Token noch
    // nicht — der ist per-Recipient. Hier nehmen wir einen Platzhalter,
    // der waehrend des Versands pro Empfaenger ersetzt wird. Aber: das
    // gespeicherte HTML ist nur 'archivisch'. Der echte Versand-HTML
    // wird in processBroadcast() pro Empfaenger frisch gerendert.
    const archivalHtml = renderBroadcastHtml(
      body.bodyMarkdown,
      "{{UNSUBSCRIBE_URL}}"
    );

    const row = await prisma.broadcast.create({
      data: {
        subject: body.subject,
        bodyMarkdown: body.bodyMarkdown,
        bodyHtml: archivalHtml,
        audience: body.audience,
        totalRecipients: recipients.length,
        status: "pending",
        createdById: sa.admin.id,
        createdByEmail: sa.admin.email,
      },
    });

    await logEvent({
      tenantId: null,
      actorType: "super_admin",
      actorId: sa.admin.id,
      action: "super.broadcast.create",
      targetType: "broadcast",
      targetId: row.id,
      payload: {
        audience: body.audience,
        recipientCount: recipients.length,
        subject: body.subject,
      },
      ipAddress: req.ip,
    });

    // Versand fire-and-forget. Wenn der Server jetzt crash, bleibt der
    // Broadcast in 'pending' und der naechste Sweeper-Run kann ihn
    // resumen (siehe sweeper.ts).
    setImmediate(() => {
      processBroadcast(row.id).catch((err) => {
        req.log.warn({ err, broadcastId: row.id }, "broadcast worker crashed");
      });
    });

    return reply.status(201).send({ broadcast: row });
  });

  // -------------------------------------------------------------------------
  // POST /super/broadcasts/preview
  // -------------------------------------------------------------------------
  // Render-Only fuer Live-Preview im Editor. Kein DB-Touch.
  const previewSchema = z.object({
    bodyMarkdown: z.string().min(1).max(20000),
  });
  app.post("/super/broadcasts/preview", async (req) => {
    req.requireSuperAdmin();
    const body = previewSchema.parse(req.body);
    const exampleUnsubUrl = `${config.PUBLIC_URL.replace(/\/+$/, "")}/broadcasts/unsubscribe?t=example`;
    return { html: renderBroadcastHtml(body.bodyMarkdown, exampleUnsubUrl) };
  });

  // -------------------------------------------------------------------------
  // POST /super/broadcasts/test-send
  // -------------------------------------------------------------------------
  // Schickt eine einzelne Test-Mail an die eigene Super-Admin-Email.
  // Kein Broadcast-Record, kein Opt-Out-Token, nur die fertige Mail.
  const testSendSchema = z.object({
    subject: z.string().min(1).max(200),
    bodyMarkdown: z.string().min(1).max(20000),
  });
  app.post("/super/broadcasts/test-send", async (req) => {
    const sa = req.requireSuperAdmin();
    const body = testSendSchema.parse(req.body);

    const dummyUnsub = `${config.PUBLIC_URL.replace(/\/+$/, "")}/broadcasts/unsubscribe?t=test-only-no-effect`;
    const html = renderBroadcastHtml(body.bodyMarkdown, dummyUnsub);

    await sendMail({
      to: sa.admin.email,
      subject: `[TEST] ${body.subject}`,
      text: body.bodyMarkdown + `\n\n(TEST — Unsubscribe-Link in der Test-Mail tut nichts.)`,
      html,
    });

    await logEvent({
      tenantId: null,
      actorType: "super_admin",
      actorId: sa.admin.id,
      action: "super.broadcast.test_send",
      payload: { subject: body.subject },
      ipAddress: req.ip,
    });

    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // DELETE /super/broadcasts/:id
  // -------------------------------------------------------------------------
  // Nur erlaubt bei status='pending' oder 'failed'. Versendete Broad-
  // casts bleiben fuer Audit erhalten.
  app.delete<{ Params: { id: string } }>(
    "/super/broadcasts/:id",
    async (req, reply) => {
      const sa = req.requireSuperAdmin();
      const row = await prisma.broadcast.findUnique({
        where: { id: req.params.id },
        select: { id: true, status: true },
      });
      if (!row) return reply.status(404).send({ error: "not_found" });
      if (row.status === "sending" || row.status === "finished") {
        return reply.status(409).send({
          error: "cannot_delete",
          message:
            "Broadcasts im Versand oder bereits versendet können nicht gelöscht werden (Audit-Spur).",
        });
      }
      await prisma.broadcast.delete({ where: { id: row.id } });
      await logEvent({
        tenantId: null,
        actorType: "super_admin",
        actorId: sa.admin.id,
        action: "super.broadcast.delete",
        targetType: "broadcast",
        targetId: row.id,
        payload: { previousStatus: row.status },
        ipAddress: req.ip,
      });
      return { ok: true };
    }
  );
}

function simpleHtml(title: string, body: string): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — Lumio</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif; background:#f6f7f9; color:#1f2937; margin:0; padding:32px 16px; }
  .card { max-width:480px; margin:48px auto; background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:32px; }
  h1 { color:#d97706; margin:0 0 16px; font-size:24px; }
  p { margin:0 0 16px; line-height:1.6; }
  a { color:#d97706; }
</style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(body)}</p>
    <p><a href="https://lumio-cloud.de">Zurück zu Lumio</a></p>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
