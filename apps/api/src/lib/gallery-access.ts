/**
 * Galerie-Zugriffsmodell (granulare Freigabe).
 *
 * Eine Galerie ist für einen Studio-User zugänglich, wenn EINE der
 * folgenden Bedingungen gilt:
 *   1. Er ist der Ersteller (gallery.ownerId)
 *   2. Die Galerie wurde explizit für ihn freigegeben (GalleryCollaborator)
 *   3. Er ist Studio-Inhaber (Rolle "owner") — Sicherheitsnetz, damit
 *      keine Galerien verwaisen, wenn ein Mitarbeiter das Studio verlässt
 *
 * "Zugriff" bedeutet volle Rechte: sehen, bearbeiten, löschen, freigeben.
 * Wer keinen Zugriff hat, sieht die Galerie gar nicht (404).
 *
 * WICHTIG: Diese Helper sind die EINZIGE Stelle, an der das Modell
 * definiert ist. Alle Routen, die auf Galerien (oder deren Dateien,
 * Sektionen, Proofing etc.) zugreifen, müssen darüber filtern — nicht
 * mehr direkt über `ownerId: s.user.id`.
 */
import type { Prisma } from "@prisma/client";
import type { SessionContext } from "../services/auth.js";

/**
 * Prisma-`where`-Fragment für Galerien, die `s` sehen/bearbeiten darf.
 * Immer zusätzlich mit `{ tenantId }` kombinieren, z.B.:
 *   where: { tenantId: req.tenantId, ...galleryAccessWhere(s) }
 *
 * Für Studio-Owner ist das Fragment leer (= keine Einschränkung über die
 * Tenant-Grenze hinaus → alle Galerien des Studios).
 */
export function galleryAccessWhere(
  s: SessionContext
): Prisma.GalleryWhereInput {
  if (s.user.role === "owner") return {};
  return {
    OR: [
      { ownerId: s.user.id },
      { collaborators: { some: { userId: s.user.id } } },
    ],
  };
}

/**
 * Variante zum Einbetten in eine Relation, z.B. wenn nach Dateien einer
 * Galerie gefiltert wird:
 *   where: { gallery: { tenantId, ...galleryAccessWhere(s) } }
 * Identisch zu galleryAccessWhere — als sprechender Alias gedacht.
 */
export const galleryRelationAccessWhere = galleryAccessWhere;

/**
 * Prüft ein bereits geladenes Galerie-Objekt. Für Stellen, die die
 * Galerie ohnehin via `select`/`include` geholt haben und im Code-Fluss
 * prüfen (statt über ein where-Fragment).
 *
 * Erwartet `ownerId` und — sofern relevant — die `collaborators` als
 * `{ userId }[]`. Fehlt `collaborators`, zählt nur Ersteller + Owner-Rolle
 * (der Aufrufer muss die Relation dann mitladen, wenn Freigaben zählen).
 */
export function canAccessGallery(
  s: SessionContext,
  gallery: { ownerId: string; collaborators?: { userId: string }[] }
): boolean {
  if (s.user.role === "owner") return true;
  if (gallery.ownerId === s.user.id) return true;
  return (gallery.collaborators ?? []).some((c) => c.userId === s.user.id);
}

/**
 * Darf `s` die Freigabe-Liste einer Galerie verwalten (Mitglieder hinzufügen
 * /entfernen)? Da Freigegebene volle Rechte haben, dürfen alle mit Zugriff
 * das auch — die Prüfung ist daher identisch zu canAccessGallery.
 */
export const canManageGalleryCollaborators = canAccessGallery;
