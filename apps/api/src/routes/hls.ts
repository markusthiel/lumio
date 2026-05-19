/**
 * Lumio API — HLS Proxy
 *
 * HLS-Playlists referenzieren ihre Segmente relativ; das funktioniert
 * nicht über Presigned URLs. Wir proxien den ganzen HLS-Baum durch die
 * API, damit dieselbe Domain für master.m3u8 wie für die seg_*.ts
 * verwendet wird und Visitor-Auth-Checks zentral bleiben.
 *
 * Pfad-Schema:
 *   GET /g/:slug/files/:fileId/hls/:filename
 *     → master.m3u8 oder eine variant-Playlist im Root
 *   GET /g/:slug/files/:fileId/hls/:variant/:filename
 *     → seg_NNN.ts oder index.m3u8 in einem Variant-Verzeichnis
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { GetObjectCommand } from "@aws-sdk/client-s3";

import { prisma } from "../db.js";
import { getS3Client, getBucket } from "../services/storage.js";
import { loadVisitor } from "./galleries.js";

// Whitelist: nur diese Filename-Muster sind erlaubt (Path-Traversal-Schutz)
const FILENAME_RE = /^(master\.m3u8|index\.m3u8|seg_\d{3,5}\.ts)$/;
const VARIANT_RE = /^v\d+$/;

type HlsRootParams = {
  slug: string;
  fileId: string;
  filename: string;
};
type HlsVariantParams = HlsRootParams & { variant: string };

export async function registerHlsRoutes(app: FastifyInstance) {
  app.get<{ Params: HlsRootParams }>(
    "/g/:slug/files/:fileId/hls/:filename",
    async (req, reply) => streamHls(req, reply, undefined)
  );

  app.get<{ Params: HlsVariantParams }>(
    "/g/:slug/files/:fileId/hls/:variant/:filename",
    async (req, reply) => {
      if (!VARIANT_RE.test(req.params.variant)) {
        return reply.status(400).send({ error: "bad_variant" });
      }
      return streamHls(req, reply, req.params.variant);
    }
  );
}

async function streamHls(
  req: FastifyRequest<{ Params: HlsRootParams }>,
  reply: FastifyReply,
  variant: string | undefined
): Promise<unknown> {
  const { slug, fileId, filename } = req.params;

  if (!FILENAME_RE.test(filename)) {
    return reply.status(400).send({ error: "bad_filename" });
  }

  // Visitor-Check. loadVisitor erwartet ein Request, dessen Params {slug}
  // enthalten — unser Type erfüllt das.
  const visitor = await loadVisitor(req);
  if (!visitor) {
    return reply.status(401).send({ error: "unlock_required" });
  }

  // File muss zur Galerie gehören und ein Video sein
  const file = await prisma.file.findFirst({
    where: {
      id: fileId,
      galleryId: visitor.galleryId,
      kind: "video",
      status: "ready",
    },
    include: {
      gallery: { select: { tenantId: true } },
    },
  });
  if (!file) return reply.status(404).send({ error: "not_found" });

  const base = `t/${file.gallery.tenantId}/g/${visitor.galleryId}/r/${fileId}/hls`;
  const key = variant ? `${base}/${variant}/${filename}` : `${base}/${filename}`;

  try {
    const result = await getS3Client().send(
      new GetObjectCommand({ Bucket: getBucket(), Key: key })
    );
    if (!result.Body) {
      return reply.status(502).send({ error: "empty_body" });
    }
    const isManifest = filename.endsWith(".m3u8");
    reply.header(
      "Content-Type",
      isManifest ? "application/vnd.apple.mpegurl" : "video/MP2T"
    );
    reply.header(
      "Cache-Control",
      isManifest ? "public, max-age=10" : "public, max-age=31536000, immutable"
    );
    if (result.ContentLength) {
      reply.header("Content-Length", String(result.ContentLength));
    }
    return reply.send(result.Body as NodeJS.ReadableStream);
  } catch (err) {
    req.log.warn({ err, key }, "hls fetch failed");
    return reply.status(404).send({ error: "not_found" });
  }
}
