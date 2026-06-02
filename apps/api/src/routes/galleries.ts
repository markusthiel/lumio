/**
 * Lumio API — Gallery Routes
 *
 * Studio-seitig (mit Auth):
 *   GET    /galleries              — Liste eigener Galerien
 *   POST   /galleries              — neue Galerie
 *   GET    /galleries/:id          — Details
 *   PATCH  /galleries/:id          — Einstellungen ändern
 *   DELETE /galleries/:id          — Galerie löschen
 *
 * Kunden-seitig (öffentlich, optional mit Access-Token):
 *   GET    /g/:slug                — öffentliche Galerie-Daten
 *   POST   /g/:slug/unlock         — Passwort eingeben
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { randomBytes, createHash } from "node:crypto";

import { prisma } from "../db.js";
import { config } from "../config.js";
import { generateGallerySlug } from "../services/ids.js";
import { presignGet, presignPut, getObjectStream } from "../services/storage.js";
import { verifyPassword, hashPassword } from "../services/auth.js";
import { isTenantOperational } from "../services/tenant.js";
import { enqueue, Queues } from "../services/queue.js";
import { resolveGalleryBranding } from "../services/branding.js";
import { logEvent } from "../services/audit.js";
import { checkActiveGalleriesLimit, checkFeatureAvailable } from "../services/usage.js";
import { publishEvent } from "../services/webhooks.js";
import { galleryAccessWhere } from "../lib/gallery-access.js";
import {
  createVisitorToken,
  verifyVisitorToken,
  visitorCookieName,
} from "../services/visitor.js";

// ---------------------------------------------------------------------------
// Customer-Download: Variant-Auflösung (geteilt)
// ---------------------------------------------------------------------------
// Renditions haben kein mimeType-Feld, nur `format`. Für den Blob-Stream-
// Endpoint brauchen wir aber einen korrekten Content-Type, damit iOS die
// geteilte Datei als Bild erkennt und "In Fotos sichern" anbietet.
function renditionFormatToMime(format: string): string {
  switch (format.toLowerCase()) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "png":
      return "image/png";
    case "mp4":
      return "video/mp4";
    default:
      return "application/octet-stream";
  }
}

type DownloadTarget =
  | {
      ok: true;
      storageKey: string;
      filename: string;
      contentType: string;
      bytes: bigint | null;
    }
  | { ok: false; status: number; error: string };

// Löst aus File + Variant den konkreten Storage-Key, Dateinamen und
// Content-Type auf. Geteilt zwischen dem (redirect-)Download-Endpoint und
// dem (stream-)Blob-Endpoint, damit die Rendition-Auswahl nur an EINER
// Stelle lebt. Die Permission-Checks (Visitor, downloadEnabled, canDownload,
// originals) bleiben in den jeweiligen Routen.
function resolveDownloadTarget(
  file: {
    kind: string;
    storageKey: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: bigint | null;
    renditions: { kind: string; storageKey: string; format: string }[];
  },
  variant: "original" | "web",
  originalsEnabled: boolean
): DownloadTarget {
  if (variant === "original") {
    return {
      ok: true,
      storageKey: file.storageKey,
      filename: file.originalFilename,
      contentType: file.mimeType || "application/octet-stream",
      bytes: file.sizeBytes,
    };
  }

  // variant === "web"
  const dotIdx = file.originalFilename.lastIndexOf(".");
  const stem =
    dotIdx > 0 ? file.originalFilename.slice(0, dotIdx) : file.originalFilename;

  if (file.kind === "video") {
    // Videos: video_mp4-Rendition. Wenn (noch) keine existiert (Altbestand),
    // gibt's keine Web-Version — kein impliziter Fallback aufs Original,
    // weil das Original viel größer ist als der Kunde erwartet.
    const mp4 = file.renditions.find((r) => r.kind === "video_mp4");
    if (!mp4) {
      return { ok: false, status: 404, error: "web_rendition_unavailable" };
    }
    return {
      ok: true,
      storageKey: mp4.storageKey,
      filename: `${stem}_web.mp4`,
      contentType: "video/mp4",
      bytes: null,
    };
  }

  // Bilder: web_jpeg bevorzugt, web (webp) als Fallback für Altbestand.
  // Kunden öffnen JPEG überall, webp nur in modernen Browsern/macOS Preview.
  const webJpeg = file.renditions.find((r) => r.kind === "web_jpeg");
  const webWebp = file.renditions.find((r) => r.kind === "web");
  const chosen = webJpeg ?? webWebp;
  if (!chosen) {
    if (originalsEnabled) {
      // implizit auf Original umschalten, kein Fehler
      return {
        ok: true,
        storageKey: file.storageKey,
        filename: file.originalFilename,
        contentType: file.mimeType || "application/octet-stream",
        bytes: file.sizeBytes,
      };
    }
    return { ok: false, status: 404, error: "web_rendition_unavailable" };
  }
  const ext = chosen.format === "jpg" ? "jpg" : "webp";
  return {
    ok: true,
    storageKey: chosen.storageKey,
    filename: `${stem}_web.${ext}`,
    contentType: renditionFormatToMime(chosen.format),
    bytes: null,
  };
}

const createGallerySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  mode: z.enum(["collaboration", "presentation"]).optional(),
  brandingId: z.string().uuid().nullable().optional(),
  downloadEnabled: z.boolean().optional(),
  downloadOriginalsEnabled: z.boolean().optional(),
  watermarkEnabled: z.boolean().optional(),
  commentsEnabled: z.boolean().optional(),
  ratingsEnabled: z.boolean().optional(),
  customerTagFilterEnabled: z.boolean().optional(),
  publicAccess: z.boolean().optional(),
  selectionLimit: z.number().int().positive().optional(),
  expiresAt: z.string().datetime().optional(),
  // Optional: Template übernehmen. Explizit gesetzte Felder im Request
  // gewinnen über die Template-Werte.
  templateId: z.string().uuid().optional(),
});

const HEX_RGB = /^#[0-9a-fA-F]{6}$/;
const HEX_RGBA = /^#[0-9a-fA-F]{8}$/;
const HEX_RGB_OR_RGBA = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const updateGallerySchema = createGallerySchema.partial().extend({
  status: z.enum(["draft", "live", "archived"]).optional(),
  // Passwortschutz: String = setzen, null = entfernen, weglassen =
  // unverändert. Wird serverseitig gehasht.
  password: z.string().min(1).max(200).nullable().optional(),
  // Header-Customization. Alle nullable, damit das Studio Felder
  // wieder leeren kann (null = "wieder Default").
  heroFileId: z.string().uuid().nullable().optional(),
  heroUrl: z.string().max(500).nullable().optional(),
  heroOverlayColor: z
    .string()
    .regex(HEX_RGBA, "must be #RRGGBBAA")
    .nullable()
    .optional(),
  heroOverlayBlur: z.number().int().min(0).max(40).nullable().optional(),
  heroBackgroundColor: z
    .string()
    .regex(HEX_RGB, "must be #RRGGBB")
    .nullable()
    .optional(),
  eventLogoUrl: z.string().max(500).nullable().optional(),
  eventLogoSize: z.enum(["small", "medium", "large"]).optional(),
  welcomeMarkdown: z.string().max(20_000).nullable().optional(),
  heroLayout: z
    .enum(["minimal", "splash", "side_by_side", "centered"])
    .optional(),
  fontHeading: z.string().max(40).nullable().optional(),
  fontBody: z.string().max(40).nullable().optional(),
  gridLayout: z.enum(["justified", "equal"]).optional(),
  slideshowTransition: z
    .enum(["fade", "slide", "kenburns"])
    .optional(),
  slideshowAudioUrl: z.string().max(500).nullable().optional(),
  footerMarkdown: z.string().max(20_000).nullable().optional(),
  // Per-Galerie Print-Shop-Sichtbarkeit. true = sichtbar, false =
  // unterdrueckt, null = uebernimmt Tenant-Default. Tenant kann eine
  // Familien-Galerie ausnehmen, eine Hochzeitsgalerie aber den
  // Endkunden-Bestellflow zeigen.
  printShopEnabled: z.boolean().nullable().optional(),
  colorBackground: z
    .string()
    .regex(HEX_RGB, "must be #RRGGBB")
    .nullable()
    .optional(),
  colorAccent: z
    .string()
    .regex(HEX_RGB, "must be #RRGGBB")
    .nullable()
    .optional(),
});

const unlockSchema = z.object({
  password: z.string().min(1).max(200).optional(),
  token: z.string().min(1).max(200).optional(),
});

/**
 * Lädt aus dem Visitor-Cookie der Galerie die Galerie-Id und (falls geliefert)
 * den Access-Token. Gibt null zurück, wenn der Visitor nicht freigeschaltet ist.
 *
 * Wir können hier nicht über den Slug auflösen, ohne erst die Galerie zu
 * fetchen, weil das Cookie an die galleryId gebunden ist. Caller muss also
 * den Slug → galleryId schon haben (z.B. aus dem Pfad-Param).
 */

/** Kurzer Fingerabdruck eines Passwort-Hashes für das Visitor-Cookie.
 *  Der bcrypt-Hash ändert sich bei jeder Passwort-Änderung, also auch der
 *  Fingerabdruck — alte Cookies werden dadurch ungültig. */
function passwordFingerprint(hash: string): string {
  return createHash("sha256").update(hash).digest("hex").slice(0, 16);
}

/** Prüft, ob das Cookie gegen das aktuell geforderte Passwort
 *  freigeschaltet wurde. Kein Passwort gefordert → immer ok. */
function cookiePasswordOk(
  requiredHash: string | null | undefined,
  claims: { pwfp?: string | null }
): boolean {
  if (!requiredHash) return true;
  return claims.pwfp === passwordFingerprint(requiredHash);
}

export async function loadVisitor(
  req: FastifyRequest & { params: { slug: string } }
): Promise<{ galleryId: string; accessId: string | null } | null> {
  // Wir holen die Galerie über den Slug, damit wir wissen, welches
  // Cookie zu prüfen ist.
  const gallery = await prisma.gallery.findUnique({
    where: { slug: req.params.slug },
    select: {
      id: true,
      status: true,
      expiresAt: true,
      passwordHash: true,
      publicAccess: true,
    },
  });
  if (!gallery || gallery.status !== "live") return null;
  if (gallery.expiresAt && gallery.expiresAt < new Date()) return null;

  const cookieName = visitorCookieName(gallery.id);
  const cookie = req.cookies?.[cookieName];
  if (!cookie) {
    // Ohne Cookie nur rein, wenn die Galerie öffentlich UND passwortlos
    // ist (anonymes Browsen, Picdrop-Style). Sonst braucht es einen
    // gültigen Freigabe-Link.
    if (gallery.publicAccess && !gallery.passwordHash) {
      return { galleryId: gallery.id, accessId: null };
    }
    return null;
  }

  const claims = verifyVisitorToken(cookie);
  if (!claims || claims.gid !== gallery.id) return null;

  // Kam der Besucher über einen Freigabe-Link (claims.aid)?
  if (claims.aid) {
    const access = await prisma.galleryAccess.findUnique({
      where: { id: claims.aid },
      select: { expiresAt: true, galleryId: true, passwordHash: true },
    });
    const linkValid =
      access &&
      access.galleryId === gallery.id &&
      (access.expiresAt === null || access.expiresAt >= new Date());
    if (!linkValid) {
      // Link ungültig/abgelaufen: öffentliche, passwortlose Galerie
      // erlaubt weiter anonymes Browsen, sonst gesperrt.
      if (gallery.publicAccess && !gallery.passwordHash) {
        return { galleryId: gallery.id, accessId: null };
      }
      return null;
    }
    // Token-Inhaber: das Galerie-Passwort gilt NICHT — der Link ist
    // bereits der Ausweis. Nur ein eigenes Link-Passwort muss (falls
    // gesetzt) gegen den aktuellen Stand freigeschaltet sein.
    if (!cookiePasswordOk(access.passwordHash, claims)) return null;
    return { galleryId: gallery.id, accessId: claims.aid };
  }

  // Anonymes Cookie (kein Link): Galerie-Passwort und publicAccess gelten.
  if (!cookiePasswordOk(gallery.passwordHash, claims)) return null;
  if (!gallery.publicAccess) return null;
  return { galleryId: gallery.id, accessId: null };
}

