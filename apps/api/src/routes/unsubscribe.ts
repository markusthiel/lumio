/**
 * Lumio API — Öffentliche Marketing-Opt-out-Route
 *
 *   GET /billing/unsubscribe-marketing?token=<signed-token>
 *
 * Kein Login nötig. Token ist HMAC-signiert und 90 Tage gültig.
 * Bei erfolgreichem Opt-out: einfache HTML-Bestätigungsseite.
 */
import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { verifyUnsubscribeToken } from "../services/marketing-token.js";

export async function registerUnsubscribeRoute(app: FastifyInstance) {
  app.get("/billing/unsubscribe-marketing", async (req, reply) => {
    const token =
      typeof (req.query as Record<string, unknown>).token === "string"
        ? (req.query as Record<string, string>).token
        : null;

    if (!token) {
      return reply
        .status(400)
        .type("text/html; charset=utf-8")
        .send(unsubscribePage("error", "Ungültiger Link."));
    }

    const tenantId = verifyUnsubscribeToken(token);
    if (!tenantId) {
      return reply
        .status(400)
        .type("text/html; charset=utf-8")
        .send(unsubscribePage("error", "Dieser Link ist ungültig oder abgelaufen. Du kannst dich im Studio unter Einstellungen → Benachrichtigungen abmelden."));
    }

    // Opt-out speichern (updateMany: kein Fehler wenn Sub nicht existiert)
    await prisma.billingSubscription.updateMany({
      where: { tenantId },
      data: { marketingEmailsEnabled: false },
    });

    return reply
      .status(200)
      .type("text/html; charset=utf-8")
      .send(
        unsubscribePage(
          "success",
          "Du wirst keine weiteren Marketing-Mails von Lumio erhalten."
        )
      );
  });
}

function unsubscribePage(
  state: "success" | "error",
  message: string
): string {
  const color = state === "success" ? "#059669" : "#dc2626";
  const title = state === "success" ? "Abgemeldet" : "Fehler";
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} — Lumio</title>
  <style>
    body{font-family:system-ui,sans-serif;background:#f9fafb;margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;}
    .card{background:#fff;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.08);padding:40px 32px;max-width:420px;width:100%;text-align:center;}
    .icon{font-size:40px;margin-bottom:12px;}
    h1{font-size:20px;font-weight:600;color:#111827;margin:0 0 8px;}
    p{color:#6b7280;font-size:15px;margin:0 0 24px;}
    a{color:${color};font-size:14px;text-decoration:none;}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${state === "success" ? "✓" : "✕"}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="/">Zurück zu Lumio</a>
  </div>
</body>
</html>`;
}
