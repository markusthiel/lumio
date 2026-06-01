/**
 * Lumio API — Health & Readiness
 */
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { LUMIO_VERSION } from "../version.js";

export async function registerHealthRoute(app: FastifyInstance) {
  app.get("/health", async () => ({
    status: "ok",
    service: "lumio-api",
    version: LUMIO_VERSION,
    mode: config.DEPLOYMENT_MODE,
    storage: config.STORAGE_PROVIDER,
    billing: config.BILLING_ENABLED,
    timestamp: new Date().toISOString(),
  }));

  // Readiness ist später detaillierter — pingt DB/Redis/S3
  app.get("/ready", async (_req, reply) => {
    // TODO: echte DB- und Redis-Pings einbauen, sobald Prisma-Client initialisiert ist
    return reply.status(200).send({ ready: true });
  });
}
