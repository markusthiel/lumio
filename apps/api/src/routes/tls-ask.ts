/**
 * Lumio API — On-Demand-TLS-Freigabe für Custom-Domains
 *
 * Caddy fragt diesen Endpoint, bevor er für einen unbekannten Hostnamen ein
 * Zertifikat holt (on_demand_tls/ask im Caddyfile, aktiv nur mit
 * LUMIO_CUSTOM_DOMAIN_TLS_HOST). Antwort 200 = Domain gehört einem Studio,
 * Cert holen. Alles andere = ablehnen.
 *
 * Der Endpoint liegt bewusst AUSSERHALB von /api/*: Caddy proxiert nach
 * außen nur /api/*, /health und /ws/* an die API, /internal/* ist also nur
 * im Docker-Netz erreichbar. Zusätzlich lehnen wir Requests ab, die über
 * einen Proxy kamen (X-Forwarded-For) — Caddys ask-Aufruf ist direkt.
 */
import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";

const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Normalisiert den von Caddy übergebenen Hostnamen. null = ungültig. */
export function normalizeAskDomain(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const d = raw.trim().toLowerCase().replace(/\.$/, "");
  if (d.length === 0 || d.length > 253) return null;
  if (!HOST_RE.test(d)) return null;
  return d;
}

export async function registerTlsAskRoute(app: FastifyInstance) {
  app.get(
    "/internal/tls-ask",
    // Kein Rate-Limit: Aufrufer ist ausschließlich Caddy (eine IP). Ein
    // 429 würde bei einem Scan fremder Hostnamen sonst auch legitime
    // Kunden-Domains blockieren. Die Abfrage ist ein einzelner Lookup.
    { config: { rateLimit: false } },
    async (req, reply) => {
      if (req.headers["x-forwarded-for"]) {
        return reply.status(404).send();
      }
      const domain = normalizeAskDomain((req.query as Record<string, unknown>)?.domain);
      if (!domain) return reply.status(400).send();

      const tenant = await prisma.tenant.findFirst({
        where: {
          customDomain: { equals: domain, mode: "insensitive" },
          // Gleiche Status wie die Tenant-Auflösung (plugins/auth.ts):
          // nur Studios, die auch tatsächlich ausgeliefert werden.
          status: { in: ["active", "pending_deletion"] },
        },
        select: { id: true },
      });

      if (!tenant) {
        req.log.info({ domain }, "tls-ask: Domain unbekannt, kein Zertifikat");
        return reply.status(404).send();
      }
      req.log.info({ domain }, "tls-ask: Domain freigegeben");
      return reply.status(200).send();
    },
  );
}
