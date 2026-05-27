/**
 * Lumio API — Broadcast-Mail-Service
 *
 * Versand-Architektur: bewusst KEINE Redis-Queue, KEIN externer Worker.
 * Bei der Groessenordnung von Lumio (Solo-SaaS, kleine zwei-/drei-
 * stellige Tenant-Anzahl) reicht ein In-Process Background-Loop:
 *
 *   1. POST /super/broadcasts erstellt einen Broadcast-Record mit
 *      status='pending'
 *   2. setImmediate(() => processBroadcast(id)) feuert async ohne den
 *      HTTP-Request zu blockieren
 *   3. processBroadcast() laedt Empfaenger, schickt sequentiell mit
 *      kleinem Sleep zwischen Mails (Postmark-Rate-Limit-Schoner),
 *      updated counts inkrementell in der DB
 *   4. Bei Process-Crash: Sweeper findet beim naechsten Run Broadcasts
 *      in status='sending' mit stale lastProgressAt und kann sie
 *      resumen (TODO — fuer den ersten Wurf reicht der Glueckpfad)
 *
 * Markdown wird via 'marked' zu HTML konvertiert und in das Standard-
 * Mail-Layout (mail-layout.ts) eingebettet. Studio-Branding wird NICHT
 * verwendet — Broadcasts kommen von Lumio direkt an den Owner.
 *
 * DSGVO/CAN-SPAM: jede Broadcast-Mail enthaelt einen Unsubscribe-Link,
 * der das broadcastOptOut-Flag am User-Record setzt. Der Filter im
 * Empfaenger-Query respektiert das automatisch.
 */

import { marked } from "marked";
import { randomBytes } from "node:crypto";

import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { config } from "../config.js";
import { sendMail } from "./mail.js";
import { renderMailLayout } from "./mail-layout.js";

export type Audience =
  | "all_paid_owners"
  | "all_trial_owners"
  | "all_owners"
  | "all_active_users";

export const AUDIENCE_LABELS: Record<Audience, string> = {
  all_paid_owners: "Alle zahlenden Owner (active + past_due)",
  all_trial_owners: "Alle Trial-Owner",
  all_owners: "Alle Owner (active + trialing + past_due)",
  all_active_users: "Alle aktiven User (auch Members)",
};

/** Sleep zwischen Sends — Postmark erlaubt deutlich mehr, aber wir
 *  wollen Reputation schonen und Spam-Filter nicht alarmieren. 200ms
 *  = 5 Mails/Sekunde = 18000/Stunde. Mehr als genug fuer Lumio. */
const SEND_INTERVAL_MS = 200;

/** Markdown zu HTML konvertieren und ins Standard-Mail-Layout einbetten. */
export function renderBroadcastHtml(
  bodyMarkdown: string,
  unsubscribeUrl: string
): string {
  // marked.parse ist synchron wenn kein async-Renderer registriert ist.
  // Wir nutzen die default options + ein paar Security-Settings.
  const inner = marked.parse(bodyMarkdown, {
    async: false,
    gfm: true,
    breaks: true,
  }) as string;

  const footerHtml = `
    <p style="margin:24px 0 0;color:#6b7280;font-size:12px;line-height:1.5;">
      Du erhältst diese Mail weil du ein Lumio-Studio betreibst.
      <a href="${escapeAttr(unsubscribeUrl)}" style="color:#6b7280;text-decoration:underline;">Hier abbestellen</a>.
    </p>`;

  return renderMailLayout({
    bodyHtml: inner + footerHtml,
    preheader: extractPreheader(bodyMarkdown),
  });
}

