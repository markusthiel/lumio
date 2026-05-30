/**
 * Lumio API — Server Entry Point
 *
 * Startet den Fastify-Server mit allen Plugins und Routen.
 */
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import rateLimit from "@fastify/rate-limit";

import { config } from "./config.js";
import { logger, loggerOptions } from "./logger.js";
import { bootstrap } from "./bootstrap.js";
import { prisma } from "./db.js";

import authPlugin from "./plugins/auth.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerGalleryRoutes } from "./routes/galleries.js";
import { registerAccessRoutes } from "./routes/access.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerProofingRoutes } from "./routes/proofing.js";
import { registerBillingRoutes } from "./routes/billing.js";
import { registerSignupRoutes } from "./routes/signup.js";
import { registerReadOnlyEnforcement } from "./plugins/read-only.js";
import { registerHlsRoutes } from "./routes/hls.js";
import { registerZipRoutes } from "./routes/zip.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerDpaRoutes } from "./routes/dpa.js";
import { registerMetaRoutes } from "./routes/meta.js";
import { registerExportRoutes } from "./routes/export.js";
import { registerBrandingRoutes } from "./routes/brandings.js";
import { registerAppearanceRoutes } from "./routes/appearance.js";
import { registerTemplateRoutes } from "./routes/templates.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { registerTokenRoutes } from "./routes/tokens.js";
import { registerPluginRoutes } from "./routes/plugin.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { registerSearchRoutes } from "./routes/search.js";
import { registerTagRoutes } from "./routes/tags.js";
import { registerCollectionRoutes } from "./routes/collections.js";
import { registerUploadLinkRoutes } from "./routes/upload-links.js";
import { registerDuplicateRoutes } from "./routes/duplicates.js";
import { registerTenantExportRoutes } from "./routes/exports.js";
import { registerTeamRoutes } from "./routes/team.js";
import { registerAccountRoutes } from "./routes/account.js";
import { registerSuperAuthRoutes } from "./routes/super-auth.js";
import { registerSuperTenantRoutes } from "./routes/super-tenants.js";
import { registerAnnouncementRoutes } from "./routes/announcements.js";
import { registerBroadcastRoutes } from "./routes/broadcasts.js";
import { registerPrintShopRoutes } from "./routes/print-shop.js";
import { registerPrintShopPublicRoutes } from "./routes/print-shop-public.js";
import { registerAnalyticsRoutes } from "./routes/analytics.js";
import { registerAutoTagRoutes } from "./routes/auto-tags.js";
import { registerWsRoutes } from "./routes/ws.js";
import superAdminPlugin from "./plugins/super-admin.js";
import { startPeriodicSweeper } from "./services/sweeper.js";
import { startPrintOrderMailSweeper } from "./services/print-mail-sweeper.js";

