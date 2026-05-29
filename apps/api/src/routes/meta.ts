/**
 * Lumio API — App-Meta (öffentlich, ohne Auth)
 *
 *   GET /meta — instanzweite, öffentliche Konfiguration
 *
 * Liefert app-weite Angaben, die auch auf nicht eingeloggten Seiten
 * (Login, öffentliche Galerie) gebraucht werden. Aktuell die rechtlichen
 * Links des Betreibers. Tenant-unabhängig, daher immer verfügbar.
 */
import type { FastifyInstance } from "fastify";

import { config } from "../config.js";

export async function registerMetaRoutes(app: FastifyInstance) {
  app.get("/meta", async () => {
    return {
      legal: {
        imprintUrl: config.LUMIO_LEGAL_IMPRINT_URL ?? null,
        privacyUrl: config.LUMIO_LEGAL_PRIVACY_URL ?? null,
      },
    };
  });
}
