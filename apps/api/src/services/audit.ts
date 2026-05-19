/**
 * Lumio API — Audit Log
 *
 * Zentraler Helfer zum Schreiben von Audit-Events in die events-Tabelle.
 * Wird von Routen aufgerufen, wenn etwas Sicherheits- oder
 * Compliance-relevantes passiert: Logins, Galerie-CRUD, File-Deletes,
 * Share-Creates, Selection-Finalize, Branding-Updates.
 *
 * Failure-Verhalten: stille Failures. Ein Audit-Log-Write soll niemals
 * den eigentlichen Request killen — wenn die events-Tabelle kurz nicht
 * erreichbar ist, loggen wir die Warnung und der User merkt nichts.
 *
 * Datenschutz: das payload-Feld ist absichtlich JSON, nicht Free-Text.
 * Aufrufer sollen nur strukturierte, nicht-sensible Daten reinschreiben
 * (Titel, neue Werte, Anzahl Files). Keine Passwörter, keine Tokens,
 * keine E-Mail-Bodies. IP wird gespeichert, weil sie für Forensik der
 * mit Abstand wertvollste Datenpunkt ist.
 */
import { prisma } from "../db.js";
import { logger } from "../logger.js";

export type AuditActorType = "user" | "access" | "system";

export interface AuditLogInput {
  tenantId: string;
  actorType: AuditActorType;
  actorId?: string | null;
  action: string; // siehe Aktion-Konventionen unten
  targetType?: string | null;
  targetId?: string | null;
  payload?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

/**
 * Action-Naming-Konvention: punktnotiert, `<resource>.<verb>`.
 *
 *   auth.login                  — erfolgreicher Login
 *   auth.login.failed           — Passwort falsch / 2FA falsch
 *   auth.logout
 *   gallery.create
 *   gallery.update
 *   gallery.delete
 *   file.delete
 *   file.bulk                   — payload: { action, count }
 *   share.create
 *   share.delete
 *   share.unlock                — Kunde hat sich an einem Share-Token erfolgreich angemeldet
 *   selection.finalize
 *   branding.update
 *
 * Neue Aktionen einfach hinzufügen — das Schema verträgt freien Text.
 */
export async function logEvent(input: AuditLogInput): Promise<void> {
  try {
    await prisma.event.create({
      data: {
        tenantId: input.tenantId,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        payload: (input.payload ?? null) as never,
        ipAddress: input.ipAddress ?? null,
      },
    });
  } catch (err) {
    logger.warn(
      { err, action: input.action, tenantId: input.tenantId },
      "audit: write failed"
    );
  }
}
