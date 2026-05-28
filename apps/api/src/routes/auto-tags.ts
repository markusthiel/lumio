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
//
// Zwei Quellen:
//   - rule_based: kommt aus apps/worker/tasks/auto_tag.py (Heuristiken)
//   - clip:       kommt aus apps/worker/ml/clip_tagger.py (Zero-Shot)
// Beide schreiben in dieselbe file_auto_tags-Tabelle mit dem 'source'-Feld.
export const AUTO_TAG_VOCABULARY: Record<string, { label: string; group: string; color: string }> = {
  // -------- Rule-Based (immer aktiv) --------
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

  // -------- CLIP (Hochzeits-Vokabular, ai_tagging+LUMIO_CLIP_ENABLED) --------
  bride_and_groom:   { label: "Brautpaar",         group: "motiv",   color: "#ec4899" },
  couple_kiss:       { label: "Kuss",              group: "motiv",   color: "#ec4899" },
  wedding_rings:     { label: "Ringe",             group: "detail",  color: "#ca8a04" },
  bridal_bouquet:    { label: "Brautstrauß",       group: "detail",  color: "#84cc16" },
  wedding_dress:     { label: "Brautkleid",        group: "motiv",   color: "#f9a8d4" },
  first_dance:       { label: "Erster Tanz",       group: "moment",  color: "#8b5cf6" },
  group_photo:       { label: "Gruppenfoto",       group: "motiv",   color: "#0ea5e9" },
  bridesmaids:       { label: "Brautjungfern",     group: "motiv",   color: "#f472b6" },
  ceremony:          { label: "Trauung",           group: "moment",  color: "#7c3aed" },
  reception:         { label: "Empfang",           group: "moment",  color: "#06b6d4" },
  cake_cutting:      { label: "Tortenanschnitt",   group: "moment",  color: "#fb923c" },
  toast:             { label: "Anstoßen",          group: "moment",  color: "#facc15" },
  details:           { label: "Details",           group: "stil",    color: "#a3a3a3" },
  church:            { label: "Kirche",            group: "ort",     color: "#78716c" },
  outdoor_ceremony:  { label: "Trauung draußen",   group: "ort",     color: "#22c55e" },
  garden:            { label: "Garten",            group: "ort",     color: "#65a30d" },
  beach:             { label: "Strand",            group: "ort",     color: "#0891b2" },
  vineyard:          { label: "Weingut",           group: "ort",     color: "#7c2d12" },
  candid:            { label: "Candid",            group: "stil",    color: "#737373" },
  posed_portrait:    { label: "Posiert",           group: "stil",    color: "#525252" },
  laughter:          { label: "Lachen",            group: "emotion", color: "#f59e0b" },
  tears:             { label: "Tränen der Freude", group: "emotion", color: "#3b82f6" },
  dancing:           { label: "Tanzen",            group: "emotion", color: "#d946ef" },
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
  // GET /auto-tags/status
  // ---------------------------------------------------------------------------
  // Idempotenter Probe-Endpoint fuer das Frontend. Liefert 200 + status-Info
  // wenn das Feature aktiv ist, 404 sonst. So muss das Frontend nicht POST-
  // Endpoints fuer Sichtbarkeits-Probes missbrauchen (das hat bei
  // bulk-accept zu ungewollten Akzeptierungen gefuehrt, weil der min-Param
  // serverseitig auf [0..1] geclamped wird und 2.0 als 1.0 ankam — was
  // dann alle 1.0-Rule-Based-Tags traf).
  app.get("/auto-tags/status", async (req, reply) => {
    if (!(await requireFeature(req, reply))) return;
    return {
      enabled: true,
      // Spaeter erweiterbar: ob CLIP geladen ist, welches Vokabular, ...
      vocabulary: Object.keys(AUTO_TAG_VOCABULARY),
    };
  });

  // ---------------------------------------------------------------------------
  // GET /galleries/:id/auto-tags/stats
  // ---------------------------------------------------------------------------
  // Diagnose-Stats fuer die Studio-Toolbar — zeigt direkt im UI ob die
  // Pipeline laeuft. Vier Counts plus letzter Tag-Timestamp.
  //
  // Use-Case: Fotograf klickt 'Galerie neu taggen', wartet, sieht in der
  // Toolbar wie pendingSuggestions hochzaehlt → Pipeline arbeitet.
  // Wenn pendingSuggestions=0 bleibt nach Re-Tag-Klick und taggedFiles
  // nicht steigt → irgendwas haengt (Worker, Feature-Flag-Mismatch, etc.)
  app.get<{ Params: { id: string } }>(
    "/galleries/:id/auto-tags/stats",
    async (req, reply) => {
      if (!(await requireFeature(req, reply))) return;
      const s = req.requireAuth();

      const gallery = await prisma.gallery.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId, ownerId: s.user.id },
        select: { id: true },
      });
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const [fileCount, taggedFiles, pendingSuggestions, accepted, rejected, lastTag] =
        await Promise.all([
          prisma.file.count({
            where: {
              galleryId: gallery.id,
              status: "ready",
              kind: { in: ["image", "raw"] },
            },
          }),
          // DISTINCT-Files die mind. einen AutoTag haben (egal welcher Status)
          prisma.$queryRaw<Array<{ count: bigint }>>`
            SELECT COUNT(DISTINCT "fileId")::bigint AS count
            FROM file_auto_tags fat
            JOIN files f ON f.id = fat."fileId"
            WHERE f."galleryId" = ${gallery.id}::uuid
          `,
          prisma.fileAutoTag.count({
            where: { status: "suggested", file: { galleryId: gallery.id } },
          }),
          prisma.fileAutoTag.count({
            where: { status: "accepted", file: { galleryId: gallery.id } },
          }),
          prisma.fileAutoTag.count({
            where: { status: "rejected", file: { galleryId: gallery.id } },
          }),
          prisma.fileAutoTag.findFirst({
            where: { file: { galleryId: gallery.id } },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true },
          }),
        ]);

      return {
        fileCount,
        taggedFiles: Number(taggedFiles[0]?.count ?? 0n),
        pendingSuggestions,
        accepted,
        rejected,
        lastTaggedAt: lastTag?.createdAt?.toISOString() ?? null,
      };
    }
  );

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

  // ---------------------------------------------------------------------------
  // POST /galleries/:id/auto-tags/re-tag
  // ---------------------------------------------------------------------------
  // Triggert Auto-Tagging fuer alle Files einer Galerie. Nutzt die
  // bestehende Worker-Task-Queue (tasks.auto_tag.tag_image) — jeden File
  // einzeln enqueuen statt Bulk, damit die Tasks parallel ablaufen
  // koennen und Fehler isoliert bleiben.
  //
  // Use-Case: Tenant hat das Feature spaeter aktiviert und will
  // bestehende Galerien retroaktiv taggen. Oder: CLIP wurde nachgeruestet
  // und der User will jetzt die semantic-Tags fuer alle Files.
  app.post<{ Params: { id: string } }>(
    "/galleries/:id/auto-tags/re-tag",
    async (req, reply) => {
      if (!(await requireFeature(req, reply))) return;
      const s = req.requireAuth();

      const gallery = await prisma.gallery.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId, ownerId: s.user.id },
        select: { id: true },
      });
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      // Nur 'ready'-Files; image/raw. Worker-Task laesst andere kinds eh
      // skippen, aber wir filtern hier schon damit die Queue nicht
      // unnoetig grosse Workloads aufnimmt.
      const files = await prisma.file.findMany({
        where: {
          galleryId: gallery.id,
          status: "ready",
          kind: { in: ["image", "raw"] },
        },
        select: { id: true },
      });

      const { enqueue, Queues } = await import("../services/queue.js");
      let enqueued = 0;
      for (const f of files) {
        try {
          await enqueue(Queues.FILE_PROCESSING, {
            type: "auto_tag",
            fileId: f.id,
            tenantId: req.tenantId!,
            galleryId: gallery.id,
          });
          enqueued++;
        } catch (err) {
          req.log.warn({ err, fileId: f.id }, "re-tag enqueue failed");
        }
      }

      await logEvent({
        tenantId: req.tenantId!,
        actorType: "user",
        actorId: s.user.id,
        action: "auto_tag.re_tag_gallery",
        targetType: "gallery",
        targetId: gallery.id,
        payload: { fileCount: files.length, enqueued },
        ipAddress: req.ip,
      });

      return { ok: true, enqueuedFiles: enqueued };
    }
  );

  // ---------------------------------------------------------------------------
  // POST /galleries/:id/auto-tags/bulk-accept
  // ---------------------------------------------------------------------------
  // Akzeptiert alle 'suggested' Auto-Tags der Galerie deren Confidence
  // ueber einem Threshold liegt. Praktisch fuer Fotografen die nicht
  // jede einzelne Galerie-Datei manuell durchklicken wollen.
  //
  // Threshold: query-param 'min', default 0.7. Sinnvolle Bereiche:
  //   - rule_based:  oft binary (1.0), also alle >= 0.7 nehmen
  //   - clip:        Softmax-Wahrscheinlichkeiten — fuer CLIP eher 0.15-0.30
  app.post<{
    Params: { id: string };
    Querystring: { min?: string };
  }>(
    "/galleries/:id/auto-tags/bulk-accept",
    async (req, reply) => {
      if (!(await requireFeature(req, reply))) return;
      const s = req.requireAuth();

      const minConf = Math.max(
        0,
        Math.min(1, parseFloat(req.query.min ?? "0.7") || 0.7)
      );

      const gallery = await prisma.gallery.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId, ownerId: s.user.id },
        select: { id: true },
      });
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const candidates = await prisma.fileAutoTag.findMany({
        where: {
          status: "suggested",
          confidence: { gte: minConf },
          file: { galleryId: gallery.id },
        },
        select: { id: true, fileId: true, tagName: true },
      });

      // Pro distinct Tag-Name ein Tag-Row finden/anlegen — vermeidet
      // N+1 findFirst/create-Cycles.
      const distinctTagNames = Array.from(new Set(candidates.map((c) => c.tagName)));
      const tagIdByLabel = new Map<string, string>();
      for (const tagName of distinctTagNames) {
        const vocab = AUTO_TAG_VOCABULARY[tagName];
        const displayName = vocab?.label ?? tagName;
        const color = vocab?.color ?? "#94a3b8";
        let tag = await prisma.tag.findFirst({
          where: { tenantId: req.tenantId!, name: displayName },
          select: { id: true },
        });
        if (!tag) {
          tag = await prisma.tag.create({
            data: { tenantId: req.tenantId!, name: displayName, color },
            select: { id: true },
          });
        }
        tagIdByLabel.set(tagName, tag.id);
      }

      const fileTagRows = candidates
        .map((c) => ({
          fileId: c.fileId,
          tagId: tagIdByLabel.get(c.tagName),
        }))
        .filter((r): r is { fileId: string; tagId: string } => !!r.tagId);
      if (fileTagRows.length > 0) {
        await prisma.fileTag.createMany({
          data: fileTagRows,
          skipDuplicates: true,
        });
      }

      const acceptedIds = candidates.map((c) => c.id);
      if (acceptedIds.length > 0) {
        await prisma.fileAutoTag.updateMany({
          where: { id: { in: acceptedIds } },
          data: {
            status: "accepted",
            reviewedBy: s.user.id,
            reviewedAt: new Date(),
          },
        });
      }

      await logEvent({
        tenantId: req.tenantId!,
        actorType: "user",
        actorId: s.user.id,
        action: "auto_tag.bulk_accepted",
        targetType: "gallery",
        targetId: gallery.id,
        payload: { count: acceptedIds.length, threshold: minConf },
        ipAddress: req.ip,
      });

      return { ok: true, accepted: acceptedIds.length, threshold: minConf };
    }
  );
}
