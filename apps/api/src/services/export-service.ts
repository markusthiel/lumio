/**
 * Lumio API — Export Service
 *
 * Zentrale Logik zum Erstellen eines TenantExport. Wird von drei
 * Stellen gerufen:
 *
 *   - Studio: einzelne Galerie exportieren (galleryIds = [gid])
 *   - Studio: alle Galerien exportieren (galleryIds = null → wir
 *     resolven alle Galerien des Tenants)
 *   - Super-Admin: Tenant exportieren (alle Galerien), optional mit
 *     ExportToken für ungeloggte Downloads während Karenz
 *
 * Pro Galerie wird ein TenantExportItem angelegt und in EXPORT-Queue
 * gestellt. Worker baut pro Item eine ZIP. Wenn das letzte Item
 * fertig ist (status='ready' oder 'failed'), setzt der Worker den
 * Header-TenantExport auf 'ready'.
 */
import crypto from "node:crypto";
import { prisma } from "../db.js";
import { enqueue, Queues } from "./queue.js";
import { listDeletedOriginalGalleries } from "./storage.js";

/** 30 Tage Lebensdauer der Export-ZIPs in S3 plus Token. Wenn jemand
 *  später runterladen will, müssten wir das verlängern. */
export const EXPORT_TTL_DAYS = 30;
const EXPORT_TTL_MS = EXPORT_TTL_DAYS * 24 * 60 * 60 * 1000;

export interface CreateExportOptions {
  tenantId: string;
  source: "studio" | "studio_all" | "super_admin";
  /** Wenn null: alle Galerien des Tenants werden exportiert. */
  galleryIds: string[] | null;
  /** Wenn gesetzt: User-ID des Studio-Triggers. */
  triggeredByUserId?: string;
  /** Wenn gesetzt: Super-Admin-ID. */
  triggeredBySuperAdminId?: string;
  /** Wenn true: ein ExportToken wird generiert und mitgeliefert
   *  (Default false). Nur sinnvoll bei super_admin-Triggers für
   *  archivierte Tenants — Token erlaubt Download ohne Login. */
  createToken?: boolean;
}

export interface CreateExportResult {
  exportId: string;
  itemCount: number;
  token: string | null;
}

/** Legt einen TenantExport an und enqueued ein Item pro Galerie.
 *  Liefert die exportId + optional ein Token zurueck. */
export async function createExport(
  opts: CreateExportOptions
): Promise<CreateExportResult> {
  // Galerien resolven. Wir snapshotten Name+Slug zum Item — falls die
  // Galerie zwischenzeitlich umbenannt oder gelöscht wird, bleibt der
  // Export-Eintrag aussagekräftig.
  const galleries = await prisma.gallery.findMany({
    where: {
      tenantId: opts.tenantId,
      ...(opts.galleryIds
        ? { id: { in: opts.galleryIds } }
        : {}),
    },
    select: { id: true, slug: true, title: true },
  });

  if (galleries.length === 0) {
    throw new Error("no_galleries_to_export");
  }

  const expiresAt = new Date(Date.now() + EXPORT_TTL_MS);

  // Header + alle Items in einer Transaktion, damit wir bei Fehler nicht
  // mit halb-angelegten Items dastehen. Token (falls gewollt) eben auch.
  const result = await prisma.$transaction(async (tx) => {
    const exportRow = await tx.tenantExport.create({
      data: {
        tenantId: opts.tenantId,
        source: opts.source,
        status: "pending",
        triggeredByUserId: opts.triggeredByUserId ?? null,
        triggeredBySuperAdminId: opts.triggeredBySuperAdminId ?? null,
        expiresAt,
      },
    });

    const items = await Promise.all(
      galleries.map((g) =>
        tx.tenantExportItem.create({
          data: {
            exportId: exportRow.id,
            galleryId: g.id,
            gallerySlug: g.slug,
            galleryName: g.title,
            status: "pending",
          },
        })
      )
    );

    let tokenValue: string | null = null;
    if (opts.createToken) {
      // 32 Bytes → base64url ≈ 43 Chars, kollisionsfrei und nicht
      // ratbar (256 Bit Entropie).
      tokenValue = crypto.randomBytes(32).toString("base64url");
      await tx.exportToken.create({
        data: {
          exportId: exportRow.id,
          token: tokenValue,
          expiresAt,
        },
      });
    }

    return {
      exportId: exportRow.id,
      items,
      token: tokenValue,
    };
  });

  // Jobs queuen NACH der Transaktion. Falls enqueue scheitert (Redis
  // down), bleibt der Export in 'pending' stehen — bei DB-Healthchecks
  // sehen wir das später. Wichtiger ist, dass die Transaktion atomar
  // bleibt.
  await Promise.all(
    result.items.map((item) =>
      enqueue(Queues.EXPORT, {
        type: "export_zip",
        exportItemId: item.id,
        tenantId: opts.tenantId,
        galleryId: item.galleryId!,
      })
    )
  );

  return {
    exportId: result.exportId,
    itemCount: result.items.length,
    token: result.token,
  };
}

/** Ergebnis einer Recovery-Export-Erstellung. */
export interface CreateRecoveryResult {
  exportId: string;
  itemCount: number;
}

/**
 * Notfall-Wiederherstellung gelöschter Originale (Super-Admin).
 *
 * Anders als createExport ist das NICHT DB-getrieben (die Galerien sind ja
 * gelöscht), sondern S3-getrieben: wir suchen über die noncurrent Versionen
 * des Buckets die Galerie-Prefixe mit gelöschten Originalen, legen pro
 * Galerie ein TenantExportItem an und stoßen je einen recover_deleted-Job
 * an. Der Worker baut pro Galerie ein ZIP aus den gelöschten Versionen.
 *
 * Wirft "no_deleted_originals", wenn nichts Wiederherstellbares gefunden
 * wird (nichts gelöscht, oder außerhalb des 30-Tage-Fensters).
 */
export async function createRecoveryExport(opts: {
  tenantId: string;
  triggeredBySuperAdminId: string;
}): Promise<CreateRecoveryResult> {
  const galleryIds = await listDeletedOriginalGalleries(opts.tenantId);
  if (galleryIds.length === 0) {
    throw new Error("no_deleted_originals");
  }

  const expiresAt = new Date(Date.now() + EXPORT_TTL_MS);

  const result = await prisma.$transaction(async (tx) => {
    const exportRow = await tx.tenantExport.create({
      data: {
        tenantId: opts.tenantId,
        source: "super_admin_recovery",
        status: "pending",
        triggeredBySuperAdminId: opts.triggeredBySuperAdminId,
        expiresAt,
      },
    });

    const items = await Promise.all(
      galleryIds.map((gid) =>
        tx.tenantExportItem.create({
          data: {
            exportId: exportRow.id,
            // galleryId snapshotten wir als Referenz; die Galerie existiert
            // in der DB nicht mehr, daher Slug/Name aus der ID ableiten.
            galleryId: gid,
            gallerySlug: `recovered-${gid.slice(0, 8)}`,
            galleryName: `Gelöschte Galerie ${gid.slice(0, 8)}`,
            status: "pending",
          },
        })
      )
    );

    return { exportId: exportRow.id, items };
  });

  await Promise.all(
    result.items.map((item) =>
      enqueue(Queues.EXPORT, {
        type: "recover_deleted",
        exportItemId: item.id,
        tenantId: opts.tenantId,
        galleryId: item.galleryId!,
      })
    )
  );

  return {
    exportId: result.exportId,
    itemCount: result.items.length,
  };
}