/** Parst ein ISO-Datum oder gibt undefined zurück bei Invalid-Date.
 *  Wird für die optionalen ?since/?until-Filter-Parameter benutzt. */
function safeDate(s: string): Date | undefined {
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

export async function registerGalleryRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // GET /galleries — Liste eigener Galerien
  // -------------------------------------------------------------------------
  // Optionale Filter — alle als Query-Params, alle AND-verknüpft:
  //   ?tag=<uuid>[,<uuid>...]   → Galerien, die JEDEN Tag tragen (AND)
  //   ?mode=collaboration|presentation
  //   ?status=draft|live|archived
  //   ?since=<ISO>              → updatedAt >= since
  //   ?until=<ISO>              → updatedAt <= until
  //
  // Filter-Macros (gespeicherte Filter-Sets) leben unter /collections/:id/galleries
  // und nutzen die gleiche Logik server-seitig. Frontend kann ad-hoc-
  // Filter über die Query-Params senden, BEVOR der User die Filter
  // optional als Smart Collection speichert.
  app.get<{
    Querystring: {
      tag?: string;
      mode?: string;
      status?: string;
      since?: string;
      until?: string;
    };
  }>(
    "/galleries",
    async (req) => {
      const s = req.requireAuth();
      const tagFilterIds = (req.query.tag ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter((t) => /^[0-9a-f-]{36}$/i.test(t));

      // mode/status: enum-Validierung — alles andere wird ignoriert
      // (statt zu 400 zu werfen) damit alte Bookmarks mit kaputten
      // Query-Params nicht abstürzen.
      const validModes = ["collaboration", "presentation"];
      const validStatuses = ["draft", "live", "archived"];
      const modeFilter =
        req.query.mode && validModes.includes(req.query.mode)
          ? req.query.mode
          : undefined;
      const statusFilter =
        req.query.status && validStatuses.includes(req.query.status)
          ? req.query.status
          : undefined;

      // Datum-Range: invalides ISO → ignorieren (s.o.).
      const since = req.query.since ? safeDate(req.query.since) : undefined;
      const until = req.query.until ? safeDate(req.query.until) : undefined;

      const galleries = await prisma.gallery.findMany({
        where: {
          tenantId: req.tenantId,
          ...galleryAccessWhere(s),
          ...(modeFilter ? { mode: modeFilter } : {}),
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(since || until
            ? {
                updatedAt: {
                  ...(since ? { gte: since } : {}),
                  ...(until ? { lte: until } : {}),
                },
              }
            : {}),
          // AND-Semantik: für jeden geforderten Tag muss ein GalleryTag
          // existieren. Prisma's "AND: [...]" + "some" baut genau das.
          ...(tagFilterIds.length > 0
            ? {
                AND: tagFilterIds.map((tagId) => ({
                  tags: { some: { tagId } },
                })),
              }
            : {}),
        },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          slug: true,
          title: true,
          description: true,
          mode: true,
          status: true,
          downloadEnabled: true,
          watermarkEnabled: true,
          heroFileId: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { files: true } },
          tags: {
            select: {
              tag: {
                select: { id: true, name: true, color: true },
              },
            },
          },
        },
      });

      const ids = galleries.map((g) => g.id);

      // --- Cover-Thumbnails (Batch) -----------------------------------------
      // Pro Galerie ein Thumbnail: bevorzugt das gesetzte Hero-File, sonst
      // das erste Bild (nach sortIndex). Wir holen die thumb-Renditions in
      // einer Query und signieren die URLs parallel.
      const coverKeyByGallery = new Map<string, string>();
      if (ids.length > 0) {
        // 1) Erstes Bild je Galerie (Fallback-Cover)
        const firstThumbs = await prisma.$queryRaw<
          Array<{ gid: string; key: string }>
        >`
          SELECT DISTINCT ON (f."galleryId") f."galleryId" AS gid, r."storageKey" AS key
          FROM files f
          JOIN renditions r ON r."fileId" = f.id AND r.kind = 'thumb'
          WHERE f."galleryId" = ANY(${ids}::uuid[]) AND f.kind = 'image'
          ORDER BY f."galleryId", f."sortIndex" ASC, f."createdAt" ASC
        `;
        for (const row of firstThumbs) coverKeyByGallery.set(row.gid, row.key);

        // 2) Hero-File-Override, wo gesetzt
        const heroIds = galleries
          .filter((g) => g.heroFileId)
          .map((g) => g.heroFileId as string);
        if (heroIds.length > 0) {
          const heroThumbs = await prisma.rendition.findMany({
            where: { fileId: { in: heroIds }, kind: "thumb" },
            select: { storageKey: true, file: { select: { id: true, galleryId: true } } },
          });
          for (const r of heroThumbs) {
            coverKeyByGallery.set(r.file.galleryId, r.storageKey);
          }
        }
      }
      const coverUrlByGallery = new Map<string, string>();
      await Promise.all(
        Array.from(coverKeyByGallery.entries()).map(async ([gid, key]) => {
          coverUrlByGallery.set(gid, await presignGet({ key }));
        })
      );

      // --- Stats (Batch) ----------------------------------------------------
      // Besuche = share.unlock-Events pro Galerie. Auswahl/Likes = Selections
      // über die Gallery-Accesses. Beides in je einer Query, ohne N+1.
      const visitsByGallery = new Map<string, number>();
      const selectedByGallery = new Map<string, number>();
      const likesByGallery = new Map<string, number>();
      if (ids.length > 0) {
        const visitRows = await prisma.event.groupBy({
          by: ["targetId"],
          where: {
            tenantId: req.tenantId,
            action: "share.unlock",
            targetType: "gallery",
            targetId: { in: ids },
          },
          _count: { _all: true },
        });
        for (const v of visitRows) {
          if (v.targetId) visitsByGallery.set(v.targetId, v._count._all);
        }

        const selRows = await prisma.$queryRaw<
          Array<{ gid: string; selected: number; liked: number }>
        >`
          SELECT ga."galleryId" AS gid,
                 COUNT(s.id)::int AS selected,
                 COUNT(s.id) FILTER (WHERE s.liked)::int AS liked
          FROM selections s
          JOIN gallery_access ga ON ga.id = s."accessId"
          WHERE ga."galleryId" = ANY(${ids}::uuid[])
          GROUP BY ga."galleryId"
        `;
        for (const row of selRows) {
          selectedByGallery.set(row.gid, Number(row.selected));
          likesByGallery.set(row.gid, Number(row.liked));
        }
      }

      return {
        galleries: galleries.map((g) => ({
          id: g.id,
          slug: g.slug,
          title: g.title,
          description: g.description,
          mode: g.mode,
          status: g.status,
          downloadEnabled: g.downloadEnabled,
          watermarkEnabled: g.watermarkEnabled,
          createdAt: g.createdAt,
          updatedAt: g.updatedAt,
          fileCount: g._count.files,
          tags: g.tags.map((gt) => gt.tag),
          coverThumbUrl: coverUrlByGallery.get(g.id) ?? null,
          stats: {
            visits: visitsByGallery.get(g.id) ?? 0,
            likes: likesByGallery.get(g.id) ?? 0,
            selected: selectedByGallery.get(g.id) ?? 0,
          },
        })),
      };
    }
  );

  // -------------------------------------------------------------------------
  // POST /galleries — neue Galerie anlegen
  // -------------------------------------------------------------------------
  app.post("/galleries", async (req, reply) => {
    const s = req.requireAuth();
    const body = createGallerySchema.parse(req.body);

    // Plan-Limit-Check: aktive Galerien-Limit noch nicht erreicht?
    // Nur wenn Billing-Mode aktiv ist (sonst selbst-gehostet, keine Limits).
    if (config.BILLING_ENABLED && req.tenantId) {
      const check = await checkActiveGalleriesLimit(req.tenantId);
      if (!check.ok) {
        return reply.status(402).send(check);
      }
    }

    // Template laden, falls angegeben — und prüfen dass es dem Tenant gehört.
    let template: Awaited<ReturnType<typeof prisma.galleryTemplate.findFirst>> =
      null;
    if (body.templateId) {
      template = await prisma.galleryTemplate.findFirst({
        where: { id: body.templateId, tenantId: req.tenantId },
      });
      if (!template) {
        return reply.status(400).send({ error: "bad_template" });
      }
    }

    // Effektive Werte: explizit im Request → Template → Lumio-Defaults
    const eff = {
      mode: body.mode ?? template?.mode ?? "collaboration",
      description:
        body.description ?? template?.defaultDescription ?? null,
      brandingId: body.brandingId !== undefined
        ? body.brandingId
        : template?.brandingId ?? null,
      downloadEnabled:
        body.downloadEnabled ?? template?.downloadEnabled ?? true,
      watermarkEnabled:
        body.watermarkEnabled ?? template?.watermarkEnabled ?? false,
      commentsEnabled:
        body.commentsEnabled ?? template?.commentsEnabled ?? true,
      ratingsEnabled:
        body.ratingsEnabled ?? template?.ratingsEnabled ?? true,
      expiresAt: body.expiresAt
        ? new Date(body.expiresAt)
        : template?.defaultExpiryDays
        ? new Date(
            Date.now() + template.defaultExpiryDays * 24 * 3600 * 1000
          )
        : null,
    };

    // Slug ist global eindeutig (User klickt einen Share-Link, der den Tenant
    // nicht im Pfad mitführt). Wir versuchen ein paar Mal bei Kollision.
    let slug = generateGallerySlug();
    for (let attempt = 0; attempt < 5; attempt++) {
      const exists = await prisma.gallery.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (!exists) break;
      slug = generateGallerySlug();
      if (attempt === 4) {
        return reply
          .status(500)
          .send({ error: "slug_collision", message: "could not generate slug" });
      }
    }

    const gallery = await prisma.gallery.create({
      data: {
        tenantId: req.tenantId,
        ownerId: s.user.id,
        slug,
        title: body.title,
        description: eff.description,
        mode: eff.mode,
        brandingId: eff.brandingId,
        downloadEnabled: eff.downloadEnabled,
        watermarkEnabled: eff.watermarkEnabled,
        commentsEnabled: eff.commentsEnabled,
        ratingsEnabled: eff.ratingsEnabled,
        selectionLimit: body.selectionLimit ?? null,
        expiresAt: eff.expiresAt,
      },
    });

    await logEvent({
      tenantId: req.tenantId,
      actorType: "user",
      actorId: s.user.id,
      action: "gallery.create",
      targetType: "gallery",
      targetId: gallery.id,
      payload: { slug, title: body.title },
      ipAddress: req.ip,
    });

    await publishEvent({
      tenantId: req.tenantId,
      eventType: "gallery.created",
      payload: {
        galleryId: gallery.id,
        slug,
        title: body.title,
        mode: gallery.mode,
        ownerId: s.user.id,
      },
    });

    return reply.status(201).send({ gallery });
  });

  // -------------------------------------------------------------------------
  // GET /galleries/:id — Details inkl. Files
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    "/galleries/:id",
    async (req, reply) => {
      const s = req.requireAuth();
      const gallery = await prisma.gallery.findFirst({
        where: {
          id: req.params.id,
          tenantId: req.tenantId,
          ...galleryAccessWhere(s),
        },
        include: {
          files: {
            orderBy: { sortIndex: "asc" },
            select: {
              id: true,
              originalFilename: true,
              mimeType: true,
              sizeBytes: true,
              kind: true,
              status: true,
              errorMessage: true,
              width: true,
              height: true,
              pageCount: true,
              sortIndex: true,
              sectionId: true,
              createdAt: true,
              // Upload-Link-Metadaten — Studio kann pending-Files filtern
              // und markieren, woher sie kommen.
              uploadedVia: true,
              uploadLinkId: true,
              publicVisibility: true,
              rejectedAt: true,
              rejectedReason: true,
              renditions: {
                select: { kind: true, storageKey: true, format: true, page: true },
              },
              tags: {
                select: {
                  tag: { select: { id: true, name: true, color: true } },
                },
              },
            },
          },
          tags: {
            select: {
              tag: { select: { id: true, name: true, color: true } },
            },
          },
          _count: { select: { files: true } },
        },
      });
      if (!gallery) {
        return reply.status(404).send({ error: "not_found" });
      }

      // BigInt → number + thumbUrl + webUrl optional auflösen.
      // webUrl wird gebraucht für die Annotation-Detail-Ansicht im
      // Proofing-Tab — höhere Auflösung als der Thumb, ohne dass wir
      // ein Original ausliefern müssen.
      const files = await Promise.all(
        gallery.files.map(async (f) => {
          const thumb = f.renditions.find(
            (r) => r.kind === "thumb" && r.page === 0
          );
          const web = f.renditions.find(
            (r) => r.kind === "web" && r.page === 0
          );
          const preview = f.renditions.find(
            (r) => r.kind === "preview" && r.page === 0
          );
          const thumbUrl = thumb
            ? await presignGet({ key: thumb.storageKey })
            : null;
          const webUrl = web
            ? await presignGet({ key: web.storageKey })
            : preview
            ? await presignGet({ key: preview.storageKey })
            : null;
          const pages =
            f.pageCount && f.pageCount > 1
              ? await Promise.all(
                  Array.from({ length: f.pageCount }, async (_, p) => {
                    const pt = f.renditions.find(
                      (r) => r.kind === "thumb" && r.page === p
                    );
                    const pw =
                      f.renditions.find(
                        (r) => r.kind === "web" && r.page === p
                      ) ??
                      f.renditions.find(
                        (r) => r.kind === "preview" && r.page === p
                      );
                    return {
                      page: p,
                      thumbUrl: pt
                        ? await presignGet({ key: pt.storageKey })
                        : null,
                      webUrl: pw
                        ? await presignGet({ key: pw.storageKey })
                        : null,
                    };
                  })
                )
              : undefined;
          return {
            id: f.id,
            originalFilename: f.originalFilename,
            mimeType: f.mimeType,
            sizeBytes: Number(f.sizeBytes),
            kind: f.kind,
            status: f.status,
            errorMessage: f.errorMessage,
            width: f.width,
            height: f.height,
            sortIndex: f.sortIndex,
            sectionId: f.sectionId,
            createdAt: f.createdAt,
            thumbUrl,
            webUrl,
            pageCount: f.pageCount,
            pages,
            tags: f.tags.map((ft) => ft.tag),
            uploadedVia: f.uploadedVia,
            uploadLinkId: f.uploadLinkId,
            publicVisibility: f.publicVisibility,
            rejectedAt: f.rejectedAt,
            rejectedReason: f.rejectedReason,
          };
        })
      );

      return {
        gallery: {
          ...gallery,
          files,
          fileCount: gallery._count.files,
          tags: gallery.tags.map((gt) => gt.tag),
          hasPassword: !!gallery.passwordHash,
          passwordHash: undefined,
          _count: undefined,
        },
      };
    }
  );

  // -------------------------------------------------------------------------
  // PATCH /galleries/:id
  // -------------------------------------------------------------------------
  app.patch<{ Params: { id: string } }>(
    "/galleries/:id",
    async (req, reply) => {
      const s = req.requireAuth();
      const body = updateGallerySchema.parse(req.body);

      const existing = await prisma.gallery.findFirst({
        where: {
          id: req.params.id,
          tenantId: req.tenantId,
          ...galleryAccessWhere(s),
        },
        select: { id: true, slug: true, watermarkEnabled: true, status: true },
      });
      if (!existing) return reply.status(404).send({ error: "not_found" });

      const turningOnWatermark =
        body.watermarkEnabled === true && !existing.watermarkEnabled;
      const goingLive = body.status === "live" && existing.status !== "live";

      // Passwort-Hash vorbereiten (async → außerhalb des data-Spreads).
      let passwordHashUpdate: { passwordHash: string | null } | undefined;
      if (body.password !== undefined) {
        passwordHashUpdate = {
          passwordHash: body.password
            ? await hashPassword(body.password)
            : null,
        };
      }

      const gallery = await prisma.gallery.update({
        where: { id: existing.id },
        data: {
          ...(passwordHashUpdate ?? {}),
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.description !== undefined
            ? { description: body.description }
            : {}),
          ...(body.mode !== undefined ? { mode: body.mode } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.brandingId !== undefined
            ? { brandingId: body.brandingId }
            : {}),
          ...(body.downloadEnabled !== undefined
            ? { downloadEnabled: body.downloadEnabled }
            : {}),
          ...(body.downloadOriginalsEnabled !== undefined
            ? { downloadOriginalsEnabled: body.downloadOriginalsEnabled }
            : {}),
          ...(body.watermarkEnabled !== undefined
            ? { watermarkEnabled: body.watermarkEnabled }
            : {}),
          ...(body.commentsEnabled !== undefined
            ? { commentsEnabled: body.commentsEnabled }
            : {}),
          ...(body.ratingsEnabled !== undefined
            ? { ratingsEnabled: body.ratingsEnabled }
            : {}),
          ...(body.customerTagFilterEnabled !== undefined
            ? { customerTagFilterEnabled: body.customerTagFilterEnabled }
            : {}),
          ...(body.publicAccess !== undefined
            ? { publicAccess: body.publicAccess }
            : {}),
          ...(body.selectionLimit !== undefined
            ? { selectionLimit: body.selectionLimit }
            : {}),
          ...(body.expiresAt !== undefined
            ? {
                expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
              }
            : {}),
          // Header-Customization — durchreichen wenn explizit gesetzt
          // (auch null → Feld leeren ist erlaubt).
          ...(body.heroFileId !== undefined ? { heroFileId: body.heroFileId } : {}),
          ...(body.heroUrl !== undefined ? { heroUrl: body.heroUrl } : {}),
          ...(body.heroOverlayColor !== undefined
            ? { heroOverlayColor: body.heroOverlayColor }
            : {}),
          ...(body.heroOverlayBlur !== undefined
            ? { heroOverlayBlur: body.heroOverlayBlur }
            : {}),
          ...(body.heroBackgroundColor !== undefined
            ? { heroBackgroundColor: body.heroBackgroundColor }
            : {}),
          ...(body.eventLogoUrl !== undefined
            ? { eventLogoUrl: body.eventLogoUrl }
            : {}),
          ...(body.eventLogoSize !== undefined
            ? { eventLogoSize: body.eventLogoSize }
            : {}),
          ...(body.welcomeMarkdown !== undefined
            ? { welcomeMarkdown: body.welcomeMarkdown }
            : {}),
          ...(body.heroLayout !== undefined
            ? { heroLayout: body.heroLayout }
            : {}),
          ...(body.fontHeading !== undefined
            ? { fontHeading: body.fontHeading }
            : {}),
          ...(body.fontBody !== undefined
            ? { fontBody: body.fontBody }
            : {}),
          ...(body.gridLayout !== undefined
            ? { gridLayout: body.gridLayout }
            : {}),
          ...(body.slideshowTransition !== undefined
            ? { slideshowTransition: body.slideshowTransition }
            : {}),
          ...(body.slideshowAudioUrl !== undefined
            ? { slideshowAudioUrl: body.slideshowAudioUrl }
            : {}),
          ...(body.footerMarkdown !== undefined
            ? { footerMarkdown: body.footerMarkdown }
            : {}),
          ...(body.colorBackground !== undefined
            ? { colorBackground: body.colorBackground }
            : {}),
          ...(body.colorAccent !== undefined
            ? { colorAccent: body.colorAccent }
            : {}),
          ...(body.printShopEnabled !== undefined
            ? { printShopEnabled: body.printShopEnabled }
            : {}),
        },
      });

      // Watermark gerade eingeschaltet → für alle Files Watermark-Rendition
      // generieren (fire-and-forget — der Worker macht den Rest)
      if (turningOnWatermark) {
        const files = await prisma.file.findMany({
          where: { galleryId: gallery.id, status: "ready" },
          select: { id: true },
        });
        for (const f of files) {
          await enqueue(Queues.FILE_PROCESSING, {
            type: "process_watermark",
            fileId: f.id,
            tenantId: req.tenantId,
            galleryId: gallery.id,
          }).catch(() => {});
        }
        app.log.info(
          { galleryId: gallery.id, count: files.length },
          "watermark jobs enqueued"
        );
      }

      // Welche Felder wurden eigentlich geändert? Nicht alles ist
      // Audit-würdig, aber das Set ist klein genug, dass wir's einfach
      // mitschreiben. Vermeidet späteres Raten "was hat sich geändert".
      const changedFields = Object.entries(body)
        .filter(([, v]) => v !== undefined)
        .map(([k]) => k);
      await logEvent({
        tenantId: req.tenantId,
        actorType: "user",
        actorId: s.user.id,
        action: "gallery.update",
        targetType: "gallery",
        targetId: gallery.id,
        payload: { fields: changedFields },
        ipAddress: req.ip,
      });

      if (goingLive) {
        await publishEvent({
          tenantId: req.tenantId,
          eventType: "gallery.live",
          payload: {
            galleryId: gallery.id,
            slug: existing.slug,
            title: gallery.title,
          },
        });
      }

      return { gallery };
    }
  );

  // -------------------------------------------------------------------------
  // DELETE /galleries/:id
  // -------------------------------------------------------------------------
  // Soft-Delete via status=archived ist auch sinnvoll, aber für jetzt:
  // Hard-Delete. S3-Aufräumen läuft als Worker-Job (TODO).
  app.delete<{ Params: { id: string } }>(
    "/galleries/:id",
    async (req, reply) => {
      const s = req.requireAuth();
      const existing = await prisma.gallery.findFirst({
        where: {
          id: req.params.id,
          tenantId: req.tenantId,
          ...galleryAccessWhere(s),
        },
        select: { id: true, slug: true },
      });
      if (!existing) return reply.status(404).send({ error: "not_found" });

      const tenantId = req.tenantId;
      await prisma.gallery.delete({ where: { id: existing.id } });

      await logEvent({
        tenantId,
        actorType: "user",
        actorId: s.user.id,
        action: "gallery.delete",
        targetType: "gallery",
        targetId: existing.id,
        payload: { slug: existing.slug },
        ipAddress: req.ip,
      });

      await publishEvent({
        tenantId,
        eventType: "gallery.deleted",
        payload: { galleryId: existing.id, slug: existing.slug },
      });

      // Worker-Job für S3-Cleanup queuen. DB-Cascade hat schon die
      // File-/Rendition-Rows entfernt, aber die zugehörigen S3-Objekte
      // bleiben sonst als Müll liegen. cleanup_gallery raeumt
      // t/<tenantId>/g/<galleryId>/ und t/<tenantId>/downloads/<galleryId>/.
      // Defensiv: enqueue-Fehler dürfen den DELETE nicht failen lassen
      // — die Galerie ist DB-seitig schon weg, das ist OK. Falls der
      // Cleanup-Job nicht enqueued wird, bleibt halt Müll liegen, was
      // wir spaeter manuell oder via Sweeper aufraeumen koennen.
      await enqueue(Queues.CLEANUP, {
        type: "cleanup_gallery",
        tenantId,
        galleryId: existing.id,
      }).catch((err) => {
        app.log.warn({ err, galleryId: existing.id },
                     "cleanup_gallery enqueue failed");
      });

      return reply.status(204).send();
    }
  );

  // -------------------------------------------------------------------------
  // Section-CRUD (Kapitel-Verwaltung pro Galerie)
  // -------------------------------------------------------------------------
  // Sections sind optionale Kapitel innerhalb einer Galerie. Eine
  // Section gehört genau einer Galerie; Files gehören optional einer
  // Section (sectionId null = im Default-Bucket der Galerie). Sortier-
  // Reihenfolge über sortIndex (kleinster oben).
  //
  // Routes:
  //   GET    /galleries/:id/sections                — alle Sections + File-Counts
  //   POST   /galleries/:id/sections                — neue Section anlegen
  //   PATCH  /galleries/:id/sections/:sectionId     — Section bearbeiten
  //   DELETE /galleries/:id/sections/:sectionId     — Section löschen
  //                                                   (Files fallen zurück in Default)
  //   POST   /galleries/:id/sections/reorder        — sortIndex-Bulk-Update
  //   POST   /galleries/:id/sections/:sectionId/files — Files zuweisen (bulk)
  //   DELETE /galleries/:id/sections/files          — sectionId von Files entfernen

  const sectionCreateSchema = z.object({
    title: z.string().min(1).max(120),
    description: z.string().max(400).nullable().optional(),
    coverFileId: z.string().uuid().nullable().optional(),
    // Smart-Section: wenn gesetzt wird die Section bei Erstellung
    // initial mit den Files mit diesem Tag befuellt.
    autoTagId: z.string().uuid().nullable().optional(),
  });

  const sectionUpdateSchema = z.object({
    title: z.string().min(1).max(120).optional(),
    description: z.string().max(400).nullable().optional(),
    coverFileId: z.string().uuid().nullable().optional(),
    sortIndex: z.number().int().min(0).max(10_000).optional(),
    // Tag-Verknuepfung aendern. null = aus Smart wird manuell. Setzen
    // triggert NICHT automatisch einen Sync — der Aufrufer muss
    // /sync explizit aufrufen. Begruendung: User soll bewusst entscheiden
    // wann der erste Sync laeuft (verschiebt potenziell viele Files).
    autoTagId: z.string().uuid().nullable().optional(),
  });

  const sectionReorderSchema = z.object({
    // Liste von Section-IDs in gewünschter Reihenfolge. Wir setzen
    // sortIndex = position * 10 (Lücken für künftige Insert-Operationen
    // ohne Full-Reorder).
    order: z.array(z.string().uuid()).min(1).max(100),
  });

  const sectionAssignSchema = z.object({
    fileIds: z.array(z.string().uuid()).min(1).max(500),
  });

  /** Helfer: prüft Ownership der Galerie und gibt die Galerie-ID
   *  zurück. Wenn der User nicht der Owner ist oder die Galerie nicht
   *  im aktuellen Tenant liegt, returnt null (Caller schickt 404). */
  async function findAccessibleGallery(req: FastifyRequest, galleryId: string) {
    const s = req.requireAuth();
    return prisma.gallery.findFirst({
      where: { id: galleryId, tenantId: req.tenantId, ...galleryAccessWhere(s) },
      select: { id: true },
    });
  }

  // GET /galleries/:id/sections
  app.get<{ Params: { id: string } }>(
    "/galleries/:id/sections",
    async (req, reply) => {
      const gallery = await findAccessibleGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const sections = await prisma.gallerySection.findMany({
        where: { galleryId: gallery.id },
        orderBy: { sortIndex: "asc" },
        select: {
          id: true,
          title: true,
          description: true,
          coverFileId: true,
          sortIndex: true,
          autoTagId: true,
          autoTag: {
            select: { id: true, name: true, color: true },
          },
          _count: { select: { files: true } },
        },
      });
      return {
        sections: sections.map((s) => ({
          id: s.id,
          title: s.title,
          description: s.description,
          coverFileId: s.coverFileId,
          sortIndex: s.sortIndex,
          fileCount: s._count.files,
          autoTagId: s.autoTagId,
          autoTag: s.autoTag,
        })),
      };
    }
  );

  // POST /galleries/:id/sections
  app.post<{ Params: { id: string } }>(
    "/galleries/:id/sections",
    async (req, reply) => {
      const gallery = await findAccessibleGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });
      const body = sectionCreateSchema.parse(req.body);

      // coverFileId muss zur selben Galerie gehören (anwendungsseitiger
      // Check, weil das Schema keinen Composite-Constraint hat).
      if (body.coverFileId) {
        const f = await prisma.file.findFirst({
          where: { id: body.coverFileId, galleryId: gallery.id },
          select: { id: true },
        });
        if (!f) return reply.status(400).send({ error: "invalid_cover_file" });
      }

      // autoTagId muss zum gleichen Tenant gehoeren — sonst koennte
      // ein User Sections auf fremde Tags binden.
      if (body.autoTagId) {
        const t = await prisma.tag.findFirst({
          where: { id: body.autoTagId, tenantId: req.tenantId },
          select: { id: true },
        });
        if (!t) return reply.status(400).send({ error: "invalid_auto_tag" });
      }

      // sortIndex auf max+10 setzen, damit neue Section ans Ende kommt
      const last = await prisma.gallerySection.findFirst({
        where: { galleryId: gallery.id },
        orderBy: { sortIndex: "desc" },
        select: { sortIndex: true },
      });
      const sortIndex = (last?.sortIndex ?? -10) + 10;

      const section = await prisma.gallerySection.create({
        data: {
          galleryId: gallery.id,
          title: body.title,
          description: body.description ?? null,
          coverFileId: body.coverFileId ?? null,
          autoTagId: body.autoTagId ?? null,
          sortIndex,
        },
      });
      return { section };
    }
  );

  // PATCH /galleries/:id/sections/:sectionId
  app.patch<{ Params: { id: string; sectionId: string } }>(
    "/galleries/:id/sections/:sectionId",
    async (req, reply) => {
      const gallery = await findAccessibleGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });
      const body = sectionUpdateSchema.parse(req.body);

      const section = await prisma.gallerySection.findFirst({
        where: { id: req.params.sectionId, galleryId: gallery.id },
        select: { id: true },
      });
      if (!section) return reply.status(404).send({ error: "not_found" });

      if (body.coverFileId) {
        const f = await prisma.file.findFirst({
          where: { id: body.coverFileId, galleryId: gallery.id },
          select: { id: true },
        });
        if (!f) return reply.status(400).send({ error: "invalid_cover_file" });
      }

      if (body.autoTagId) {
        const t = await prisma.tag.findFirst({
          where: { id: body.autoTagId, tenantId: req.tenantId },
          select: { id: true },
        });
        if (!t) return reply.status(400).send({ error: "invalid_auto_tag" });
      }

      const updated = await prisma.gallerySection.update({
        where: { id: section.id },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.description !== undefined
            ? { description: body.description }
            : {}),
          ...(body.coverFileId !== undefined
            ? { coverFileId: body.coverFileId }
            : {}),
          ...(body.sortIndex !== undefined ? { sortIndex: body.sortIndex } : {}),
          ...(body.autoTagId !== undefined
            ? { autoTagId: body.autoTagId }
            : {}),
        },
      });
      return { section: updated };
    }
  );

  // POST /galleries/:id/sections/:sectionId/sync
  // -------------------------------------------------------------------------
  // Smart-Section synchronisieren: alle Files mit dem auto-Tag bekommen
  // sectionId = section.id, alle Files die aktuell in der Section sind
  // aber den Tag NICHT haben werden auf sectionId = null zurueckgesetzt.
  //
  // Wirft 400 wenn die Section keinen autoTagId hat — Sync ist nur fuer
  // Smart-Sections sinnvoll.
  app.post<{ Params: { id: string; sectionId: string } }>(
    "/galleries/:id/sections/:sectionId/sync",
    async (req, reply) => {
      const gallery = await findAccessibleGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const section = await prisma.gallerySection.findFirst({
        where: { id: req.params.sectionId, galleryId: gallery.id },
        select: { id: true, autoTagId: true },
      });
      if (!section) return reply.status(404).send({ error: "not_found" });
      if (!section.autoTagId) {
        return reply.status(400).send({
          error: "not_a_smart_section",
          message: "Section hat keinen auto-Tag — Sync nur fuer Smart-Sections.",
        });
      }

      // Files mit dem Tag finden
      const matchingFiles = await prisma.file.findMany({
        where: {
          galleryId: gallery.id,
          tags: { some: { tagId: section.autoTagId } },
        },
        select: { id: true },
      });
      const matchingIds = matchingFiles.map((f) => f.id);

      // Atomisches Update via Transaction: erst alle aktuellen
      // Section-Files raus die NICHT mehr passen, dann die passenden
      // rein. Beide updateMany sind idempotent, aber wir vermeiden
      // einen Zwischenzustand 'leere Section'.
      const [removed, added] = await prisma.$transaction([
        prisma.file.updateMany({
          where: {
            galleryId: gallery.id,
            sectionId: section.id,
            id: matchingIds.length > 0 ? { notIn: matchingIds } : undefined,
          },
          data: { sectionId: null },
        }),
        prisma.file.updateMany({
          where: {
            galleryId: gallery.id,
            id: { in: matchingIds },
            // Nur Files updaten die NICHT schon in der Section sind —
            // sonst no-op aber irrelevant, updateMany ist trotzdem
            // O(matched) in der DB. Lassen wir's einfach laufen.
          },
          data: { sectionId: section.id },
        }),
      ]);

      return {
        ok: true,
        sectionId: section.id,
        added: added.count,
        removed: removed.count,
        totalNow: matchingIds.length,
      };
    }
  );

  // DELETE /galleries/:id/sections/:sectionId
  app.delete<{ Params: { id: string; sectionId: string } }>(
    "/galleries/:id/sections/:sectionId",
    async (req, reply) => {
      const gallery = await findAccessibleGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const section = await prisma.gallerySection.findFirst({
        where: { id: req.params.sectionId, galleryId: gallery.id },
        select: { id: true },
      });
      if (!section) return reply.status(404).send({ error: "not_found" });

      // ON DELETE SET NULL auf files.sectionId — Files fallen
      // automatisch in den Default-Bucket zurück.
      await prisma.gallerySection.delete({ where: { id: section.id } });
      return { ok: true };
    }
  );

  // POST /galleries/:id/sections/reorder
  app.post<{ Params: { id: string } }>(
    "/galleries/:id/sections/reorder",
    async (req, reply) => {
      const gallery = await findAccessibleGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });
      const body = sectionReorderSchema.parse(req.body);

      // Alle Sections der Galerie holen und gegen die übergebene Liste
      // matchen. Sections die nicht in der Reorder-Liste stehen, werden
      // ignoriert (kann passieren wenn der Studio-Client veraltete
      // Daten hat).
      const existing = await prisma.gallerySection.findMany({
        where: { galleryId: gallery.id },
        select: { id: true },
      });
      const known = new Set(existing.map((s) => s.id));

      // sortIndex = position * 10 — gibt Lücken für künftige Insertions
      // ohne dass wir alles neu nummerieren müssen.
      const updates = body.order
        .filter((id) => known.has(id))
        .map((id, idx) =>
          prisma.gallerySection.update({
            where: { id },
            data: { sortIndex: idx * 10 },
          })
        );
      await prisma.$transaction(updates);
      return { ok: true };
    }
  );

  // POST /galleries/:id/sections/:sectionId/files — Files in Section assignen
  app.post<{ Params: { id: string; sectionId: string } }>(
    "/galleries/:id/sections/:sectionId/files",
    async (req, reply) => {
      const gallery = await findAccessibleGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });
      const body = sectionAssignSchema.parse(req.body);

      const section = await prisma.gallerySection.findFirst({
        where: { id: req.params.sectionId, galleryId: gallery.id },
        select: { id: true },
      });
      if (!section) return reply.status(404).send({ error: "not_found" });

      // updateMany mit Filter auf galleryId — verhindert dass Files
      // anderer Galerien per ID-Manipulation eingehängt werden.
      const res = await prisma.file.updateMany({
        where: {
          id: { in: body.fileIds },
          galleryId: gallery.id,
        },
        data: { sectionId: section.id },
      });
      return { assigned: res.count };
    }
  );

  // DELETE /galleries/:id/sections/files — sectionId der gegebenen Files entfernen
  app.delete<{ Params: { id: string } }>(
    "/galleries/:id/sections/files",
    async (req, reply) => {
      const gallery = await findAccessibleGallery(req, req.params.id);
      if (!gallery) return reply.status(404).send({ error: "not_found" });
      const body = sectionAssignSchema.parse(req.body);

      const res = await prisma.file.updateMany({
        where: {
          id: { in: body.fileIds },
          galleryId: gallery.id,
        },
        data: { sectionId: null },
      });
      return { removed: res.count };
    }
  );

  // -------------------------------------------------------------------------
  // GET /galleries/:id/stats — Aggregierte Auswertungen für die Studio-UI
  // -------------------------------------------------------------------------
  // Liefert pro Galerie:
  //   - Visit-Counts pro Tag (letzte 30 Tage), basierend auf share.unlock-Events
  //   - Pro-Access-Aufschlüsselung (Visits, Likes, Kommentare)
  //   - Top-Files nach Like-Anzahl
  //   - Download-Aktivität (single + zip getrennt)
  //
  // Bewusst ALLES in eine Route — die UI zeigt die vier Sektionen
  // zusammen, ein Roundtrip statt vier ist freundlicher zum Backend
  // und vermeidet asynchrone UI-Glitches beim Re-Render. Die Queries
  // sind alle leicht (max ~30 Tage, max top-20 Files), insgesamt
  // sub-100ms.
  app.get<{ Params: { id: string } }>(
    "/galleries/:id/stats",
    async (req, reply) => {
      const s = req.requireAuth();
      const gallery = await prisma.gallery.findFirst({
        where: {
          id: req.params.id,
          tenantId: req.tenantId,
          ...galleryAccessWhere(s),
        },
        select: { id: true },
      });
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      // 1) Visits pro Tag (letzte 30 Tage). share.unlock ist der einzige
      //    Event, der zuverlässig pro Visitor pro 8h-Cookie-Window
      //    geloggt wird — also keine künstliche Inflation durch Reloads.
      //
      //    DATE_TRUNC liefert uns Tages-Buckets in der DB-Zeitzone (UTC).
      //    Für die UI tut's das — Datumsanzeige passt der Client an.
      const dailyVisits = await prisma.$queryRaw<
        Array<{ day: Date; count: bigint }>
      >`
        SELECT DATE_TRUNC('day', "createdAt") AS day, COUNT(*)::bigint AS count
        FROM events
        WHERE "tenantId" = ${req.tenantId}::uuid
          AND action = 'share.unlock'
          AND "targetType" = 'gallery'
          AND "targetId" = ${gallery.id}
          AND "createdAt" >= ${since}
        GROUP BY day
        ORDER BY day ASC
      `;

      // 2) Pro-Access-Aufschlüsselung. Anonyme Visitors (actorId=null)
      //    summieren wir in einen einzigen "Anonym"-Bucket — sonst hätte
      //    die UI eine endlose Liste namenloser Zeilen.
      const accesses = await prisma.galleryAccess.findMany({
        where: { galleryId: gallery.id },
        select: {
          id: true,
          label: true,
          finalizedAt: true,
          _count: {
            select: {
              selections: { where: { liked: true } },
              comments: true,
            },
          },
        },
      });

      // Visits pro Access (nochmal über Events, mit actorId-Group)
      const visitsByActor = await prisma.event.groupBy({
        by: ["actorId"],
        where: {
          tenantId: req.tenantId,
          action: "share.unlock",
          targetType: "gallery",
          targetId: gallery.id,
        },
        _count: true,
      });
      const visitsByAccessId = new Map<string, number>();
      let anonymousVisits = 0;
      for (const v of visitsByActor) {
        if (v.actorId) {
          visitsByAccessId.set(v.actorId, v._count);
        } else {
          anonymousVisits += v._count;
        }
      }

      const accessStats = accesses.map((a) => ({
        accessId: a.id,
        label: a.label,
        visits: visitsByAccessId.get(a.id) ?? 0,
        likes: a._count.selections,
        comments: a._count.comments,
        finalized: !!a.finalizedAt,
      }));

      // 3) Top-Files nach Like-Anzahl. Limit 20 — mehr wäre
      //    Schroteffekt-Liste, wenn der Photograph 5000 Files
      //    hochgeladen hat. Die UI bietet ggf. später "alle anzeigen".
      const topFiles = await prisma.selection.groupBy({
        by: ["fileId"],
        where: {
          liked: true,
          file: { galleryId: gallery.id },
        },
        _count: true,
        orderBy: { _count: { fileId: "desc" } },
        take: 20,
      });

      // Filenames für die Top-Files in einer Query nachholen statt N+1
      const topFileIds = topFiles.map((f) => f.fileId);
      const topFileMeta =
        topFileIds.length > 0
          ? await prisma.file.findMany({
              where: { id: { in: topFileIds } },
              select: {
                id: true,
                originalFilename: true,
                kind: true,
              },
            })
          : [];
      const fileMetaById = new Map(topFileMeta.map((f) => [f.id, f]));

      const topLikedFiles = topFiles
        .map((f) => {
          const meta = fileMetaById.get(f.fileId);
          if (!meta) return null;
          return {
            fileId: f.fileId,
            filename: meta.originalFilename,
            kind: meta.kind,
            likes: f._count,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      // 4) Downloads. Wir splitten in zip / single / rendition, weil
      //    das im Studio interessante Sub-Cuts sind (zip = "alle
      //    runtergeladen", single = "ein einzelnes Original",
      //    rendition = "Web-Variante" — letzteres wahrscheinlich
      //    geringer Erkenntnisgewinn, aber zur Vollständigkeit).
      const downloadsByKind = await prisma.downloadLog.groupBy({
        by: ["kind"],
        where: { galleryId: gallery.id },
        _count: true,
      });
      const downloadsTotal = downloadsByKind.reduce(
        (sum, d) => sum + d._count,
        0
      );

      const dailyDownloads = await prisma.$queryRaw<
        Array<{ day: Date; count: bigint }>
      >`
        SELECT DATE_TRUNC('day', "createdAt") AS day, COUNT(*)::bigint AS count
        FROM download_logs
        WHERE "galleryId" = ${gallery.id}::uuid
          AND "createdAt" >= ${since}
        GROUP BY day
        ORDER BY day ASC
      `;

      return {
        // Cast bigint → number; bei den Größenordnungen (max ein paar
        // 1000 visits/day) safe.
        dailyVisits: dailyVisits.map((r) => ({
          day: r.day.toISOString(),
          count: Number(r.count),
        })),
        anonymousVisits,
        accessStats,
        topLikedFiles,
        downloadsByKind: downloadsByKind.map((d) => ({
          kind: d.kind,
          count: d._count,
        })),
        downloadsTotal,
        dailyDownloads: dailyDownloads.map((r) => ({
          day: r.day.toISOString(),
          count: Number(r.count),
        })),
      };
    }
  );

  // -------------------------------------------------------------------------
  // GET /g/:slug — Kunden-Sicht, Meta + Gate-Info
  // -------------------------------------------------------------------------
  // Liefert nur das Minimum: Titel, Branding, ob Passwort/Token nötig.
  // Files kommen erst nach /unlock + gültigem Visitor-Cookie.
  app.get<{
    Params: { slug: string };
    Querystring: { t?: string };
  }>("/g/:slug", async (req, reply) => {
    const gallery = await prisma.gallery.findUnique({
      where: { slug: req.params.slug },
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        mode: true,
        status: true,
        downloadEnabled: true,
        downloadOriginalsEnabled: true,
        watermarkEnabled: true,
        commentsEnabled: true,
        ratingsEnabled: true,
        customerTagFilterEnabled: true,
        selectionLimit: true,
        passwordHash: true,
        publicAccess: true,
        expiresAt: true,
        tenantId: true,
        brandingId: true,
        // Header-Customization
        heroFileId: true,
        heroUrl: true,
        heroOverlayColor: true,
        heroOverlayBlur: true,
        heroBackgroundColor: true,
        eventLogoUrl: true,
        eventLogoSize: true,
        welcomeMarkdown: true,
        heroLayout: true,
        footerMarkdown: true,
        colorBackground: true,
        colorAccent: true,
        fontHeading: true,
        fontBody: true,
        gridLayout: true,
        slideshowTransition: true,
        slideshowAudioUrl: true,
        tenant: { select: { status: true } },
      },
    });
    if (!gallery || gallery.status !== "live") {
      return reply.status(404).send({ error: "not_found" });
    }
    if (!isTenantOperational(gallery.tenant.status)) {
      return reply
        .status(503)
        .send({ error: "tenant_unavailable" });
    }
    if (gallery.expiresAt && gallery.expiresAt < new Date()) {
      return reply.status(410).send({ error: "expired" });
    }

    // Prüfen, ob das Visitor-Cookie schon einen gültigen Zugang gibt
    // (auto-unlock bei erneutem Aufruf). Konsistent zu loadVisitor:
    // Link-Ablauf und publicAccess werden berücksichtigt.
    const cookieName = visitorCookieName(gallery.id);
    const cookie = req.cookies?.[cookieName];
    let unlocked = false;
    if (cookie) {
      const claims = verifyVisitorToken(cookie);
      if (claims && claims.gid === gallery.id) {
        if (claims.aid) {
          const access = await prisma.galleryAccess.findUnique({
            where: { id: claims.aid },
            select: {
              expiresAt: true,
              galleryId: true,
              passwordHash: true,
            },
          });
          const linkValid =
            access &&
            access.galleryId === gallery.id &&
            (access.expiresAt === null || access.expiresAt >= new Date());
          if (linkValid) {
            // Token-Inhaber: Galerie-Passwort gilt nicht, nur ein
            // eigenes Link-Passwort (falls gesetzt, gegen aktuellen Stand).
            unlocked = cookiePasswordOk(access?.passwordHash, claims);
          } else {
            // Link ungültig → wie anonym behandeln.
            unlocked =
              gallery.publicAccess &&
              cookiePasswordOk(gallery.passwordHash, claims);
          }
        } else {
          // Anonymes Cookie: Galerie-Passwort + publicAccess gelten.
          unlocked =
            gallery.publicAccess &&
            cookiePasswordOk(gallery.passwordHash, claims);
        }
      }
    }

    const branding = await resolveGalleryBranding({
      galleryBrandingId: gallery.brandingId,
      tenantId: gallery.tenantId,
    });

    // Hero-File auflösen: wenn heroFileId gesetzt, geben wir einen
    // Presigned-URL zur Web-Rendition zurück. Bevorzugt web_jpeg
    // (kunden-freundliches Format), fallback web (webp).
    let heroFileUrl: string | null = null;
    if (gallery.heroFileId) {
      const heroFile = await prisma.file.findFirst({
        where: { id: gallery.heroFileId, galleryId: gallery.id },
        select: {
          id: true,
          renditions: {
            where: { kind: { in: ["web_jpeg", "web"] } },
            select: { kind: true, storageKey: true },
          },
        },
      });
      if (heroFile && heroFile.renditions.length > 0) {
        // web_jpeg zuerst, sonst web. Beide werden hier akzeptiert,
        // damit Galerien aus der Zeit vor web_jpeg auch funktionieren.
        const r =
          heroFile.renditions.find((x) => x.kind === "web_jpeg") ??
          heroFile.renditions[0];
        heroFileUrl = await presignGet({ key: r.storageKey });
      }
    }

    // Asset-URLs für Hero-Upload und Logo: voller API-Pfad inkl.
    // /api/v1/-Prefix, damit Frontend (das den Wert direkt in <img src>
    // setzt) ohne weitere URL-Manipulation lädt. Wir verwenden den
    // gleichen Same-Origin-Pfad wie Frontend-fetch — kein NEXT_PUBLIC-
    // Resolving nötig.
    //
    // Cache-Buster (?v=<hash>): die Asset-Route schickt
    // Cache-Control: max-age=300, weil mehrfaches Aufrufen des
    // gleichen Hero/Logo nicht jedes Mal eine neue Signatur braucht.
    // Aber: wenn das Studio einen NEUEN Hero hochlädt, ändert sich
    // der Storage-Key. Damit der Customer-Browser nicht 5 Minuten
    // das alte Bild aus seinem Cache zeigt, hängen wir einen kurzen
    // Hash des Storage-Keys an die URL — wechselt der Key, wechselt
    // der URL, und der Browser holt das neue Bild sofort.
    const cacheBust = (key: string) =>
      "?v=" + createHash("sha1").update(key).digest("hex").slice(0, 8);
    const heroUploadUrl = gallery.heroUrl
      ? `/api/v1/g/${gallery.slug}/assets/hero${cacheBust(gallery.heroUrl)}`
      : null;
    const eventLogoPublicUrl = gallery.eventLogoUrl
      ? `/api/v1/g/${gallery.slug}/assets/logo${cacheBust(gallery.eventLogoUrl)}`
      : null;
    const slideshowAudioPublicUrl = gallery.slideshowAudioUrl
      ? `/api/v1/g/${gallery.slug}/assets/audio${cacheBust(gallery.slideshowAudioUrl)}`
      : null;

    // Sections (Kapitel) der Galerie. Wenn keine Sections angelegt
    // sind, returnen wir ein leeres Array — das Frontend rendert
    // dann den klassischen Hauptraster-Modus. Cover-File-Thumb wird
    // mit signiertem URL durchgereicht, damit das Customer-View
    // Section-Header mit Bildern rendern kann.
    const sectionRows = await prisma.gallerySection.findMany({
      where: { galleryId: gallery.id },
      orderBy: { sortIndex: "asc" },
      select: {
        id: true,
        title: true,
        description: true,
        coverFileId: true,
        sortIndex: true,
      },
    });
    // Cover-Thumb-URLs für alle Cover-File-IDs vorab in einer
    // Query holen, dann pro Section zuordnen — vermeidet N+1.
    const coverFileIds = sectionRows
      .map((s) => s.coverFileId)
      .filter((id): id is string => !!id);
    let coverThumbByFileId = new Map<string, string>();
    if (coverFileIds.length > 0) {
      const covers = await prisma.file.findMany({
        where: { id: { in: coverFileIds }, galleryId: gallery.id },
        select: {
          id: true,
          renditions: {
            where: { kind: "thumb" },
            select: { storageKey: true },
            take: 1,
          },
        },
      });
      for (const c of covers) {
        const thumb = c.renditions[0];
        if (thumb) {
          coverThumbByFileId.set(
            c.id,
            await presignGet({ key: thumb.storageKey })
          );
        }
      }
    }
    const sections = sectionRows.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      coverThumbUrl: s.coverFileId
        ? coverThumbByFileId.get(s.coverFileId) ?? null
        : null,
      sortIndex: s.sortIndex,
    }));

    return {
      gallery: {
        id: gallery.id,
        slug: gallery.slug,
        title: gallery.title,
        description: gallery.description,
        mode: gallery.mode,
        downloadEnabled: gallery.downloadEnabled,
        downloadOriginalsEnabled: gallery.downloadOriginalsEnabled,
        watermarkEnabled: gallery.watermarkEnabled,
        commentsEnabled: gallery.commentsEnabled,
        ratingsEnabled: gallery.ratingsEnabled,
        customerTagFilterEnabled: gallery.customerTagFilterEnabled,
        selectionLimit: gallery.selectionLimit,
        requiresPassword: !!gallery.passwordHash,
        publicAccess: gallery.publicAccess,
        unlocked,
        branding,
        // Header-Customization durchreichen
        header: {
          // Render-Variante: minimal | splash | side_by_side | centered
          layout: gallery.heroLayout,
          // heroImageUrl: relativer URL zum Bild (entweder File-Rendition
          // oder Upload-Asset) — Frontend baut mit api-base zusammen.
          heroImageUrl: heroFileUrl ?? heroUploadUrl,
          overlayColor: gallery.heroOverlayColor,
          overlayBlur: gallery.heroOverlayBlur,
          backgroundColor: gallery.heroBackgroundColor,
          eventLogoUrl: eventLogoPublicUrl,
          eventLogoSize: gallery.eventLogoSize,
          welcomeMarkdown: gallery.welcomeMarkdown,
        },
        // Footer + Galerie-Farben überschreiben Branding-Werte nur
        // für diese Galerie. null bedeutet "kein Override → Branding
        // gewinnt".
        footerMarkdown: gallery.footerMarkdown,
        colors: {
          background: gallery.colorBackground,
          accent: gallery.colorAccent,
        },
        fonts: {
          heading: gallery.fontHeading,
          body: gallery.fontBody,
        },
        gridLayout: gallery.gridLayout,
        slideshowTransition: gallery.slideshowTransition,
        slideshowAudioUrl: slideshowAudioPublicUrl,
        sections,
      },
    };
  });

  // -------------------------------------------------------------------------
  // POST /g/:slug/unlock — Passwort/Token einlösen
  // -------------------------------------------------------------------------
  app.post<{
    Params: { slug: string };
    Body: { password?: string; token?: string };
  }>(
    "/g/:slug/unlock",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const body = unlockSchema.parse(req.body);
      const gallery = await prisma.gallery.findUnique({
        where: { slug: req.params.slug },
        select: {
          id: true,
          tenantId: true,
          status: true,
          expiresAt: true,
          passwordHash: true,
          publicAccess: true,
        },
      });
      if (!gallery || gallery.status !== "live") {
        return reply.status(404).send({ error: "not_found" });
      }
      if (gallery.expiresAt && gallery.expiresAt < new Date()) {
        return reply.status(410).send({ error: "expired" });
      }

      // 1. Token zuerst auflösen — wir brauchen ggf. das Link-Passwort,
      //    bevor wir entscheiden, welches Passwort gilt.
      let accessId: string | null = null;
      let linkPasswordHash: string | null = null;
      if (body.token) {
        const access = await prisma.galleryAccess.findUnique({
          where: { token: body.token },
          select: {
            id: true,
            galleryId: true,
            expiresAt: true,
            passwordHash: true,
          },
        });
        if (access && access.galleryId === gallery.id) {
          // Token gehört zur Galerie. Abgelaufen → klare Meldung
          // (kein Enumeration-Risiko, der Token war ja gültig).
          if (access.expiresAt && access.expiresAt < new Date()) {
            return reply.status(410).send({ error: "link_expired" });
          }
          accessId = access.id;
          linkPasswordHash = access.passwordHash;
          // Audit-Count + last-access aktualisieren
          await prisma.galleryAccess
            .update({
              where: { id: access.id },
              data: {
                lastAccessAt: new Date(),
                accessCount: { increment: 1 },
              },
            })
            .catch(() => {});
        }
        // Fremder/ungültiger Token → kein Fehler, als anonym behandeln.
        // Das verhindert Token-Enumeration: jeder Versuch sieht aus wie
        // ein normaler Visitor-Aufruf.
      }

      // 2. Nicht-öffentliche Galerie: Ohne gültigen Freigabe-Link kein
      //    Zugang (der nackte Slug-Link reicht nicht).
      if (!gallery.publicAccess && !accessId) {
        return reply.status(403).send({ error: "access_required" });
      }

      // 3. Passwort prüfen. Ein gültiger Freigabe-Link umgeht das
      //    Galerie-Passwort (der Token ist bereits der Ausweis) — nur
      //    ein eigenes Link-Passwort gilt dann. Anonyme Besucher
      //    brauchen das Galerie-Passwort.
      const requiredHash = accessId ? linkPasswordHash : gallery.passwordHash;
      let passwordOk = !requiredHash;
      if (requiredHash) {
        if (!body.password) {
          return reply.status(401).send({ error: "password_required" });
        }
        passwordOk = await verifyPassword(requiredHash, body.password);
        if (!passwordOk) {
          await logEvent({
            tenantId: gallery.tenantId,
            actorType: "system",
            action: "share.unlock.failed",
            targetType: "gallery",
            targetId: gallery.id,
            payload: { reason: "bad_password" },
            ipAddress: req.ip,
          });
          return reply.status(401).send({ error: "invalid_password" });
        }
      }

      // Visitor-Cookie setzen. pwfp = Fingerabdruck des freigeschalteten
      // Passworts, damit eine spätere Passwort-Änderung das Cookie
      // ungültig macht.
      const token = createVisitorToken({
        gid: gallery.id,
        aid: accessId,
        pw: passwordOk,
        pwfp: requiredHash ? passwordFingerprint(requiredHash) : null,
      });
      reply.setCookie(visitorCookieName(gallery.id), token, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: req.protocol === "https",
        maxAge: 8 * 60 * 60, // 8h
      });

      await logEvent({
        tenantId: gallery.tenantId,
        actorType: accessId ? "access" : "system",
        actorId: accessId,
        action: "share.unlock",
        targetType: "gallery",
        targetId: gallery.id,
        payload: { hasAccessToken: !!accessId, hasPassword: !!gallery.passwordHash },
        ipAddress: req.ip,
      });

      return { ok: true, hasAccessToken: !!accessId };
    }
  );

  // -------------------------------------------------------------------------
  // GET /g/:slug/files — Files mit signierten Preview-URLs
  // -------------------------------------------------------------------------
  app.get<{ Params: { slug: string } }>(
    "/g/:slug/files",
    async (req, reply) => {
      const visitor = await loadVisitor(req);
      if (!visitor) {
        return reply
          .status(401)
          .send({ error: "unlock_required" });
      }

      const files = await prisma.file.findMany({
        where: {
          galleryId: visitor.galleryId,
          status: "ready",
          // Pending-Approval-Files (hochgeladen via UploadLink, vom
          // Studio-User noch nicht freigegeben) bleiben aus der
          // Customer-Galerie raus. Studio sieht sie weiterhin.
          publicVisibility: "visible",
        },
        orderBy: { sortIndex: "asc" },
        select: {
          id: true,
          originalFilename: true,
          mimeType: true,
          sizeBytes: true,
          kind: true,
          width: true,
          height: true,
          pageCount: true,
          sortIndex: true,
          sectionId: true,
          takenAt: true,
          renditions: {
            select: {
              kind: true,
              storageKey: true,
              width: true,
              height: true,
              metadata: true,
              page: true,
            },
          },
        },
      });

      const galleryRow = await prisma.gallery.findUnique({
        where: { id: visitor.galleryId },
        select: {
          watermarkEnabled: true,
          downloadEnabled: true,
          customerTagFilterEnabled: true,
        },
      });
      // Watermark wird ausgeliefert, wenn watermarkEnabled UND der Kunde
      // sowieso keinen Download bekommt (sonst hätten sie das Original).
      const useWatermark =
        !!galleryRow?.watermarkEnabled && !galleryRow?.downloadEnabled;
      // Tags nur durchreichen wenn der Studio das pro Galerie aktiviert
      // hat. Sonst bleiben FileTag-Joins komplett aus der Customer-Antwort
      // — auch wenn der File welche hat. Default: privacy by default.
      const tagMap = new Map<string, Array<{ id: string; name: string; color: string }>>();
      if (galleryRow?.customerTagFilterEnabled) {
        const tagRows = await prisma.fileTag.findMany({
          where: { fileId: { in: files.map((f) => f.id) } },
          select: {
            fileId: true,
            tag: { select: { id: true, name: true, color: true } },
          },
        });
        for (const r of tagRows) {
          const arr = tagMap.get(r.fileId) ?? [];
          arr.push(r.tag);
          tagMap.set(r.fileId, arr);
        }
      }

      // Signed URLs für thumb + preview + web. Wenn Watermark aktiv ist
      // und eine watermarked-Rendition existiert, ersetzen wir die
      // preview-/web-URLs durch deren signierten Pfad.
      const items = await Promise.all(
        files.map(async (f) => {
          const thumb = f.renditions.find(
            (r) => r.kind === "thumb" && r.page === 0
          );
          const preview = f.renditions.find(
            (r) => r.kind === "preview" && r.page === 0
          );
          const web = f.renditions.find(
            (r) => r.kind === "web" && r.page === 0
          );
          const watermarked = f.renditions.find((r) => r.kind === "watermarked");
          const hls = f.renditions.find((r) => r.kind === "hls");
          const sprite = f.renditions.find((r) => r.kind === "sprite");

          const hlsUrl = hls
            ? `/api/v1/g/${req.params.slug}/files/${f.id}/hls/master.m3u8`
            : null;

          // Lightbox-Quelle: watermarked > web > preview
          const lightboxRendition =
            useWatermark && watermarked ? watermarked : web ?? preview;
          const previewRendition =
            useWatermark && watermarked ? watermarked : preview;

          // Sprite-Sheet zum Scrubbing — nur bei Videos, nur wenn der
          // Worker das tatsächlich erstellt hat (kurze Videos haben keins).
          const spritePayload =
            f.kind === "video" && sprite && sprite.metadata
              ? {
                  url: await presignGet({ key: sprite.storageKey }),
                  ...(sprite.metadata as {
                    interval: number;
                    cols: number;
                    rows: number;
                    tileWidth: number;
                    tileHeight: number;
                    frames: number;
                  }),
                }
              : null;

          const pages =
            f.pageCount && f.pageCount > 1
              ? await Promise.all(
                  Array.from({ length: f.pageCount }, async (_, p) => {
                    const pt = f.renditions.find(
                      (r) => r.kind === "thumb" && r.page === p
                    );
                    const pw =
                      f.renditions.find(
                        (r) => r.kind === "web" && r.page === p
                      ) ??
                      f.renditions.find(
                        (r) => r.kind === "preview" && r.page === p
                      );
                    return {
                      page: p,
                      thumbUrl: pt
                        ? await presignGet({ key: pt.storageKey })
                        : null,
                      webUrl: pw
                        ? await presignGet({ key: pw.storageKey })
                        : null,
                    };
                  })
                )
              : undefined;
          return {
            id: f.id,
            filename: f.originalFilename,
            mimeType: f.mimeType,
            sizeBytes: Number(f.sizeBytes),
            kind: f.kind,
            width: f.width,
            height: f.height,
            sectionId: f.sectionId,
            // Aufnahmezeitpunkt aus EXIF (oder null, wenn keine EXIF-Daten /
            // noch nicht extrahiert). Nur fürs kundenseitige Sortieren nach
            // Aufnahmedatum — beeinflusst die gespeicherte Reihenfolge nicht.
            takenAt: f.takenAt ? f.takenAt.toISOString() : null,
            thumbUrl: thumb
              ? await presignGet({ key: thumb.storageKey })
              : null,
            previewUrl: previewRendition
              ? await presignGet({ key: previewRendition.storageKey })
              : null,
            webUrl: lightboxRendition
              ? await presignGet({ key: lightboxRendition.storageKey })
              : null,
            hlsUrl,
            sprite: spritePayload,
            pageCount: f.pageCount,
            pages,
            previewWidth: preview?.width ?? null,
            previewHeight: preview?.height ?? null,
            // Tags nur wenn customerTagFilterEnabled — sonst leer/undefined.
            // Frontend pruefe customerTagFilterEnabled aus dem Gallery-
            // Endpoint und rendert die Filter-Bar nur entsprechend.
            tags: tagMap.get(f.id) ?? [],
          };
        })
      );

      // Auswahl + Kommentare des aktuellen Visitors mitliefern, damit
      // das Frontend den State direkt anzeigen kann (Like, Color, Rating).
      let mySelections: Record<
        string,
        { color: string | null; rating: number | null; liked: boolean }
      > = {};
      let finalizedAt: Date | null = null;
      // canSelect signalisiert dem Frontend, ob es Auswahl-UI überhaupt
      // anzeigen soll. False für anonyme Visitor (kein Access-Token) oder
      // wenn der Access-Token zwar gültig, aber `canSelect=false` im
      // GalleryAccess-Eintrag gesetzt ist (z.B. nur-Anschauen-Link). Ohne
      // dieses Flag wäre ein Like-Klick eine 403-Falle und der Kunde
      // wüsste nicht warum nichts gespeichert wird — siehe Bugreport
      // "Markierungen verschwinden nach Reload".
      let canSelect = false;
      if (visitor.accessId) {
        const selections = await prisma.selection.findMany({
          where: { accessId: visitor.accessId },
          select: { fileId: true, color: true, rating: true, liked: true },
        });
        mySelections = Object.fromEntries(
          selections.map((s) => [
            s.fileId,
            { color: s.color, rating: s.rating, liked: s.liked },
          ])
        );
        const access = await prisma.galleryAccess.findUnique({
          where: { id: visitor.accessId },
          select: { finalizedAt: true, canSelect: true },
        });
        finalizedAt = access?.finalizedAt ?? null;
        canSelect = access?.canSelect ?? false;
      }

      return { files: items, mySelections, finalizedAt, canSelect };
    }
  );

  // -------------------------------------------------------------------------
  // GET /g/:slug/files/:fileId/download?variant=original|web
  // -------------------------------------------------------------------------
  // Kunden-Download eines einzelnen Files. Variant entscheidet, ob das
  // Original oder die Web-Rendition (2560px webp) ausgeliefert wird.
  // Default "original" wegen Rückwärtskompatibilität — alter UI-Code
  // ohne ?variant-Param funktioniert weiter, sofern downloadOriginalsEnabled.
  app.get<{
    Params: { slug: string; fileId: string };
    Querystring: { variant?: string };
  }>(
    "/g/:slug/files/:fileId/download",
    async (req, reply) => {
      const visitor = await loadVisitor(req);
      if (!visitor) {
        return reply
          .status(401)
          .send({ error: "unlock_required" });
      }

      const gallery = await prisma.gallery.findUnique({
        where: { id: visitor.galleryId },
        select: {
          id: true,
          downloadEnabled: true,
          downloadOriginalsEnabled: true,
          tenantId: true,
        },
      });
      if (!gallery || !gallery.downloadEnabled) {
        return reply.status(403).send({ error: "downloads_disabled" });
      }

      // Pro-Link-Recht: Wer über einen Freigabe-Link kommt, darf nur
      // herunterladen, wenn dieser Link canDownload=true hat. Anonyme
      // Besucher gehen über den galerieweiten Schalter (oben).
      if (visitor.accessId) {
        const access = await prisma.galleryAccess.findUnique({
          where: { id: visitor.accessId },
          select: { canDownload: true },
        });
        if (!access?.canDownload) {
          return reply.status(403).send({ error: "downloads_disabled" });
        }
      }

      const variant: "original" | "web" =
        req.query.variant === "web" ? "web" : "original";
      if (variant === "original" && !gallery.downloadOriginalsEnabled) {
        return reply.status(403).send({ error: "originals_disabled" });
      }

      const file = await prisma.file.findFirst({
        where: { id: req.params.fileId, galleryId: gallery.id },
        select: {
          id: true,
          kind: true,
          storageKey: true,
          originalFilename: true,
          mimeType: true,
          sizeBytes: true,
          renditions: {
            // Bei Bildern: web_jpeg/web (JPEG/WebP-Großformat).
            // Bei Videos: video_mp4 (standalone Web-MP4).
            // Wir holen alle drei, wählen unten je nach file.kind.
            where: { kind: { in: ["web_jpeg", "web", "video_mp4"] } },
            select: { kind: true, storageKey: true, format: true },
          },
        },
      });
      if (!file) return reply.status(404).send({ error: "not_found" });

      // Storage-Key + Dateiname je nach Variant über den geteilten
      // Resolver (siehe resolveDownloadTarget oben). Bei "web" hängt der
      // Resolver _web ans Filename und passt die Extension an das gelieferte
      // Format an — damit klar ist, was der Kunde bekommt, und damit es nicht
      // die Original-Datei im Download-Ordner überschreibt.
      const target = resolveDownloadTarget(
        file,
        variant,
        gallery.downloadOriginalsEnabled
      );
      if (!target.ok) {
        return reply.status(target.status).send({ error: target.error });
      }
      const { storageKey, filename: downloadFilename, bytes } = target;

      const url = await presignGet({
        key: storageKey,
        responseContentDisposition: `attachment; filename="${encodeURIComponent(
          downloadFilename
        )}"`,
      });

      // Audit — wir loggen den Variant nicht extra (würde DownloadLog-Schema
      // erweitern); kind=single bleibt wie bisher
      await prisma.downloadLog
        .create({
          data: {
            galleryId: gallery.id,
            fileId: file.id,
            kind: "single",
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]?.slice(0, 500) ?? null,
            bytes,
          },
        })
        .catch(() => {});

      return reply.redirect(url);
    }
  );

  // ---------------------------------------------------------------------------
  // GET /g/:slug/files/:fileId/blob?variant=original|web
  // ---------------------------------------------------------------------------
  // Wie /download, aber die API streamt die Bytes SELBST zurück (200 statt
  // 302-Redirect auf eine presigned Storage-URL). Gebraucht für den Web-Share-
  // Flow auf iOS: dort lädt das Frontend die Datei per fetch() und reicht sie
  // an navigator.share({ files }) weiter, damit der Kunde sie über das native
  // Teilen-Sheet direkt in die Foto-App sichern kann (statt in "Dateien").
  //
  // Ein cross-origin-fetch auf die presigned Storage-URL scheitert mangels
  // CORS-Header am Bucket — deshalb dieser Proxy über die API, die bereits
  // CORS für die Frontend-Origin macht. Bewusst NUR für Einzeldateien; ZIPs
  // laufen weiter über den presigned Redirect.
  //
  // Permission-Checks sind identisch zum /download-Endpoint.
  app.get<{
    Params: { slug: string; fileId: string };
    Querystring: { variant?: string };
  }>(
    "/g/:slug/files/:fileId/blob",
    async (req, reply) => {
      const visitor = await loadVisitor(req);
      if (!visitor) {
        return reply.status(401).send({ error: "unlock_required" });
      }

      const gallery = await prisma.gallery.findUnique({
        where: { id: visitor.galleryId },
        select: {
          id: true,
          downloadEnabled: true,
          downloadOriginalsEnabled: true,
          tenantId: true,
        },
      });
      if (!gallery || !gallery.downloadEnabled) {
        return reply.status(403).send({ error: "downloads_disabled" });
      }

      if (visitor.accessId) {
        const access = await prisma.galleryAccess.findUnique({
          where: { id: visitor.accessId },
          select: { canDownload: true },
        });
        if (!access?.canDownload) {
          return reply.status(403).send({ error: "downloads_disabled" });
        }
      }

      const variant: "original" | "web" =
        req.query.variant === "web" ? "web" : "original";
      if (variant === "original" && !gallery.downloadOriginalsEnabled) {
        return reply.status(403).send({ error: "originals_disabled" });
      }

      const file = await prisma.file.findFirst({
        where: { id: req.params.fileId, galleryId: gallery.id },
        select: {
          id: true,
          kind: true,
          storageKey: true,
          originalFilename: true,
          mimeType: true,
          sizeBytes: true,
          renditions: {
            where: { kind: { in: ["web_jpeg", "web", "video_mp4"] } },
            select: { kind: true, storageKey: true, format: true },
          },
        },
      });
      if (!file) return reply.status(404).send({ error: "not_found" });

      const target = resolveDownloadTarget(
        file,
        variant,
        gallery.downloadOriginalsEnabled
      );
      if (!target.ok) {
        return reply.status(target.status).send({ error: target.error });
      }

      let obj: Awaited<ReturnType<typeof getObjectStream>>;
      try {
        obj = await getObjectStream(target.storageKey);
      } catch (err) {
        req.log.error({ err, key: target.storageKey }, "blob stream failed");
        return reply.status(502).send({ error: "storage_unavailable" });
      }

      // Audit — analog zum /download-Endpoint als single zählen. Auf iOS wird
      // NUR dieser Endpoint getroffen (kein zusätzlicher /download), also kein
      // Doppelzählen.
      await prisma.downloadLog
        .create({
          data: {
            galleryId: gallery.id,
            fileId: file.id,
            kind: "single",
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]?.slice(0, 500) ?? null,
            bytes: target.bytes,
          },
        })
        .catch(() => {});

      reply.header("Content-Type", obj.contentType || target.contentType);
      // inline statt attachment: der Browser soll die Bytes lesen (fetch),
      // nicht als Datei-Download erzwingen. Für den Web-Share-Flow irrelevant,
      // aber semantisch korrekt.
      reply.header(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(target.filename)}"`
      );
      if (obj.contentLength) {
        reply.header("Content-Length", String(obj.contentLength));
      }
      // Privat cachen — presigned-frei, aber Inhalt ist kundenspezifisch.
      reply.header("Cache-Control", "private, max-age=0, no-store");
      return reply.send(obj.body);
    }
  );

  // ---------------------------------------------------------------------------
  // POST /galleries/:id/assets/presign — Logo / Hero-Upload vorbereiten
  // ---------------------------------------------------------------------------
  // Studio-Client uploadet Header-Assets (Event-Logo, Hero-Bild) UND
  // optional Slideshow-Musik direkt zu S3. Diese Route gibt eine
  // kurzlebige PUT-URL zurück und den späteren Storage-Key, den der
  // Client beim PATCH der Galerie als eventLogoUrl/heroUrl/
  // slideshowAudioUrl einträgt.
  //
  // Limits:
  //   logo, hero  → image/*, max 10 MB
  //   audio       → audio/*, max 30 MB (3-5 min MP3 ist meist <10 MB,
  //                 längere Tracks knapp drüber)
  app.post<{
    Params: { id: string };
    Body: {
      kind: "logo" | "hero" | "audio";
      contentType: string;
      contentLength?: number;
    };
  }>("/galleries/:id/assets/presign", async (req, reply) => {
    const s = req.requireAuth();

    const schema = z.object({
      kind: z.enum(["logo", "hero", "audio"]),
      contentType: z.string().min(1).max(100),
      contentLength: z.number().int().positive().optional(),
    });
    const body = schema.parse(req.body);

    // Pro Asset-Kind separate Validation. Wir machen das hier statt
    // im zod-Schema, damit die Fehlermeldung passt ("audio darf bis
    // 30 MB" vs "image bis 10 MB").
    if (body.kind === "audio") {
      if (!/^audio\//.test(body.contentType)) {
        return reply.status(400).send({ error: "must be audio/*" });
      }
      if (body.contentLength && body.contentLength > 30 * 1024 * 1024) {
        return reply.status(400).send({ error: "audio too large (max 30 MB)" });
      }
    } else {
      if (!/^image\//.test(body.contentType)) {
        return reply.status(400).send({ error: "must be image/*" });
      }
      if (body.contentLength && body.contentLength > 10 * 1024 * 1024) {
        return reply.status(400).send({ error: "image too large (max 10 MB)" });
      }
    }

    const gallery = await prisma.gallery.findFirst({
      where: {
        id: req.params.id,
        tenantId: req.tenantId,
        ...galleryAccessWhere(s),
      },
      select: { id: true, tenantId: true },
    });
    if (!gallery) return reply.status(404).send({ error: "not_found" });

    // Storage-Key-Schema:
    //   t/<tenant>/galleries/<gallery>/assets/<kind>-<rand>.<ext>
    // Die Random-Komponente verhindert Browser-Cache-Probleme nach
    // Re-Upload (alte URL ist tot, neue lebt — kein "alter Cache zeigt
    // altes Logo"-Effekt).
    const ext = body.contentType.split("/")[1]?.split("+")[0] ?? "bin";
    const rand = randomBytes(8).toString("hex");
    const storageKey = `t/${gallery.tenantId}/galleries/${gallery.id}/assets/${body.kind}-${rand}.${ext}`;

    const uploadUrl = await presignPut({
      key: storageKey,
      contentType: body.contentType,
      contentLength: body.contentLength,
      ttlSeconds: 900, // 15 Minuten
    });

    return {
      uploadUrl,
      storageKey,
    };
  });

  // ---------------------------------------------------------------------------
  // GET /g/:slug/assets/:kind — Customer-Asset abrufen (Logo / Hero-Upload)
  // ---------------------------------------------------------------------------
  // Public-Endpoint für Header-Assets, die NICHT aus der File-Tabelle
  // kommen (also: Event-Logo + Hero-Upload). Hero-aus-Galerie nutzt
  // weiter den File-Rendition-Pfad.
  //
  // Liefert einen Redirect auf eine kurzlebige Presigned-GET-URL. Wir
  // signieren nicht den storageKey direkt zum Public-Cache, damit
  // wir später Asset-Caching/CDN dazwischenschalten können ohne die
  // Customer-URLs zu ändern.
  app.get<{ Params: { slug: string; kind: "logo" | "hero" | "audio" } }>(
    "/g/:slug/assets/:kind",
    async (req, reply) => {
      const gallery = await prisma.gallery.findUnique({
        where: { slug: req.params.slug },
        select: {
          status: true,
          eventLogoUrl: true,
          eventLogoSize: true,
          heroUrl: true,
          slideshowAudioUrl: true,
          tenant: { select: { status: true } },
        },
      });
      if (!gallery || gallery.status !== "live") {
        return reply.status(404).send({ error: "not_found" });
      }
      if (!isTenantOperational(gallery.tenant.status)) {
        return reply.status(503).send({ error: "tenant_unavailable" });
      }

      const key =
        req.params.kind === "logo"
          ? gallery.eventLogoUrl
          : req.params.kind === "hero"
          ? gallery.heroUrl
          : req.params.kind === "audio"
          ? gallery.slideshowAudioUrl
          : null;
      if (!key) return reply.status(404).send({ error: "not_set" });

      // Wenn ein absoluter URL drinsteht (z.B. CDN), direkt durchreichen.
      // Sonst S3-Key → presignen.
      if (/^https?:\/\//.test(key)) {
        return reply.redirect(key);
      }

      const url = await presignGet({
        key,
        ttlSeconds: 60 * 15, // 15 Min reicht für Page-Load + Asset-Time
      });
      // Browser-Cache: Asset ändert sich selten, also 5 Min cachen lassen.
      // Nicht länger weil Presigned-URLs nach 15 Min eh tot sind.
      reply.header("Cache-Control", "private, max-age=300");
      return reply.redirect(url);
    }
  );

  // ===================================================================
  // Galerie-Freigabe (Collaborators) — granulare Sichtbarkeit
  // Wer Zugriff auf die Galerie hat, darf auch die Freigabe verwalten.
  // ===================================================================

  // GET /galleries/:id/collaborators — Team-Mitglieder + Freigabe-Status
  app.get<{ Params: { id: string } }>(
    "/galleries/:id/collaborators",
    async (req, reply) => {
      const s = req.requireAuth();
      const gallery = await prisma.gallery.findFirst({
        where: {
          id: req.params.id,
          tenantId: req.tenantId,
          ...galleryAccessWhere(s),
        },
        select: { id: true, ownerId: true },
      });
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const [members, collabs] = await Promise.all([
        prisma.user.findMany({
          where: { tenantId: req.tenantId, status: "active" },
          select: { id: true, name: true, email: true, role: true },
          orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        }),
        prisma.galleryCollaborator.findMany({
          where: { galleryId: gallery.id },
          select: { userId: true },
        }),
      ]);
      const sharedIds = new Set(collabs.map((c) => c.userId));
      return {
        ownerId: gallery.ownerId,
        members: members.map((m) => ({
          id: m.id,
          name: m.name,
          email: m.email,
          role: m.role,
          // Ersteller und Studio-Owner haben immer Zugriff (nicht abwählbar)
          alwaysHasAccess: m.id === gallery.ownerId || m.role === "owner",
          isCreator: m.id === gallery.ownerId,
          shared: sharedIds.has(m.id),
        })),
      };
    }
  );

  // POST /galleries/:id/collaborators { userId } — Galerie freigeben
  app.post<{ Params: { id: string }; Body: { userId?: string } }>(
    "/galleries/:id/collaborators",
    async (req, reply) => {
      const s = req.requireAuth();
      const userId = (req.body?.userId || "").trim();
      if (!userId) return reply.status(400).send({ error: "userId_required" });
      const gallery = await prisma.gallery.findFirst({
        where: {
          id: req.params.id,
          tenantId: req.tenantId,
          ...galleryAccessWhere(s),
        },
        select: { id: true, ownerId: true },
      });
      if (!gallery) return reply.status(404).send({ error: "not_found" });
      // Ziel-User muss zum selben Studio gehören
      const target = await prisma.user.findFirst({
        where: { id: userId, tenantId: req.tenantId },
        select: { id: true },
      });
      if (!target) return reply.status(404).send({ error: "user_not_found" });
      // Ersteller hat ohnehin Zugriff — kein Eintrag nötig
      if (userId === gallery.ownerId) {
        return { ok: true, alreadyHasAccess: true };
      }
      await prisma.galleryCollaborator.upsert({
        where: { galleryId_userId: { galleryId: gallery.id, userId } },
        create: { galleryId: gallery.id, userId, addedById: s.user.id },
        update: {},
      });
      return { ok: true };
    }
  );

  // DELETE /galleries/:id/collaborators/:userId — Freigabe entfernen
  app.delete<{ Params: { id: string; userId: string } }>(
    "/galleries/:id/collaborators/:userId",
    async (req, reply) => {
      const s = req.requireAuth();
      const gallery = await prisma.gallery.findFirst({
        where: {
          id: req.params.id,
          tenantId: req.tenantId,
          ...galleryAccessWhere(s),
        },
        select: { id: true },
      });
      if (!gallery) return reply.status(404).send({ error: "not_found" });
      await prisma.galleryCollaborator.deleteMany({
        where: { galleryId: gallery.id, userId: req.params.userId },
      });
      return { ok: true };
    }
  );
}
