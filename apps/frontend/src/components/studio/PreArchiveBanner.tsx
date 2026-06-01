"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";

/**
 * Pre-Archive-Banner — zeigt sich am oberen Rand der Studio-Main-Area,
 * wenn der Tenant einen archiveScheduledAt gesetzt hat. Drei Modi:
 *
 *   1. Mehr als 7 Tage bis Stichtag: dezenter blauer Banner
 *   2. 7 Tage oder weniger: gelbe Warnung
 *   3. Stichtag erreicht: rote Warnung (sollte selten passieren da
 *      der Super-Admin das normalerweise schnell auflöst)
 *
 * Aktion: Link auf /studio/exports damit der Tenant seine Daten sichert.
 *
 * Lädt einmalig beim Mount. Bei mehrstündigen Sessions ist der
 * Banner-Status stabil — kein Polling nötig.
 */
export function PreArchiveBanner() {
  const t = useT();
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.me();
        if (cancelled) return;
        if (r.tenant?.archiveScheduledAt) {
          setScheduledAt(new Date(r.tenant.archiveScheduledAt));
        }
      } catch {
        // Bei Fehler einfach nichts rendern — sollte selten sein,
        // me() wird beim Studio-Aufruf eh ständig abgefragt.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!scheduledAt) return null;

  const remainingMs = scheduledAt.getTime() - Date.now();
  const daysLeft = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
  const reached = remainingMs <= 0;
  const urgent = !reached && daysLeft <= 7;

  const cls = reached
    ? "bg-semantic-danger/10 border-semantic-danger/30 text-semantic-danger"
    : urgent
    ? "bg-semantic-warning/10 border-semantic-warning/30 text-semantic-warning"
    : "bg-accent/10 border-accent/30 text-accent";

  const headline = reached
    ? t("preArchive.imminent")
    : urgent
    ? t(daysLeft === 1 ? "preArchive.inDaysSg" : "preArchive.inDaysPl", { n: daysLeft })
    : t("preArchive.onDate", { date: scheduledAt.toLocaleDateString("de-DE"), n: daysLeft });

  return (
    <div className={`border-b px-6 py-3 ${cls}`}>
      <div className="max-w-7xl mx-auto flex items-start justify-between gap-3 flex-wrap">
        <div className="text-ui-sm min-w-0 flex-1">
          <div className="font-medium">{headline}</div>
          <div className="text-ui-xs opacity-80 mt-0.5">
            {t("preArchive.body")}
          </div>
        </div>
        <Link
          href="/studio/exports"
          className="inline-flex items-center h-8 px-3 rounded text-ui-sm bg-current text-surface-base hover:opacity-90 transition-opacity duration-motion"
        >
          {t("preArchive.toExport")}
        </Link>
      </div>
    </div>
  );
}
