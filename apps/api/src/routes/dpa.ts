/**
 * Lumio API — AVV-Routes (Auftragsverarbeitungsvertrag, Art. 28 DSGVO)
 *
 *   GET   /dpa/status    — Stammdaten-Vollständigkeit, aktuelle Version,
 *                          letzter Abschluss, ob aktuell
 *   PATCH /dpa/company   — Stammdaten des Verantwortlichen speichern
 *   POST  /dpa/accept    — Vertrag elektronisch abschließen (dokumentiert)
 *   GET   /dpa/document  — vollständiger AVV als HTML (zum Ansehen/Drucken)
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import {
  DPA_VERSION,
  dpaCompanyComplete,
  renderDpaHtml,
} from "../services/dpa.js";

// Felder, die für AVV-Stammdaten + Rendering gebraucht werden.
const companySelect = {
  legalName: true,
  legalStreet: true,
  legalPostalCode: true,
  legalCity: true,
  legalCountry: true,
  vatId: true,
} as const;

const companySchema = z.object({
  legalName: z.string().max(200).nullable().optional(),
  legalStreet: z.string().max(200).nullable().optional(),
  legalPostalCode: z.string().max(20).nullable().optional(),
  legalCity: z.string().max(120).nullable().optional(),
  legalCountry: z.string().max(120).nullable().optional(),
  vatId: z.string().max(50).nullable().optional(),
});

function normalize(body: z.infer<typeof companySchema>) {
  const data: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue;
    const t = typeof v === "string" ? v.trim() : v;
    data[k] = t ? t : null;
  }
  return data;
}

export async function registerDpaRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------------------
  // GET /dpa/status
  // ---------------------------------------------------------------------------
  app.get("/dpa/status", async (req, reply) => {
    req.requireAuth();
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      select: companySelect,
    });
    if (!tenant) return reply.status(404).send({ error: "not_found" });

    const latest = await prisma.dpaAcceptance.findFirst({
      where: { tenantId: req.tenantId },
      orderBy: { acceptedAt: "desc" },
      select: { version: true, acceptedAt: true, acceptedByName: true },
    });

    return {
      company: tenant,
      companyComplete: dpaCompanyComplete(tenant),
      currentVersion: DPA_VERSION,
      acceptance: latest ?? null,
      // True nur, wenn die zuletzt abgeschlossene Version der aktuellen
      // Template-Version entspricht. Sonst ist eine Re-Bestätigung fällig.
      upToDate: latest?.version === DPA_VERSION,
    };
  });

  // ---------------------------------------------------------------------------
  // PATCH /dpa/company — Stammdaten speichern (owner/admin)
  // ---------------------------------------------------------------------------
  app.patch("/dpa/company", async (req, reply) => {
    const s = req.requireAuth();
    if (s.user.role !== "owner" && s.user.role !== "admin") {
      return reply.status(403).send({ error: "forbidden" });
    }
    const parsed = companySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const tenant = await prisma.tenant.update({
      where: { id: req.tenantId },
      data: normalize(parsed.data),
      select: companySelect,
    });
    return { company: tenant, companyComplete: dpaCompanyComplete(tenant) };
  });

  // ---------------------------------------------------------------------------
  // POST /dpa/accept — elektronischer Abschluss (owner/admin)
  // ---------------------------------------------------------------------------
  app.post("/dpa/accept", async (req, reply) => {
    const s = req.requireAuth();
    if (s.user.role !== "owner" && s.user.role !== "admin") {
      return reply.status(403).send({ error: "forbidden" });
    }
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      select: companySelect,
    });
    if (!tenant) return reply.status(404).send({ error: "not_found" });
    if (!dpaCompanyComplete(tenant)) {
      // Ohne vollständige Stammdaten kein gültiger AVV.
      return reply.status(400).send({ error: "company_incomplete" });
    }

    const created = await prisma.dpaAcceptance.create({
      data: {
        tenantId: req.tenantId as string,
        version: DPA_VERSION,
        acceptedByUserId: s.user.id,
        acceptedByName: s.user.name ?? s.user.email,
        ipAddress: req.ip,
      },
      select: { version: true, acceptedAt: true, acceptedByName: true },
    });

    return { acceptance: created, upToDate: true };
  });

  // ---------------------------------------------------------------------------
  // GET /dpa/document — AVV als HTML (Ansehen + Browser-Druck → PDF)
  // ---------------------------------------------------------------------------
  app.get("/dpa/document", async (req, reply) => {
    req.requireAuth();
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      select: companySelect,
    });
    if (!tenant) return reply.status(404).send({ error: "not_found" });

    const latest = await prisma.dpaAcceptance.findFirst({
      where: { tenantId: req.tenantId },
      orderBy: { acceptedAt: "desc" },
      select: { version: true, acceptedAt: true, acceptedByName: true },
    });

    const html = renderDpaHtml(tenant, latest ?? null);
    reply.header("Content-Type", "text/html; charset=utf-8");
    return reply.send(html);
  });
}
