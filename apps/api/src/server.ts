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
import { registerFileRoutes } from "./routes/files.js";
import { registerProofingRoutes } from "./routes/proofing.js";
import { registerBillingRoutes } from "./routes/billing.js";

async function buildServer() {
  const app = Fastify({
    logger: loggerOptions,
    bodyLimit: 50 * 1024 * 1024,
    trustProxy: true,
  });

  // Core-Plugins
  await app.register(sensible);
  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(cors, {
    origin: config.NODE_ENV === "production" ? config.PUBLIC_URL : true,
    credentials: true,
  });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    skipOnError: true,
  });

  // Lumio-Plugins
  await app.register(authPlugin);

  // Routen
  await registerHealthRoute(app);
  await app.register(
    async (api) => {
      await registerAuthRoutes(api);
      await registerGalleryRoutes(api);
      await registerFileRoutes(api);
      await registerProofingRoutes(api);
      if (config.BILLING_ENABLED) {
        await registerBillingRoutes(api);
      }
    },
    { prefix: "/api/v1" }
  );

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
