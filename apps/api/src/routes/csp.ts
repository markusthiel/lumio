/**
 * Lumio API — CSP-Report-Sink
 *
 * Sammelt Content-Security-Policy-Verstoesse, die der Browser via
 * `report-uri` an `/api/v1/csp-report` schickt (Report-Only-Modus, siehe
 * infra/caddy/Caddyfile). Aggregiert nach (effectiveDirective, blockedUri),
 * damit die Zeilenzahl beschraenkt bleibt und man genau sieht, was die
 * Policy noch braucht, bevor sie auf `enforced` umgestellt wird.
 *
 * - POST /csp-report   — oeffentlich (Browser postet das hierher)
 * - GET  /super/csp    — Super-Admin: Verstoesse nach Haeufigkeit
 * - DELETE /super/csp  — Super-Admin: alles leeren (z.B. nach Policy-Fix)
 */
import type { FastifyInstance } from "fastify";

import { prisma } from "../db.js";
import { logger } from "../logger.js";

// CSP-Schluesselwoerter, die keine echte URL sind — unveraendert lassen.
const KEYWORDS = new Set([
  "inline",
  "eval",
  "self",
  "unsafe-inline",
  "unsafe-eval",
  "wasm-eval",
  "wasm-unsafe-eval",
]);

/**
 * Normalisiert die blockierte URL auf etwas Aggregierbares:
 * Keywords bleiben, data:/blob: werden auf das Schema reduziert, echte URLs
 * auf ihren Origin (scheme://host) — Pfad/Query fallen weg, sonst explodiert
 * die Kardinalitaet.
 */
function normalizeBlockedUri(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "(empty)";
  const lower = trimmed.toLowerCase();
  if (KEYWORDS.has(lower)) return lower;
  if (lower.startsWith("data:")) return "data:";
  if (lower.startsWith("blob:")) return "blob:";
  try {
    const u = new URL(trimmed);
    return `${u.protocol}//${u.host}`;
  } catch {
    return trimmed.slice(0, 255);
  }
}

interface CspReportBody {
  "csp-report"?: Record<string, unknown>;
}

export async function registerCspRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // POST /csp-report — oeffentlicher Ingest (kein Auth)
  // -------------------------------------------------------------------------
  app.post("/csp-report", async (req, reply) => {
    const body = req.body as CspReportBody | undefined;
    const report = body?.["csp-report"];
    // Bei Murks einfach 204 — der Browser erwartet keine sinnvolle Antwort.
    if (!report || typeof report !== "object") {
      return reply.status(204).send();
    }

    const directiveRaw =
      (report["effective-directive"] as string | undefined) ||
      (report["violated-directive"] as string | undefined) ||
      "unknown";
    const blockedRaw = (report["blocked-uri"] as string | undefined) || "";
    const docRaw = (report["document-uri"] as string | undefined) || null;

    const effectiveDirective = String(directiveRaw).slice(0, 100);
    const blockedUri = normalizeBlockedUri(String(blockedRaw)).slice(0, 255);
    const sampleDocumentUri = docRaw ? String(docRaw).slice(0, 500) : null;

    try {
      await prisma.cspViolation.upsert({
        where: {
          effectiveDirective_blockedUri: { effectiveDirective, blockedUri },
        },
        create: {
          effectiveDirective,
          blockedUri,
          sampleDocumentUri,
          count: 1,
        },
        update: {
          count: { increment: 1 },
          lastSeenAt: new Date(),
          sampleDocumentUri,
        },
      });
    } catch (err) {
      // Defensiv: ein kaputter Report darf nie einen Fehler nach aussen
      // werfen — sonst spammt der Browser Retry-Reports.
      logger.warn({ err }, "csp-report: upsert failed");
    }

    return reply.status(204).send();
  });

  // -------------------------------------------------------------------------
  // GET /super/csp — Verstoesse nach Haeufigkeit
  // -------------------------------------------------------------------------
  app.get("/super/csp", async (req) => {
    req.requireSuperAdmin();
    const violations = await prisma.cspViolation.findMany({
      orderBy: [{ count: "desc" }, { lastSeenAt: "desc" }],
      take: 500,
    });
    const totalEvents = violations.reduce((sum, v) => sum + v.count, 0);
    return { violations, distinct: violations.length, totalEvents };
  });

  // -------------------------------------------------------------------------
  // DELETE /super/csp — alles leeren
  // -------------------------------------------------------------------------
  app.delete("/super/csp", async (req) => {
    const sa = req.requireSuperAdmin();
    const r = await prisma.cspViolation.deleteMany({});
    logger.info(
      { adminId: sa.admin.id, deleted: r.count },
      "csp-report: cleared"
    );
    return { ok: true, deleted: r.count };
  });
}
