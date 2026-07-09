/**
 * Lumio API — ZIP Download Service
 *
 * Verwaltet ZipDownload-Records: stabilen Cache-Hash über die Auswahl
 * erzeugen, Job an den Worker dispatchen, Status zurückgeben.
 */
import { createHash } from "node:crypto";
import { prisma } from "../db.js";
import { enqueue, Queues } from "./queue.js";
import { effectiveZipPartBytes } from "./zip-part-limit.js";

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

export type DownloadVariant = "original" | "web";

export interface RequestZipOptions {
  tenantId: string;
  galleryId: string;
  accessId: string | null;
  fileIds: string[] | null;
  label: string; // "all" | "selection_<accessId>" | ...
  variant?: DownloadVariant; // default "original"
}

/**
 * Findet oder erzeugt einen ZipDownload-Eintrag.
 * - Wenn `ready` und nicht abgelaufen: bestehenden zurückgeben.
 * - Wenn `building` oder `pending`: bestehenden zurückgeben (Caller pollt).
 * - Wenn `failed` oder abgelaufen oder nicht existent: neu anstoßen.
 *
 * Variant ("original" vs "web") ist Teil des Cache-Schlüssels — eine ZIP
 * mit Originalen ist eine andere Antwort als eine mit Web-Renditions
 * derselben Auswahl. Default "original" für Rückwärtskompatibilität mit
 * Aufrufern, die das Feld nicht setzen.
 */
export async function requestZipDownload(opts: RequestZipOptions) {
  const variant: DownloadVariant = opts.variant ?? "original";
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
      variant,
    },
    orderBy: { createdAt: "desc" },
  });

  const now = new Date();

  if (
    existing &&
    existing.status === "ready" &&
    existing.expiresAt > now &&
    (existing.storageKey !== null || existing.partCount >= 2)
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
          partCount: 0,
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
          variant,
          status: "pending",
          expiresAt,
        },
      });

  // Effektive Teil-ZIP-Obergrenze aus dem Tenant-Setting (Fallback: ENV).
  const tenant = await prisma.tenant.findUnique({
    where: { id: opts.tenantId },
    select: { zipPartMaxMib: true },
  });
  const partMaxBytes = effectiveZipPartBytes(tenant?.zipPartMaxMib ?? null);

  await enqueue(Queues.ZIP_BUILD, {
    type: "build_zip",
    tenantId: opts.tenantId,
    galleryId: opts.galleryId,
    fileIds: opts.fileIds,
    label: opts.label,
    accessId: opts.accessId ?? undefined,
    zipDownloadId: record.id,
    variant,
    partMaxBytes,
  });

  return record;
}
