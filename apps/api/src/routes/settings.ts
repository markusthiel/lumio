/**
 * Lumio API — Tenant Settings Routes
 *
 *   GET   /settings                      — aktuelle Tenant-Settings
 *   PATCH /settings                      — Settings updaten (Text-Watermark)
 *   POST  /settings/watermark-image      — Presigned-URL für Bild-Upload
 *   POST  /settings/watermark-image/complete — Upload abschließen
 *   DELETE /settings/watermark-image     — Bild-Watermark entfernen
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { promises as dns } from "node:dns";

import { prisma } from "../db.js";
import { config } from "../config.js";
import { checkFeatureAvailable } from "../services/usage.js";
import { validateSlugFormat } from "../services/slugs.js";
import {
  presignPut,
  deleteObject,
} from "../services/storage.js";

const updateSettingsSchema = z.object({
  /** Oeffentlicher Anzeigename des Studios. Vom Owner/Admin
   *  editierbar — sichtbar auf der Login-Seite, in allen Mails,
   *  im Welcome-Flow. Wenn leerer String oder null, faellt alles
   *  auf den internen Verwaltungsnamen (tenant.name) zurueck. */
  displayName: z
    .string()
    .max(120)
    .nullable()
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      if (v === null) return null;
      const trimmed = v.trim();
      return trimmed ? trimmed : null;
    }),
  /** Tenant-Slug = Login-Subdomain (<slug>.lumio-cloud.de). Nur der
   *  Owner darf ihn ändern (Berechtigung wird in der Route geprüft).
   *  Roh entgegennehmen; Format/Reserviert/Verfügbarkeit prüft die
   *  Route via validateSlugFormat + DB-Lookup. */
  slug: z.string().max(40).optional(),
  watermarkText: z.string().max(200).nullable().optional(),
  customDomain: z
    .string()
    .max(253)
    // RFC 1035 + dot — sehr permissiv, weil Punycode etc. erlaubt sein soll
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i)
    .nullable()
    .optional(),
  /** Pro-File Upload-Limit in MiB. Null = ENV-Default verwenden.
   * API-Validation greift nicht hier (Schema kennt kein Hard-Cap),
   * sondern in der PATCH-Route. */
  maxUploadMib: z.number().int().positive().nullable().optional(),
});

const initWatermarkUploadSchema = z.object({
  contentType: z.string().refine(
    (v) => v === "image/png" || v === "image/jpeg",
    "Only PNG or JPEG allowed"
  ),
  sizeBytes: z.number().int().positive().max(20 * 1024 * 1024), // 20 MiB
});

