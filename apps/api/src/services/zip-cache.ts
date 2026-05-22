/**
 * Lumio API — ZIP-Cache-Invalidierung
 *
 * Wenn sich der Inhalt einer Galerie ändert (Files hochgeladen, gelöscht,
 * abgelehnt, freigegeben, neu sortiert), sind alle gecachten ZIPs der
 * Galerie veraltet. Customer der sie runterlädt würde ein stale ZIP
 * bekommen (zu viele oder zu wenige Files).
 *
 * Lösung: bei jeder File-Mutation hier durchrufen. Wir setzen die
 * zip_downloads-Einträge auf status='expired'. Der requestZipDownload-
 * Service betrachtet nur status='ready'-Einträge als Cache-Hit — expired
 * läuft automatisch in den Build-Pfad und der Worker baut neu.
 *
 * Die alten S3-Objekte verwaisen. Cleanup-Job dafür ist Roadmap-Item
 * (Storage-GC); heute akzeptieren wir den verwaisten Storage als
 * temporären Trade-off. Bei aktiv genutzten Galerien sind das im
 * Worst-Case ein paar 100 MB pro Galerie pro Monat.
 *
 * Idempotenz: doppelte Aufrufe sind harmlos, das updateMany greift
 * einfach nur ein zweites Mal auf 0 Rows.
 */
import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../db.js";

export interface InvalidateOptions {
  /** Logger für Telemetry. Optional — wenn fehlt: stille Operation. */
  log?: Pick<FastifyBaseLogger, "info">;
  /** Begründung für's Log ("file_deleted", "approved", etc.). */
  reason?: string;
}

/** Markiert alle Cache-ZIPs einer Galerie als expired.
 *  Returnt die Anzahl invalidierter Einträge (nur für Telemetry). */
export async function invalidateZipCacheForGallery(
  galleryId: string,
  opts: InvalidateOptions = {}
): Promise<number> {
  // Auch pending/building expiren — sonst gibt der requestZipDownload
  // Service einen ZIP-Build zurück der gerade läuft und Files referen-
  // ziert, die wir gerade gelöscht haben. Worker bricht dann mit
  // NoSuchKey ab (oder skippt seit dem Skip-Fix). Sauberer: gleich
  // expiren, ein Polling-Customer kriegt 'expired' zurück, sein
  // Frontend stößt einen neuen Build an.
  const result = await prisma.zipDownload.updateMany({
    where: {
      galleryId,
      status: { in: ["ready", "pending", "building"] },
    },
    data: { status: "expired" },
  });

  if (result.count > 0 && opts.log) {
    opts.log.info(
      { galleryId, count: result.count, reason: opts.reason ?? "unspecified" },
      "zip_cache.invalidated"
    );
  }

  return result.count;
}
