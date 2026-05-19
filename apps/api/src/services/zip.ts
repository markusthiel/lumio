/**
 * Lumio API — ZIP Download Service
 *
 * Verwaltet ZipDownload-Records: stabilen Cache-Hash über die Auswahl
 * erzeugen, Job an den Worker dispatchen, Status zurückgeben.
 */
import { createHash } from "node:crypto";
import { prisma } from "../db.js";
import { enqueue, Queues } from "./queue.js";

const EXPIRES_IN_DAYS = 7;

/**
 * Berechnet einen stabilen Hash über eine Datei-Auswahl. Wird als
 * Cache-Schlüssel verwendet — gleiche Auswahl = gleicher Hash, also
 * derselbe Eintrag in zip_downloads.
 *
 * Null als Input bedeutet "alle Files der Galerie" → fileIdsHash bleibt NULL,
 * so dass es genau einen "alle Files"-Eintrag pro (galleryId, accessId) gibt.
 */
export function hashFileIds(fileIds: string[] | null): string | null {
  if (!fileIds || fileIds.length === 0) return null;
  const sorted = [...fileIds].sort();
  return createHash("sha256")
    .update(sorted.join(","))
    .digest("hex")
    .slice(0, 32);
}

export interface RequestZipOptions {
  tenantId: string;
  galleryId: string;
  accessId: string | null;
  fileIds: string[] | null;
  label: string; // "all" | "selection_<accessId>" | ...
}

/**
 * Findet oder erzeugt einen ZipDownload-Eintrag.
 * - Wenn `ready` und nicht abgelaufen: bestehenden zurückgeben.
 * - Wenn `building` oder `pending`: bestehenden zurückgeben (Caller pollt).
 * - Wenn `failed` oder abgelaufen oder nicht existent: neu anstoßen.
 */
export async function requestZipDownload(opts: RequestZipOptions) {
  const fileIdsHash = hashFileIds(opts.fileIds);
  const fileCount = opts.fileIds?.length ?? 0; // 0 = "alle" (wird in Worker resolved)

  // Bestehenden Eintrag suchen — wir nutzen findFirst, weil
  // compound-unique mit NULL-Spalten in Prisma's findUnique nicht direkt
  // erlaubt ist. In Postgres ist (NULL, NULL) NICHT gleich (NULL, NULL),
  // also kann der DB-Constraint ohnehin mehrere "all"-Einträge zulassen —
  // wir suchen den neuesten.
  const existing = await prisma.zipDownload.findFirst({
    where: {
      galleryId: opts.galleryId,
      accessId: opts.accessId,
      fileIdsHash,
    },
    orderBy: { createdAt: "desc" },
  });

  const now = new Date();

  if (
    existing &&
    existing.status === "ready" &&
    existing.expiresAt > now &&
    existing.storageKey
  ) {
    return existing;
  }

  if (
    existing &&
    (existing.status === "pending" || existing.status === "building") &&
    existing.expiresAt > now
  ) {
    return existing;
  }

  // Neu anstoßen — bestehenden Eintrag updaten oder neu anlegen
  const expiresAt = new Date(Date.now() + EXPIRES_IN_DAYS * 24 * 3600 * 1000);
  const record = existing
    ? await prisma.zipDownload.update({
        where: { id: existing.id },
        data: {
          status: "pending",
          storageKey: null,
          sizeBytes: null,
          errorMessage: null,
          fileCount,
          expiresAt,
        },
      })
    : await prisma.zipDownload.create({
        data: {
          galleryId: opts.galleryId,
          accessId: opts.accessId,
          fileIdsHash,
          fileCount,
          status: "pending",
          expiresAt,
        },
      });

  await enqueue(Queues.ZIP_BUILD, {
    type: "build_zip",
    tenantId: opts.tenantId,
    galleryId: opts.galleryId,
    fileIds: opts.fileIds,
    label: opts.label,
    accessId: opts.accessId ?? undefined,
    zipDownloadId: record.id,
  });

  return record;
}
