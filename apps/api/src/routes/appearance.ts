/**
 * Lumio API — Appearance Routes (Studio / Login / E-Mails)
 *
 *   GET    /studio/appearance               — aktuelle Werte + signierte URLs
 *   PUT    /studio/appearance               — Farben / Theme / Greeting
 *   POST   /studio/appearance/assets        — Presigned PUT (Logo/Background)
 *   POST   /studio/appearance/assets/complete — Upload registrieren
 *   DELETE /studio/appearance/assets/:kind  — Asset entfernen
 *
 * Tenant-weit und entkoppelt vom Galerie-Branding. Asset-Felder sind
 * S3-Keys (t/<tenantId>/appearance/<kind>.<ext>) und werden beim
 * Ausliefern signiert.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { presignPut, presignGet, deleteObject } from "../services/storage.js";
import { logEvent } from "../services/audit.js";
import { enqueue, Queues } from "../services/queue.js";

const colorRegex = /^#[0-9a-fA-F]{6}$/;
const ASSET_TTL_SECONDS = 3600;

// kind (API) -> Tenant-Spalte
const FIELD_MAP = {
  studioLogo: "studioLogoKey",
  studioLogoLight: "studioLogoLightKey",
  loginLogo: "loginLogoKey",
  loginBackground: "loginBackgroundKey",
  emailLogo: "emailLogoKey",
} as const;
type AssetKind = keyof typeof FIELD_MAP;

const updateSchema = z.object({
  studioAccentColor: z.string().regex(colorRegex).nullable().optional(),
  studioTheme: z.enum(["dark", "light"]).optional(),
  loginAccentColor: z.string().regex(colorRegex).nullable().optional(),
  loginGreeting: z.string().max(2000).nullable().optional(),
  loginLayout: z
    .enum(["minimal", "splash", "side_by_side", "centered"])
    .optional(),
  // RGBA-Hex (#rrggbb oder #rrggbbaa). Farbfläche über dem Hintergrundbild.
  loginOverlayColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/)
    .nullable()
    .optional(),
  // Weichzeichner hinter der Farbfläche (px), 0–40. Null = aus.
  loginOverlayBlur: z.number().int().min(0).max(40).nullable().optional(),
  // Layout-Variante für Studio-gebrandete Mails.
  mailLayout: z
    .enum(["classic", "logo_right", "centered", "banner"])
    .optional(),
});

// Größenlimit je Asset-Typ. Logos sind klein; der Login-Hintergrund
// darf groß sein, weil dort auch RAW-Dateien (20–50 MB) ankommen, die
// der Worker erst demosaict und dann zu WebP eindampft.
const MAX_BYTES_BY_KIND: Record<string, number> = {
  studioLogo: 15 * 1024 * 1024,
  studioLogoLight: 15 * 1024 * 1024,
  loginLogo: 15 * 1024 * 1024,
  emailLogo: 15 * 1024 * 1024,
  loginBackground: 60 * 1024 * 1024,
};

const initAssetSchema = z
  .object({
    kind: z.enum([
      "studioLogo",
      "studioLogoLight",
      "loginLogo",
      "loginBackground",
      "emailLogo",
    ]),
    // Grober Vorfilter — die echte Format-Erkennung macht der Worker
    // (libvips für gängige Bilder inkl. JFIF/HEIC/TIFF/AVIF, rawpy für
    // Kamera-RAW). RAW kommt vom Browser oft als application/octet-stream
    // oder ganz ohne Typ, daher lassen wir das bewusst durch.
    contentType: z
      .string()
      .refine(
        (v) =>
          v === "" ||
          v.startsWith("image/") ||
          v === "application/octet-stream",
        "Nur Bilddateien erlaubt"
      ),
    sizeBytes: z.number().int().positive(),
    // Optionaler Original-Dateiname, damit wir die echte Endung in den
    // Storage-Key übernehmen können (RAW-Erkennung im Worker).
    filename: z.string().max(255).optional(),
  })
  .superRefine((val, ctx) => {
    const cap = MAX_BYTES_BY_KIND[val.kind] ?? 15 * 1024 * 1024;
    if (val.sizeBytes > cap) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        maximum: cap,
        type: "number",
        inclusive: true,
        message: `Datei zu groß (max. ${Math.round(cap / 1024 / 1024)} MB)`,
      });
    }
  });

const completeAssetSchema = z.object({
  kind: z.enum([
    "studioLogo",
    "studioLogoLight",
    "loginLogo",
    "loginBackground",
    "emailLogo",
  ]),
  key: z.string().min(1),
});

// Erlaubte Datei-Endungen für den Storage-Key. Bestimmt v.a., dass der
// Worker RAW-Dateien später an der Endung erkennt. libvips/rawpy lesen
// den echten Inhalt — die Endung ist nur für die Key-Benennung relevant.
const ALLOWED_EXTENSIONS = new Set([
  "jpg", "jpeg", "jfif", "png", "webp", "svg", "gif", "bmp",
  "tif", "tiff", "heic", "heif", "avif",
  // JPEG 2000 (wird im Worker via libvips/Pillow konvertiert)
  "jp2", "j2k", "jpf", "jpx", "jpc", "jpm",
  // Kamera-RAW
  "cr2", "cr3", "nef", "nrw", "arw", "sr2", "srf", "dng", "raf",
  "orf", "rw2", "pef", "srw", "raw", "3fr", "erf", "kdc", "mos",
  "mrw", "x3f",
]);

function extensionFor(contentType: string, filename?: string): string {
  // Echte Endung aus dem Dateinamen bevorzugen — wichtig für RAW und
  // für Formate, die der Browser als application/octet-stream schickt.
  if (filename) {
    const m = filename.toLowerCase().match(/\.([a-z0-9]{2,5})$/);
    if (m && ALLOWED_EXTENSIONS.has(m[1])) {
      return m[1] === "jpeg" ? "jpg" : m[1];
    }
  }
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/svg+xml") return "svg";
  if (contentType === "image/webp") return "webp";
  return "png";
}

// Storage-Key -> signierte URL. Externe http(s)-URLs werden unveraendert
// durchgereicht, null bleibt null.
async function presignKey(value: string | null): Promise<string | null> {
  if (!value) return null;
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  return presignGet({ key: value, ttlSeconds: ASSET_TTL_SECONDS });
}

type TenantAppearanceRow = {
  studioLogoKey: string | null;
  studioLogoLightKey: string | null;
  studioAccentColor: string | null;
  studioTheme: string | null;
  loginLogoKey: string | null;
  loginBackgroundKey: string | null;
  loginGreeting: string | null;
  loginAccentColor: string | null;
  loginLayout: string | null;
  loginOverlayColor: string | null;
  loginOverlayBlur: number | null;
  emailLogoKey: string | null;
  mailLayout: string | null;
};

async function serializeAppearance(t: TenantAppearanceRow) {
  const [studioLogoUrl, studioLogoLightUrl, loginLogoUrl, loginBackgroundUrl, emailLogoUrl] =
    await Promise.all([
      presignKey(t.studioLogoKey),
      presignKey(t.studioLogoLightKey),
      presignKey(t.loginLogoKey),
      presignKey(t.loginBackgroundKey),
      presignKey(t.emailLogoKey),
    ]);
  return {
    studioLogoUrl,
    studioLogoLightUrl,
    studioAccentColor: t.studioAccentColor,
    studioTheme: (t.studioTheme as "dark" | "light" | null) ?? "dark",
    loginLogoUrl,
    loginBackgroundUrl,
    loginGreeting: t.loginGreeting,
    loginAccentColor: t.loginAccentColor,
    loginLayout:
      (t.loginLayout as
        | "minimal"
        | "splash"
        | "side_by_side"
        | "centered"
        | null) ?? "centered",
    loginOverlayColor: t.loginOverlayColor,
    loginOverlayBlur: t.loginOverlayBlur,
    emailLogoUrl,
    mailLayout:
      (t.mailLayout as
        | "classic"
        | "logo_right"
        | "centered"
        | "banner"
        | null) ?? "classic",
  };
}

const APPEARANCE_SELECT = {
  studioLogoKey: true,
  studioLogoLightKey: true,
  studioAccentColor: true,
  studioTheme: true,
  loginLogoKey: true,
  loginBackgroundKey: true,
  loginGreeting: true,
  loginAccentColor: true,
  loginLayout: true,
  loginOverlayColor: true,
  loginOverlayBlur: true,
  emailLogoKey: true,
  mailLayout: true,
} as const;

export async function registerAppearanceRoutes(app: FastifyInstance) {
  // GET /studio/appearance
  app.get("/studio/appearance", async (req, reply) => {
    req.requireAuth();
    const t = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      select: APPEARANCE_SELECT,
    });
    if (!t) return reply.status(404).send({ error: "not_found" });
    return { appearance: await serializeAppearance(t) };
  });

  // PUT /studio/appearance — Farben / Theme / Greeting
  app.put("/studio/appearance", async (req, reply) => {
    const s = req.requireAuth();
    const body = updateSchema.parse(req.body);
    const t = await prisma.tenant.update({
      where: { id: req.tenantId },
      data: {
        ...(body.studioAccentColor !== undefined && {
          studioAccentColor: body.studioAccentColor,
        }),
        ...(body.studioTheme !== undefined && { studioTheme: body.studioTheme }),
        ...(body.loginAccentColor !== undefined && {
          loginAccentColor: body.loginAccentColor,
        }),
        ...(body.loginGreeting !== undefined && {
          loginGreeting: body.loginGreeting,
        }),
        ...(body.loginLayout !== undefined && {
          loginLayout: body.loginLayout,
        }),
        ...(body.loginOverlayColor !== undefined && {
          loginOverlayColor: body.loginOverlayColor,
        }),
        ...(body.loginOverlayBlur !== undefined && {
          loginOverlayBlur: body.loginOverlayBlur,
        }),
        ...(body.mailLayout !== undefined && {
          mailLayout: body.mailLayout,
        }),
      },
      select: APPEARANCE_SELECT,
    });
    await logEvent({
      tenantId: req.tenantId,
      actorType: "user",
      actorId: s.user.id,
      action: "tenant.appearance.update",
      targetType: "tenant",
      targetId: req.tenantId,
      ipAddress: req.ip,
    }).catch(() => {});
    return { appearance: await serializeAppearance(t) };
  });

  // POST /studio/appearance/assets — Presigned PUT
  app.post("/studio/appearance/assets", async (req) => {
    req.requireAuth();
    const body = initAssetSchema.parse(req.body);
    const ext = extensionFor(body.contentType, body.filename);
    const key = `t/${req.tenantId}/appearance/${body.kind}.${ext}`;
    // Leerer Content-Type (kommt bei RAW häufig vor) würde die Presign-
    // Signatur und den späteren PUT auseinanderlaufen lassen — daher
    // einen stabilen Default verwenden.
    const uploadContentType = body.contentType || "application/octet-stream";
    const uploadUrl = await presignPut({
      key,
      contentType: uploadContentType,
      contentLength: body.sizeBytes,
    });
    return {
      key,
      uploadUrl,
      headers: { "Content-Type": uploadContentType },
    };
  });

  // POST /studio/appearance/assets/complete
  app.post("/studio/appearance/assets/complete", async (req, reply) => {
    req.requireAuth();
    const body = completeAssetSchema.parse(req.body);

    // Sicherheitscheck: Key muss in den appearance-Bereich dieses Tenants
    if (!body.key.startsWith(`t/${req.tenantId}/appearance/`)) {
      return reply.status(403).send({ error: "forbidden" });
    }

    const field = FIELD_MAP[body.kind as AssetKind];
    const current = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      select: APPEARANCE_SELECT,
    });
    if (!current) return reply.status(404).send({ error: "not_found" });

    const oldKey = (current as Record<string, string | null>)[field];
    if (oldKey && oldKey !== body.key) {
      await deleteObject(oldKey).catch(() => {});
    }

    const t = await prisma.tenant.update({
      where: { id: req.tenantId },
      data: { [field]: body.key },
      select: APPEARANCE_SELECT,
    });

    // Asynchrone Lade-Optimierung: WebP + Resize (Logos klein,
    // Hintergrund groß; SVG bleibt). Hält den Upload schlank — niemand
    // soll ein 5-MB-PNG ausliefern, das mit 28px dargestellt wird.
    await enqueue(Queues.FILE_PROCESSING, {
      type: "process_appearance_asset",
      tenantId: req.tenantId,
      kind: body.kind,
    }).catch(() => {});

    return { appearance: await serializeAppearance(t) };
  });

  // DELETE /studio/appearance/assets/:kind
  app.delete<{ Params: { kind: string } }>(
    "/studio/appearance/assets/:kind",
    async (req, reply) => {
      req.requireAuth();
      const kind = req.params.kind;
      if (!(kind in FIELD_MAP)) {
        return reply.status(400).send({ error: "bad_kind" });
      }
      const field = FIELD_MAP[kind as AssetKind];
      const current = await prisma.tenant.findUnique({
        where: { id: req.tenantId },
        select: APPEARANCE_SELECT,
      });
      if (!current) return reply.status(404).send({ error: "not_found" });
      const oldKey = (current as Record<string, string | null>)[field];
      if (oldKey) await deleteObject(oldKey).catch(() => {});
      const t = await prisma.tenant.update({
        where: { id: req.tenantId },
        data: { [field]: null },
        select: APPEARANCE_SELECT,
      });
      return { appearance: await serializeAppearance(t) };
    }
  );

  // GET /public/email-logo/:tenantId — OEFFENTLICH (kein Auth).
  // Liefert das E-Mail-Logo des Tenants als 302-Redirect auf eine frisch
  // signierte URL. So bleibt der Link im Mail-Header stabil, auch wenn
  // die Mail erst Tage spaeter geoeffnet wird (signierte S3-URLs allein
  // wuerden verfallen). Das Logo ist ohnehin fuer Empfaenger gedacht.
  app.get<{ Params: { tenantId: string } }>(
    "/public/email-logo/:tenantId",
    async (req, reply) => {
      const id = req.params.tenantId;
      if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
        return reply.status(404).send({ error: "not_found" });
      }
      let t: { emailLogoKey: string | null } | null = null;
      try {
        t = await prisma.tenant.findUnique({
          where: { id },
          select: { emailLogoKey: true },
        });
      } catch {
        return reply.status(404).send({ error: "not_found" });
      }
      if (!t?.emailLogoKey) {
        return reply.status(404).send({ error: "not_found" });
      }
      if (
        t.emailLogoKey.startsWith("http://") ||
        t.emailLogoKey.startsWith("https://")
      ) {
        return reply.redirect(t.emailLogoKey, 302);
      }
      const url = await presignGet({
        key: t.emailLogoKey,
        ttlSeconds: 3600,
      });
      return reply.redirect(url, 302);
    }
  );
}
