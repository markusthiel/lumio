/**
 * Lumio API — Auto-Tag-Routes (Feature-Flag 'ai_tagging')
 *
 * Pro File: Vorschlaege lesen, accept/reject.
 *
 * GET    /files/:id/auto-tags
 *          Liste aller Vorschlaege (status: suggested|accepted|rejected),
 *          Studio entscheidet pro Tag was er macht.
 *
 * POST   /files/:id/auto-tags/:tagId/accept
 *          Vorschlag annehmen. Erstellt einen FileTag (+ Tag-Row falls
 *          noch nicht existent). Auto-Tag-Row bleibt mit status='accepted'
 *          — damit Re-Tag den Tag nicht doppelt vorschlaegt.
 *
 * POST   /files/:id/auto-tags/:tagId/reject
 *          Status='rejected'. Re-Tag wird den Tag fuer dieses File nicht
 *          mehr vorschlagen.
 *
 * Alle gegated durch isFeatureEnabled(tenantId, 'ai_tagging'); wenn aus
 * → 404 (Feature komplett unsichtbar).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

import { prisma } from "../db.js";
import { isFeatureEnabled } from "../services/feature-flags.js";
import { logEvent } from "../services/audit.js";

// Tag-Vokabular — feste Labels die der Worker-Code kennt. UI uebersetzt
// daraus die Anzeige (kein freier Tag-String).
export const AUTO_TAG_VOCABULARY: Record<string, { label: string; group: string; color: string }> = {
  portrait:         { label: "Hochformat",      group: "format",     color: "#6366f1" },
  landscape:        { label: "Querformat",      group: "format",     color: "#6366f1" },
  square:           { label: "Quadrat",         group: "format",     color: "#6366f1" },
  bright:           { label: "Hell",            group: "lichtstimmung", color: "#f59e0b" },
  dark:             { label: "Dunkel",          group: "lichtstimmung", color: "#1e40af" },
  golden_hour:      { label: "Goldene Stunde",  group: "lichtstimmung", color: "#f97316" },
  vivid:            { label: "Farbenfroh",      group: "saettigung", color: "#ef4444" },
  muted:            { label: "Gedämpft",        group: "saettigung", color: "#94a3b8" },
  black_and_white:  { label: "Schwarzweiß",     group: "saettigung", color: "#374151" },
  indoor:           { label: "Innen",           group: "setting",    color: "#a78bfa" },
  outdoor:          { label: "Draußen",         group: "setting",    color: "#10b981" },
  morning:          { label: "Vormittag",       group: "tageszeit",  color: "#fbbf24" },
  afternoon:        { label: "Nachmittag",      group: "tageszeit",  color: "#f59e0b" },
  evening:          { label: "Abend",           group: "tageszeit",  color: "#dc2626" },
  night:            { label: "Nacht",           group: "tageszeit",  color: "#1e293b" },
};

export async function registerAutoTagRoutes(app: FastifyInstance) {
  async function requireFeature(
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<boolean> {
    req.requireAuth();
    const enabled = await isFeatureEnabled(req.tenantId!, "ai_tagging");
    if (!enabled) {
      reply.status(404).send({ error: "not_found" });
      return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // GET /files/:id/auto-tags
  // ---------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    "/files/:id/auto-tags",
    async (req, reply) => {
      if (!(await requireFeature(req, reply))) return;
      const s = req.requireAuth();

      // Ownership check: File muss zu einer Galerie gehoeren die dem
      // Tenant + User zugeordnet ist
      const file = await prisma.file.findFirst({
        where: {
          id: req.params.id,
          gallery: { tenantId: req.tenantId, ownerId: s.user.id },
        },
        select: { id: true },
      });
      if (!file) return reply.status(404).send({ error: "not_found" });

      const autoTags = await prisma.fileAutoTag.findMany({
        where: { fileId: file.id },
        orderBy: [{ status: "asc" }, { confidence: "desc" }],
      });
      return {
        autoTags: autoTags.map((t) => ({
          id: t.id,
          tagName: t.tagName,
          confidence: t.confidence,
          source: t.source,
          status: t.status,
          reviewedAt: t.reviewedAt ? t.reviewedAt.toISOString() : null,
          // UI-Hilfsinfos aus dem Vokabular
          label: AUTO_TAG_VOCABULARY[t.tagName]?.label ?? t.tagName,
          group: AUTO_TAG_VOCABULARY[t.tagName]?.group ?? null,
          color: AUTO_TAG_VOCABULARY[t.tagName]?.color ?? "#94a3b8",
        })),
      };
    }
  );

  // ---------------------------------------------------------------------------
  // POST /files/:id/auto-tags/:autoTagId/accept
  // ---------------------------------------------------------------------------
  // Vorschlag annehmen → Tag-Row + FileTag anlegen (oder upserten).
  // Tag-Name wird Pre-Translated zum UI-Label (z.B. 'Schwarzweiß' statt
  // 'black_and_white') damit die UI keine Sonder-Behandlung braucht.
  app.post<{ Params: { id: string; autoTagId: string } }>(
    "/files/:id/auto-tags/:autoTagId/accept",
    async (req, reply) => {
      if (!(await requireFeature(req, reply))) return;
      const s = req.requireAuth();

      const autoTag = await prisma.fileAutoTag.findFirst({
        where: {
          id: req.params.autoTagId,
          fileId: req.params.id,
          file: { gallery: { tenantId: req.tenantId, ownerId: s.user.id } },
        },
      });
      if (!autoTag) return reply.status(404).send({ error: "not_found" });
      if (autoTag.status === "accepted") {
        return { ok: true, alreadyAccepted: true };
      }

      const vocab = AUTO_TAG_VOCABULARY[autoTag.tagName];
      const displayName = vocab?.label ?? autoTag.tagName;
      const color = vocab?.color ?? "#94a3b8";

      // Tag-Row: finden oder anlegen. Kein unique-Constraint auf
      // (tenantId, name) im Schema, daher findFirst + create statt upsert.
      let tag = await prisma.tag.findFirst({
        where: { tenantId: req.tenantId!, name: displayName },
        select: { id: true, name: true },
      });
      if (!tag) {
        tag = await prisma.tag.create({
          data: {
            tenantId: req.tenantId!,
            name: displayName,
            color,
          },
          select: { id: true, name: true },
        });
      }

      // FileTag: compound-key (fileId, tagId). Wir versuchen create und
      // ignorieren P2002-unique-violation (Tag schon dran).
      try {
        await prisma.fileTag.create({
          data: { fileId: req.params.id, tagId: tag.id },
        });
      } catch (err) {
        // P2002 ist Unique-Violation; alles andere durchreichen
        if (
          !(err && typeof err === "object" && "code" in err && err.code === "P2002")
        ) {
          throw err;
        }
      }

      // AutoTag auf 'accepted' setzen
      await prisma.fileAutoTag.update({
        where: { id: autoTag.id },
        data: {
          status: "accepted",
          reviewedBy: s.user.id,
          reviewedAt: new Date(),
        },
      });

      await logEvent({
        tenantId: req.tenantId!,
        actorType: "user",
        actorId: s.user.id,
        action: "auto_tag.accepted",
        targetType: "file_auto_tag",
        targetId: autoTag.id,
        payload: { tagName: autoTag.tagName, fileId: req.params.id },
        ipAddress: req.ip,
      });

      return { ok: true, tag: { id: tag.id, name: tag.name } };
    }
  );

  // ---------------------------------------------------------------------------
  // POST /files/:id/auto-tags/:autoTagId/reject
  // ---------------------------------------------------------------------------
  app.post<{ Params: { id: string; autoTagId: string } }>(
    "/files/:id/auto-tags/:autoTagId/reject",
    async (req, reply) => {
      if (!(await requireFeature(req, reply))) return;
      const s = req.requireAuth();

      const autoTag = await prisma.fileAutoTag.findFirst({
        where: {
          id: req.params.autoTagId,
          fileId: req.params.id,
          file: { gallery: { tenantId: req.tenantId, ownerId: s.user.id } },
        },
      });
      if (!autoTag) return reply.status(404).send({ error: "not_found" });

      await prisma.fileAutoTag.update({
        where: { id: autoTag.id },
        data: {
          status: "rejected",
          reviewedBy: s.user.id,
          reviewedAt: new Date(),
        },
      });

      await logEvent({
        tenantId: req.tenantId!,
        actorType: "user",
        actorId: s.user.id,
        action: "auto_tag.rejected",
        targetType: "file_auto_tag",
        targetId: autoTag.id,
        payload: { tagName: autoTag.tagName, fileId: req.params.id },
        ipAddress: req.ip,
      });

      return { ok: true };
    }
  );
}