async function buildServer() {
  const app = Fastify({
    logger: loggerOptions,
    bodyLimit: 50 * 1024 * 1024,
    trustProxy: true,
  });

  // Core-Plugins
  await app.register(sensible);
  await app.register(cookie, { secret: config.SESSION_SECRET });

  // Stripe Webhook braucht raw Body für die Signatur-Validierung.
  // Wir registrieren einen Content-Type-Parser der den Body als
  // Buffer AUSSCHLIESSLICH für den /billing/webhook-Pfad mit-speichert.
  // Für alle anderen Routen läuft Fastify's Default-JSON-Parser weiter.
  //
  // Standard-JSON-Parser wird damit auch nicht ersetzt — wir nutzen
  // einen separaten Parser für "application/json" der den raw Body
  // als req.rawBody anhängt UND danach normal JSON-parsed.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (req, body, done) => {
      try {
        const isWebhook =
          req.url === "/api/v1/billing/webhook" ||
          req.url.startsWith("/api/v1/billing/webhook?");
        if (isWebhook) {
          // raw Buffer für Signatur-Check vorhalten
          (req as { rawBody?: Buffer }).rawBody = body as Buffer;
        }
        // Normaler JSON-Parse für alle Routen
        const parsed = body.length ? JSON.parse(body.toString("utf8")) : null;
        done(null, parsed);
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );

  await app.register(cors, {
    origin: config.NODE_ENV === "production" ? config.PUBLIC_URL : true,
    credentials: true,
    // X-Lumio-Tenant ist ein Custom-Header für Multi-Tenant-Auflösung
    // (vor allem Mobile-App). Ohne explicit allow blockt CORS ihn im
    // Browser; native HTTP-Clients (Mobile) sind nicht betroffen, aber
    // wir erlauben ihn einheitlich.
    allowedHeaders: ["Content-Type", "Authorization", "X-Lumio-Tenant"],
  });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    skipOnError: true,
  });

  // Lumio-Plugins
  await app.register(authPlugin);
  await app.register(superAdminPlugin);

  // Routen
  await registerHealthRoute(app);
  await app.register(
    async (api) => {
      // Read-only-Enforcement-Hook — greift für alle Schreibmethoden
      // im /api/v1-Scope wenn der Tenant in read-only ist. Muss VOR
      // den Routen registriert werden damit der preHandler bei allen
      // greift. Auth + Billing-Endpoints stehen in der Allowlist
      // (siehe plugins/read-only.ts).
      registerReadOnlyEnforcement(api);

      await registerAuthRoutes(api);
      await registerGalleryRoutes(api);
      await registerAccessRoutes(api);
      await registerFileRoutes(api);
      await registerProofingRoutes(api);
      await registerHlsRoutes(api);
      await registerZipRoutes(api);
      await registerSettingsRoutes(api);
      await registerDpaRoutes(api);
      await registerMetaRoutes(api);
      await registerExportRoutes(api);
      await registerBrandingRoutes(api);
      await registerAppearanceRoutes(api);
      await registerTemplateRoutes(api);
      await registerAuditRoutes(api);
      await registerTokenRoutes(api);
      await registerPluginRoutes(api);
      await registerWebhookRoutes(api);
      await registerSearchRoutes(api);
      await registerTagRoutes(api);
      await registerCollectionRoutes(api);
      await registerUploadLinkRoutes(api);
      await registerDuplicateRoutes(api);
      await registerTenantExportRoutes(api);
      await registerTeamRoutes(api);
      await registerAccountRoutes(api);
      await registerSuperAuthRoutes(api);
      // Super-Admin-Tenant-Routes haben einen internen preHandler-Guard,
      // sind aber bewusst eingekapselt damit ihr Guard nicht auf andere
      // Routes des selben Scopes wirkt.
      await api.register(registerSuperTenantRoutes);
      // Announcement-Routes: GET /announcements/active ist public, der
      // Rest ist Super-Admin (Guard innerhalb der Funktion via
      // requireSuperAdmin).
      await registerAnnouncementRoutes(api);
      // Broadcast-Routes: GET /broadcasts/unsubscribe ist public, der
      // Rest ist Super-Admin.
      await registerBroadcastRoutes(api);
      // Studio-Print-Shop-Routes: pruefen alle intern den Feature-Flag.
      // Wenn aus: 404. Damit ist 'komplett deaktivierbar' eingehalten.
      await registerPrintShopRoutes(api);
      // Public-Print-Shop-Routes (Endkunden in der Galerie)
      await registerPrintShopPublicRoutes(api);
      // Analytics-Routes — auch alle Feature-Flag-gated (advanced_analytics)
      await registerAnalyticsRoutes(api);
      // Auto-Tag-Routes — Feature-Flag-gated (ai_tagging)
      await registerAutoTagRoutes(api);
      if (config.BILLING_ENABLED) {
        await registerBillingRoutes(api);
        await registerSignupRoutes(api);
      }
    },
    { prefix: "/api/v1" }
  );

  // WebSocket-Routen — bewusst OHNE /api/v1-Prefix, damit der Caddy-
  // Block /ws/* (siehe infra/caddy/Caddyfile) direkt durchroutet ohne
  // Path-Rewrite.
  await registerWsRoutes(app);

  app.setErrorHandler((err, _req, reply) => {
    app.log.error({ err }, "request failed");
    if (err.validation) {
      return reply.status(400).send({
        error: "validation_failed",
        message: err.message,
        details: err.validation,
      });
    }
    const status = err.statusCode ?? 500;
    return reply.status(status).send({
      error: status >= 500 ? "internal_error" : err.name,
      message: status >= 500 ? "Internal server error" : err.message,
    });
  });

  return app;
}

async function start() {
  // 1. DB-Connection prüfen
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info("database connection ok");
  } catch (err) {
    logger.error({ err }, "database connection failed — aborting start");
    process.exit(1);
  }

  // 2. Bootstrap (Default-Tenant, Plans seeden)
  await bootstrap();

  // 3. Server hochfahren
  const app = await buildServer();
  try {
    await app.listen({
      port: Number(process.env.PORT ?? 3001),
      host: "0.0.0.0",
    });
    app.log.info(
      { mode: config.DEPLOYMENT_MODE, billing: config.BILLING_ENABLED },
      "Lumio API ready"
    );
    // Periodischer Cleanup-Sweeper. Triggert Worker-Job alle 6h fuer
    // abgelaufene Tenant-Exports. Idempotent — mehrere API-Instances
    // gleichzeitig sind harmlos.
    startPeriodicSweeper();
    startPrintOrderMailSweeper();
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Graceful Shutdown — wichtig für Docker SIGTERM
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, async () => {
    logger.info({ signal: sig }, "shutting down");
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  });
}

start();
