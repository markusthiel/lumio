/**
 * Lumio API — Export Routes
 *
 *   GET /galleries/:id/export/summary  — JSON-Übersicht für die Studio-UI
 *   GET /galleries/:id/export/csv      — Auswahl als CSV
 *   GET /galleries/:id/export/xmp      — ZIP mit einem .xmp pro File
 *
 * Alle nur mit Studio-Auth + Ownership-Check.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import archiver from "archiver";

import { prisma } from "../db.js";
import { galleryAccessWhere } from "../lib/gallery-access.js";
import {
  loadProofingExport,
  buildCsv,
  buildXmp,
  xmpSidecarName,
} from "../services/export.js";

async function ownGallery(req: FastifyRequest, id: string) {
  const s = req.requireAuth();
  // Granulares Zugriffsmodell: Ersteller ODER freigegeben ODER Studio-Owner.
  // (Früher nur ownerId — das umging die Galerie-Freigabe komplett.)
  return prisma.gallery.findFirst({
    where: { id, tenantId: req.tenantId, ...galleryAccessWhere(s) },
    select: { id: true, slug: true, title: true },
  });
}

export async function registerExportRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // GET /galleries/:id/export/summary
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    "/galleries/:id/export/summary",
    async (req, reply) => {
      req.requireAuth();
      const gallery = await ownGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const rows = await loadProofingExport(gallery.id);

      // Aggregat-Statistiken für die Studio-UI
      const totalsByLabel: Record<string, number> = {};
      let withRating = 0;
      let withLike = 0;
      const accessSummary = new Map<
        string,
        { picks: number; likes: number; comments: number }
      >();

      for (const r of rows) {
        if (r.label) totalsByLabel[r.label] = (totalsByLabel[r.label] ?? 0) + 1;
        if (r.rating !== null) withRating++;
        if (r.liked) withLike++;
        for (const a of r.perAccess) {
          const cur = accessSummary.get(a.accessLabel) ?? {
            picks: 0,
            likes: 0,
            comments: 0,
          };
          if (a.status === "pick" || a.liked) cur.picks++;
          if (a.liked) cur.likes++;
          accessSummary.set(a.accessLabel, cur);
        }
      }

      const commentCounts = await prisma.comment.groupBy({
        by: ["accessId"],
        where: { file: { galleryId: gallery.id } },
        _count: { _all: true },
      });
      for (const cc of commentCounts) {
        if (!cc.accessId) continue;
        const access = await prisma.galleryAccess.findUnique({
          where: { id: cc.accessId },
          select: { label: true },
        });
        if (!access) continue;
        const cur = accessSummary.get(access.label) ?? {
          picks: 0,
          likes: 0,
          comments: 0,
        };
        cur.comments = cc._count._all;
        accessSummary.set(access.label, cur);
      }

      // Kommentar-Anzahl pro File — für die Indikatoren in der Studio-
      // Auswahl-Übersicht (Kachel zeigt eine Sprechblase mit Anzahl).
      const commentByFile = await prisma.comment.groupBy({
        by: ["fileId"],
        where: { file: { galleryId: gallery.id } },
        _count: { _all: true },
      });
      const commentCountByFile = new Map<string, number>(
        commentByFile.map((c) => [c.fileId, c._count._all])
      );

      return {
        gallery: {
          id: gallery.id,
          slug: gallery.slug,
          title: gallery.title,
        },
        totals: {
          fileCount: rows.length,
          withRating,
          withLike,
          byLabel: totalsByLabel,
        },
        perAccess: [...accessSummary.entries()].map(([label, s]) => ({
          label,
          ...s,
        })),
        // Die ersten 500 Files inline; bei größeren Galerien paginiert
        // der Frontend-Client später.
        files: rows.slice(0, 500).map((r) => ({
          fileId: r.fileId,
          filename: r.filename,
          rating: r.rating,
          label: r.label,
          liked: r.liked,
          commentCount: commentCountByFile.get(r.fileId) ?? 0,
          perAccess: r.perAccess,
        })),
        fileCountTotal: rows.length,
      };
    }
  );

  // -------------------------------------------------------------------------
  // GET /galleries/:id/export/csv
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    "/galleries/:id/export/csv",
    async (req, reply) => {
      req.requireAuth();
      const gallery = await ownGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const rows = await loadProofingExport(gallery.id);
      const csv = buildCsv(rows);
      const safeName = gallery.slug.replace(/[^a-zA-Z0-9_-]/g, "");

      reply.header("Content-Type", "text/csv; charset=utf-8");
      reply.header(
        "Content-Disposition",
        `attachment; filename="lumio_${safeName}_selection.csv"`
      );
      return reply.send(csv);
    }
  );

  // -------------------------------------------------------------------------
  // GET /galleries/:id/export/xmp
  // -------------------------------------------------------------------------
  // Liefert ein ZIP mit einem .xmp-Sidecar pro File, das Rating/Label hat.
  // Wir bauen den ZIP-Stream live in den Response, kein Tempfile.
  app.get<{ Params: { id: string } }>(
    "/galleries/:id/export/xmp",
    async (req, reply) => {
      req.requireAuth();
      const gallery = await ownGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const rows = await loadProofingExport(gallery.id);
      const exportable = rows.filter(
        (r) => buildXmp(r) !== null
      );
      if (exportable.length === 0) {
        return reply
          .status(404)
          .send({ error: "no_selection", message: "Keine Auswahl vorhanden." });
      }

      const safeName = gallery.slug.replace(/[^a-zA-Z0-9_-]/g, "");
      reply.header("Content-Type", "application/zip");
      reply.header(
        "Content-Disposition",
        `attachment; filename="lumio_${safeName}_xmp.zip"`
      );

      const archive = archiver("zip", { zlib: { level: 6 } });
      archive.on("error", (err) => {
        req.log.warn({ err }, "xmp zip stream error");
      });

      // Stream piping: archiver gibt einen Readable; den senden wir.
      // Fastify .send() akzeptiert das.
      const seen = new Set<string>();
      for (const row of exportable) {
        const xmp = buildXmp(row);
        if (!xmp) continue;
        let name = xmpSidecarName(row.filename);
        // Dedupe bei Kollisionen
        let candidate = name;
        let n = 2;
        while (seen.has(candidate)) {
          const dot = name.lastIndexOf(".");
          candidate =
            dot > 0
              ? `${name.slice(0, dot)}_${n}${name.slice(dot)}`
              : `${name}_${n}`;
          n++;
        }
        seen.add(candidate);
        archive.append(xmp, { name: candidate });
      }

      // Wichtig: erst nach allen append-Calls finalisieren
      void archive.finalize();
      return reply.send(archive);
    }
  );
}
