/**
 * Lumio API — Notification-Einstellungen (Studio)
 *
 * Zentraler Katalog aller Studio-E-Mail-Benachrichtigungen + Prüfung, ob
 * ein Event für einen Tenant aktiv ist. Prefs liegen als JSON-Map
 * (eventKey→bool) auf Tenant.notificationPrefs; fehlender Key = Default.
 *
 * Neue Benachrichtigung hinzufügen:
 *   1. Hier einen Eintrag in STUDIO_NOTIFICATION_EVENTS ergänzen.
 *   2. An der Auslöse-Stelle `studioNotifyEnabled(tenantId, "<key>")` prüfen.
 *   3. i18n-Label/Beschreibung im Frontend ergänzen (super/studio settings).
 */
import { prisma } from "../db.js";
import { logger } from "../logger.js";

export interface StudioNotificationEvent {
  key: string;
  /** Kurzlabel fürs UI */
  label: string;
  /** Erklärung fürs UI */
  description: string;
  /** Standardzustand, wenn der Tenant nichts gesetzt hat */
  defaultOn: boolean;
}

/**
 * Katalog der Studio-Benachrichtigungen. Reihenfolge = Anzeigereihenfolge
 * in den Studio-Einstellungen.
 */
export const STUDIO_NOTIFICATION_EVENTS: StudioNotificationEvent[] = [
  {
    key: "gallery_comment",
    label: "Neuer Kommentar",
    description: "Ein Kunde hat einen Kommentar in einer Galerie hinterlassen.",
    defaultOn: true,
  },
  {
    key: "selection_finished",
    label: "Auswahl abgeschlossen",
    description: "Ein Kunde hat seine Bildauswahl abgeschlossen.",
    defaultOn: true,
  },
  {
    key: "print_order",
    label: "Neue Print-Bestellung",
    description: "Ein Kunde hat eine Print-Bestellung aufgegeben.",
    defaultOn: true,
  },
  {
    key: "storage_warning",
    label: "Speicher fast voll",
    description:
      "Dein belegter Speicher nähert sich dem Limit deines Tarifs (ab 90 %).",
    defaultOn: true,
  },
];

const STUDIO_EVENT_KEYS = new Set(
  STUDIO_NOTIFICATION_EVENTS.map((e) => e.key)
);
const STUDIO_DEFAULTS: Record<string, boolean> = Object.fromEntries(
  STUDIO_NOTIFICATION_EVENTS.map((e) => [e.key, e.defaultOn])
);

/** Rohe Prefs eines Tenants als eventKey→bool (mit Defaults aufgefüllt). */
export function resolveStudioPrefs(
  raw: unknown
): Record<string, boolean> {
  const out: Record<string, boolean> = { ...STUDIO_DEFAULTS };
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (STUDIO_EVENT_KEYS.has(k) && typeof v === "boolean") {
        out[k] = v;
      }
    }
  }
  return out;
}

/**
 * Prüft, ob ein Studio-Notification-Event für einen Tenant aktiv ist.
 * Defensiv: bei DB-Fehler oder unbekanntem Key → Default (eher senden).
 */
export async function studioNotifyEnabled(
  tenantId: string | null | undefined,
  key: string
): Promise<boolean> {
  const fallback = STUDIO_DEFAULTS[key] ?? true;
  if (!tenantId) return fallback;
  try {
    const t = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { notificationPrefs: true },
    });
    const prefs = resolveStudioPrefs(t?.notificationPrefs);
    return prefs[key] ?? fallback;
  } catch (err) {
    logger.warn({ err, key }, "studioNotifyEnabled: lookup failed");
    return fallback;
  }
}

/** Validiert eine eingehende Prefs-Map (nur bekannte Keys, nur bool). */
export function sanitizeStudioPrefs(
  input: unknown
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (input && typeof input === "object") {
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (STUDIO_EVENT_KEYS.has(k) && typeof v === "boolean") out[k] = v;
    }
  }
  return out;
}