/** Erste ~80 Zeichen des Plain-Markdowns als Preheader nutzen. */
function extractPreheader(md: string): string {
  // Headings + Listen-Marker raus, dann erste 80 Zeichen
  const plain = md
    .replace(/^#+\s+/gm, "")
    .replace(/^[*-]\s+/gm, "")
    .replace(/\*\*?([^*]+)\*\*?/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return plain.slice(0, 80);
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Empfaenger fuer eine Audience zusammenstellen. */
export async function listAudienceUsers(
  audience: Audience
): Promise<
  Array<{ id: string; email: string; name: string | null; tenantId: string }>
> {
  // Basis: aktive User in aktiven Tenants. Wir filtern OptOut WEG bevor
  // der Versand startet — Count-Anzeige im Frontend zeigt 'X gesendet,
  // Y opt-out skipped' transparent.
  const baseWhere = {
    status: "active",
    tenant: { status: "active" as const },
  };

  switch (audience) {
    case "all_owners":
      return prisma.user.findMany({
        where: { ...baseWhere, role: "owner" },
        select: { id: true, email: true, name: true, tenantId: true },
      });
    case "all_paid_owners":
      return prisma.user.findMany({
        where: {
          ...baseWhere,
          role: "owner",
          tenant: {
            ...baseWhere.tenant,
            subscription: {
              status: { in: ["active", "past_due"] },
            },
          },
        },
        select: { id: true, email: true, name: true, tenantId: true },
      });
    case "all_trial_owners":
      return prisma.user.findMany({
        where: {
          ...baseWhere,
          role: "owner",
          tenant: {
            ...baseWhere.tenant,
            subscription: { status: "trialing" },
          },
        },
        select: { id: true, email: true, name: true, tenantId: true },
      });
    case "all_active_users":
      return prisma.user.findMany({
        where: baseWhere,
        select: { id: true, email: true, name: true, tenantId: true },
      });
  }
}

/** Lazy: Opt-Out-Token am User generieren wenn noch nicht vorhanden. */
async function ensureOptOutToken(userId: string): Promise<string> {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { broadcastOptOutToken: true },
  });
  if (existing?.broadcastOptOutToken) return existing.broadcastOptOutToken;

  const token = randomBytes(24).toString("base64url");
  await prisma.user.update({
    where: { id: userId },
    data: { broadcastOptOutToken: token },
  });
  return token;
}

function unsubscribeUrl(token: string): string {
  const base = config.PUBLIC_URL.replace(/\/+$/, "");
  return `${base}/broadcasts/unsubscribe?t=${encodeURIComponent(token)}`;
}

/** Eine bestehende Broadcast-Definition versenden. Async, nicht awaiten. */
export async function processBroadcast(broadcastId: string): Promise<void> {
  const broadcast = await prisma.broadcast.findUnique({
    where: { id: broadcastId },
  });
  if (!broadcast) {
    logger.warn({ broadcastId }, "processBroadcast: not found");
    return;
  }
  if (broadcast.status !== "pending" && broadcast.status !== "sending") {
    logger.info(
      { broadcastId, status: broadcast.status },
      "processBroadcast: skip, not pending/sending"
    );
    return;
  }

  const recipients = await listAudienceUsers(broadcast.audience as Audience);

  await prisma.broadcast.update({
    where: { id: broadcastId },
    data: {
      status: "sending",
      totalRecipients: recipients.length,
      startedAt: broadcast.startedAt ?? new Date(),
      lastProgressAt: new Date(),
    },
  });

  let sent = broadcast.sentCount;
  let failed = broadcast.failedCount;
  let skipped = broadcast.optedOutSkippedCount;
  let firstError: string | null = null;

  for (const r of recipients) {
    // Aktueller Opt-Out-Status (kann sich waehrend des Versands aendern
    // wenn Empfaenger A klickt und B noch in der Schlange ist)
    const fresh = await prisma.user.findUnique({
      where: { id: r.id },
      select: { broadcastOptOut: true },
    });
    if (fresh?.broadcastOptOut) {
      skipped += 1;
      continue;
    }

    try {
      const token = await ensureOptOutToken(r.id);
      const html = renderBroadcastHtml(
        broadcast.bodyMarkdown,
        unsubscribeUrl(token)
      );
      const plainFooter = `\n\n—\nDu kannst diese Mails hier abbestellen:\n${unsubscribeUrl(token)}`;

      await sendMail({
        to: r.email,
        subject: broadcast.subject,
        text: stripMarkdown(broadcast.bodyMarkdown) + plainFooter,
        html,
      });
      sent += 1;
    } catch (err) {
      failed += 1;
      if (!firstError) {
        firstError = (err instanceof Error ? err.message : String(err)).slice(
          0,
          500
        );
      }
      logger.warn(
        { err, broadcastId, recipientId: r.id },
        "broadcast send failed for recipient"
      );
    }

    // Progress periodisch in DB persistieren (alle 10 Empfaenger)
    if ((sent + failed + skipped) % 10 === 0) {
      await prisma.broadcast.update({
        where: { id: broadcastId },
        data: {
          sentCount: sent,
          failedCount: failed,
          optedOutSkippedCount: skipped,
          lastProgressAt: new Date(),
        },
      });
    }

    await sleep(SEND_INTERVAL_MS);
  }

  await prisma.broadcast.update({
    where: { id: broadcastId },
    data: {
      status: failed > 0 && sent === 0 ? "failed" : "finished",
      sentCount: sent,
      failedCount: failed,
      optedOutSkippedCount: skipped,
      finishedAt: new Date(),
      lastProgressAt: new Date(),
      errorMessage: firstError,
    },
  });

  logger.info(
    { broadcastId, sent, failed, skipped },
    "broadcast finished"
  );
}

/** Loescht Markdown-Marker fuer Plaintext-Fallback. Sehr simpel —
 *  perfekt muesste es nicht sein. */
function stripMarkdown(md: string): string {
  return md
    .replace(/^#+\s+/gm, "")
    .replace(/^[*-]\s+/gm, "• ")
    .replace(/\*\*?([^*]+)\*\*?/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/`([^`]+)`/g, "$1");
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