export async function registerSettingsRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // GET /settings
  // -------------------------------------------------------------------------
  app.get("/settings", async (req, reply) => {
    req.requireAuth();
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      select: {
        id: true,
        slug: true,
        name: true,
        displayName: true,
        watermarkText: true,
        watermarkImageKey: true,
        customDomain: true,
        maxUploadMib: true,
      },
    });
    if (!tenant) return reply.status(404).send({ error: "not_found" });
    return {
      tenant,
      // Hilfsinformationen damit das Frontend Default + Cap kennt,
      // ohne dass es die ENV-Variablen lesen muss.
      uploadLimits: {
        defaultMib: config.MAX_FILE_SIZE_MIB,
        hardCapMib: config.MAX_UPLOAD_HARD_CAP_MIB,
      },
      // Deployment-Kontext fuer Mode-spezifische UI-Entscheidungen.
      // Single-Mode-Self-Hoster sollen z.B. die "Studio-URL"-Sektion
      // gar nicht sehen, weil bei ihnen Slug-Subdomains keine Rolle
      // spielen — sie nutzen ihre eigene Domain direkt.
      deployment: {
        mode: config.DEPLOYMENT_MODE,
        domainBase: config.LUMIO_DOMAIN_BASE ?? null,
        // Öffentliche IP des Lumio-Servers — wird im Studio in den
        // Custom-Domain-Setup-Anweisungen angezeigt, damit der Kunde
        // weiß, worauf er seinen A-Record richten muss. Wenn nicht
        // gesetzt, zeigt das UI generische Hinweise.
        publicIp: config.LUMIO_PUBLIC_IP ?? null,
      },
    };
  });

  // -------------------------------------------------------------------------
  // PATCH /settings
  // -------------------------------------------------------------------------
  app.patch("/settings", async (req, reply) => {
    const s = req.requireAuth();
    if (s.user.role !== "owner" && s.user.role !== "admin") {
      return reply.status(403).send({ error: "forbidden" });
    }
    const body = updateSettingsSchema.parse(req.body);

    // Wenn customDomain neu gesetzt wird: Plan-Feature-Check ZUERST,
    // dann Konflikt-Check. Wir prüfen nur wenn der User die Domain
    // tatsächlich ändert (body.customDomain !== undefined und !== der
    // bisherigen). Sonst würde jedes /settings-PATCH die Limit-Logik
    // triggern auch wenn der User nur watermarkText ändert.
    if (config.BILLING_ENABLED && body.customDomain && req.tenantId) {
      const existing = await prisma.tenant.findUnique({
        where: { id: req.tenantId },
        select: { customDomain: true },
      });
      if (existing?.customDomain !== body.customDomain) {
        const check = await checkFeatureAvailable(req.tenantId, "customDomain");
        if (!check.ok) {
          return reply.status(402).send(check);
        }
      }
    }

    // Wenn customDomain gesetzt wird: prüfen, ob's frei ist
    if (body.customDomain) {
      const conflict = await prisma.tenant.findFirst({
        where: {
          customDomain: body.customDomain,
          NOT: { id: req.tenantId },
        },
        select: { id: true },
      });
      if (conflict) {
        return reply
          .status(409)
          .send({ error: "domain_taken" });
      }
    }

    // maxUploadMib gegen Hard-Cap prüfen. null = zurück auf ENV-Default.
    if (
      body.maxUploadMib !== undefined &&
      body.maxUploadMib !== null &&
      body.maxUploadMib > config.MAX_UPLOAD_HARD_CAP_MIB
    ) {
      return reply.status(400).send({
        error: "exceeds_hard_cap",
        message: `Max upload size cannot exceed ${config.MAX_UPLOAD_HARD_CAP_MIB} MiB (hard cap).`,
        hardCapMib: config.MAX_UPLOAD_HARD_CAP_MIB,
      });
    }

    // Slug-Änderung: nur Owner, Format + Reserviert + Verfügbarkeit prüfen.
    // Unkritisch für bestehende Galerie-/Mail-Links (die laufen über
    // PUBLIC_URL, nicht über die Tenant-Subdomain) — betrifft nur die
    // Login-Subdomain.
    let slugUpdate: { slug?: string } = {};
    if (body.slug !== undefined) {
      if (s.user.role !== "owner") {
        return reply.status(403).send({
          error: "owner_only",
          message: "Nur der Owner kann den Studio-Namen ändern.",
        });
      }
      const newSlug = body.slug.trim().toLowerCase();
      const fmt = validateSlugFormat(newSlug);
      if (!fmt.ok) {
        return reply.status(400).send({
          error: "invalid_slug",
          message:
            fmt.message ??
            "Ungültiger Studio-Name (3–30 Zeichen, nur Kleinbuchstaben, Ziffern, Bindestriche).",
        });
      }
      const taken = await prisma.tenant.findFirst({
        where: { slug: newSlug, NOT: { id: req.tenantId } },
        select: { id: true },
      });
      if (taken) {
        return reply.status(409).send({
          error: "slug_taken",
          message: "Dieser Studio-Name ist bereits vergeben.",
        });
      }
      slugUpdate = { slug: newSlug };
    }

    const tenant = await prisma.tenant.update({
      where: { id: req.tenantId },
      data: {
        ...slugUpdate,
        ...(body.displayName !== undefined
          ? { displayName: body.displayName }
          : {}),
        ...(body.watermarkText !== undefined
          ? { watermarkText: body.watermarkText }
          : {}),
        ...(body.customDomain !== undefined
          ? { customDomain: body.customDomain }
          : {}),
        ...(body.maxUploadMib !== undefined
          ? { maxUploadMib: body.maxUploadMib }
          : {}),
      },
      select: {
        id: true,
        slug: true,
        name: true,
        displayName: true,
        watermarkText: true,
        watermarkImageKey: true,
        customDomain: true,
        maxUploadMib: true,
      },
    });
    return { tenant };
  });

  // -------------------------------------------------------------------------
  // GET /settings/custom-domain/status
  // -------------------------------------------------------------------------
  // Diagnose für die Custom-Domain-Sektion im Studio. Pruefe ob die vom
  // Tenant eingetragene Domain (a) per DNS auf unsere Server-IP zeigt
  // und (b) ein gueltiges TLS-Zertifikat hat (Caddy laesst sich von
  // ausserhalb nicht direkt abfragen, also TLS-Handshake-Probe).
  //
  // Beide Checks koennen "pending" sein — DNS propagiert evtl. noch,
  // Caddy holt vielleicht gerade ein Cert. Das Frontend pollt diese
  // Route in kurzen Abstaenden, bis beides "ok" ist.
  app.get("/settings/custom-domain/status", async (req, reply) => {
    req.requireAuth();
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      select: { customDomain: true },
    });
    if (!tenant?.customDomain) {
      return { configured: false };
    }

    const domain = tenant.customDomain;
    const expectedIp = config.LUMIO_PUBLIC_IP ?? null;

    // DNS-Lookup mit kurzem Timeout. dns.lookup folgt CNAMEs automatisch
    // und liefert die finale IP. resolveCname separat nur fuer die UI-
    // Anzeige ("die Domain ist ein CNAME auf ...").
    let dnsResolved: string[] = [];
    let dnsCname: string | null = null;
    let dnsError: string | null = null;
    try {
      const results = await Promise.race([
        dns.resolve4(domain),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error("dns_timeout")), 5000)
        ),
      ]);
      dnsResolved = results;
    } catch (err) {
      dnsError = err instanceof Error ? err.message : String(err);
    }
    try {
      const cnames = await dns.resolveCname(domain);
      if (cnames.length > 0) dnsCname = cnames[0];
    } catch {
      // Kein CNAME → kein Fehler, ist normal bei A-Records
    }

    const dnsCorrect =
      expectedIp !== null && dnsResolved.includes(expectedIp);

    // TLS-Probe: HEAD-Request gegen https://<domain>/health (existierender
    // unauthentifizierter Endpoint). Wenn TLS-Handshake durchlaeuft, ist
    // das Cert gueltig. Bei Fehlern unterscheiden wir grobe Klassen.
    let tlsStatus: "valid" | "pending" | "invalid" | "no_dns" = "no_dns";
    let tlsDetail: string | null = null;
    if (dnsResolved.length > 0) {
      try {
        const res = await fetch(`https://${domain}/health`, {
          method: "HEAD",
          redirect: "manual",
          signal: AbortSignal.timeout(5000),
        });
        // Beliebige Antwort heisst: TLS hat funktioniert
        tlsStatus = "valid";
        void res;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Caddy ist noch dabei, ein Cert zu holen → ECONNREFUSED ist
        // unwahrscheinlich (Lumio-Caddy laeuft ja), eher Cert-Fehler
        // oder Connection-Reset.
        tlsDetail = msg;
        if (
          msg.includes("CERT_") ||
          msg.includes("certificate") ||
          msg.includes("self-signed") ||
          msg.includes("UNABLE_TO_VERIFY")
        ) {
          tlsStatus = "invalid";
        } else {
          tlsStatus = "pending";
        }
      }
    }

    return {
      configured: true,
      domain,
      expectedIp,
      dns: {
        resolved: dnsResolved,
        cname: dnsCname,
        correct: dnsCorrect,
        error: dnsError,
      },
      tls: {
        status: tlsStatus,
        detail: tlsDetail,
      },
    };
  });

  // -------------------------------------------------------------------------
  // POST /settings/watermark-image — Presigned URL für Upload anfordern
  // -------------------------------------------------------------------------
  app.post("/settings/watermark-image", async (req, reply) => {
    const s = req.requireAuth();
    if (s.user.role !== "owner" && s.user.role !== "admin") {
      return reply.status(403).send({ error: "forbidden" });
    }
    const body = initWatermarkUploadSchema.parse(req.body);

    // Deterministischer Key — überschreibt das bestehende, falls vorhanden.
    // Extension passend zum ContentType (sonst stimmt Content-Type beim
    // späteren GET nicht).
    const ext = body.contentType === "image/jpeg" ? "jpg" : "png";
    const key = `t/${req.tenantId}/watermark.${ext}`;

    const uploadUrl = await presignPut({
      key,
      contentType: body.contentType,
      contentLength: body.sizeBytes,
    });

    return {
      key,
      uploadUrl,
      headers: { "Content-Type": body.contentType },
    };
  });

  // -------------------------------------------------------------------------
  // POST /settings/watermark-image/complete
  // -------------------------------------------------------------------------
  app.post<{ Body: { key: string } }>(
    "/settings/watermark-image/complete",
    async (req, reply) => {
      const s = req.requireAuth();
      if (s.user.role !== "owner" && s.user.role !== "admin") {
        return reply.status(403).send({ error: "forbidden" });
      }
      const key = req.body?.key;
      if (typeof key !== "string") {
        return reply.status(400).send({ error: "bad_request" });
      }

      // Sicherheitscheck: der Key muss zum aktuellen Tenant gehören
      if (!key.startsWith(`t/${req.tenantId}/watermark.`)) {
        return reply.status(403).send({ error: "forbidden" });
      }

      // Wenn bereits ein anderer Watermark-Key existiert, alten löschen
      const tenant = await prisma.tenant.findUnique({
        where: { id: req.tenantId },
        select: { watermarkImageKey: true },
      });
      if (tenant?.watermarkImageKey && tenant.watermarkImageKey !== key) {
        await deleteObject(tenant.watermarkImageKey).catch(() => {});
      }

      await prisma.tenant.update({
        where: { id: req.tenantId },
        data: { watermarkImageKey: key },
      });
      return { ok: true, key };
    }
  );

  // -------------------------------------------------------------------------
  // DELETE /settings/watermark-image
  // -------------------------------------------------------------------------
  app.delete("/settings/watermark-image", async (req, reply) => {
    const s = req.requireAuth();
    if (s.user.role !== "owner" && s.user.role !== "admin") {
      return reply.status(403).send({ error: "forbidden" });
    }
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      select: { watermarkImageKey: true },
    });
    if (tenant?.watermarkImageKey) {
      await deleteObject(tenant.watermarkImageKey).catch(() => {});
    }
    await prisma.tenant.update({
      where: { id: req.tenantId },
      data: { watermarkImageKey: null },
    });
    return { ok: true };
  });
}
