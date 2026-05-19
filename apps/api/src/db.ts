/**
 * Lumio API — Prisma Client Singleton
 *
 * Ein einziger PrismaClient pro Prozess. Im Dev-Modus mit tsx-watch bewahrt
 * der `globalThis`-Trick davor, dass jeder Reload eine neue Connection-Pool
 * öffnet (Connection-Leaks).
 */
import { PrismaClient } from "@prisma/client";
import { config } from "./config.js";

declare global {
  // eslint-disable-next-line no-var
  var __lumio_prisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__lumio_prisma ??
  new PrismaClient({
    log:
      config.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

if (config.NODE_ENV !== "production") {
  globalThis.__lumio_prisma = prisma;
}
