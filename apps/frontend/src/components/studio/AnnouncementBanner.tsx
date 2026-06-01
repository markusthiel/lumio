"use client";

/**
 * Lumio Studio — System-Announcement-Banner
 *
 * Wird in jedem Studio-Shell oben angezeigt. Pollt /announcements/active
 * alle 5 Minuten (Lumio-typische Trade-off: Banner sind keine harten
 * Echtzeitnachrichten, 5 Min reichen).
 *
 * Dismissible-Logik:
 *  - Wenn dismissible=true und severity!=critical: User kann wegklicken,
 *    Dismiss merken wir in localStorage (Key inkl. Announcement-ID).
 *  - Wenn severity=critical: kein Dismiss-Button.
 *
 * Mehrere aktive Announcements: alle werden untereinander angezeigt
 * (sortiert vom Backend: severity desc, dann createdAt desc).
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";

type Announcement = Awaited<
  ReturnType<typeof api.listActiveAnnouncements>
>["announcements"][number];

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const DISMISS_STORAGE_PREFIX = "lumio.announcement.dismissed.";

export function AnnouncementBanner() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // Dismiss-State einmalig laden
  useEffect(() => {
    if (typeof window === "undefined") return;
    const ids = new Set<string>();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(DISMISS_STORAGE_PREFIX)) {
        ids.add(key.slice(DISMISS_STORAGE_PREFIX.length));
      }
    }
    setDismissed(ids);
  }, []);

  // Polling
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await api.listActiveAnnouncements();
        if (!cancelled) setAnnouncements(r.announcements);
      } catch {
        // Banner-Fehler sind nicht kritisch; einfach naechsten Poll
        // abwarten.
      }
    }
    void load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  function dismiss(id: string) {
    if (typeof window !== "undefined") {
      localStorage.setItem(DISMISS_STORAGE_PREFIX + id, "1");
    }
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  const visible = announcements.filter(
    (a) => a.severity === "critical" || !dismissed.has(a.id)
  );

  if (visible.length === 0) return null;

  return (
    <>
      {visible.map((a) => (
        <AnnouncementRow key={a.id} a={a} onDismiss={dismiss} />
      ))}
    </>
  );
}

function AnnouncementRow({
  a,
  onDismiss,
}: {
  a: Announcement;
  onDismiss: (id: string) => void;
}) {
  const t = useT();
  const canDismiss = a.severity !== "critical" && a.dismissible;
  const colorClasses = (() => {
    switch (a.severity) {
      case "critical":
        return "bg-semantic-danger text-white";
      case "warning":
        return "bg-semantic-warning text-black";
      default:
        return "bg-accent/15 text-ink-primary border-b border-accent/30";
    }
  })();

  return (
    <div
      className={`${colorClasses} px-4 py-2 text-sm flex items-start gap-3`}
    >
      <div className="flex-1 min-w-0">
        <strong className="font-semibold">{a.title}</strong>
        <span className="ml-2 opacity-90 whitespace-pre-wrap">{a.body}</span>
        {a.activeUntil && (
          <span className="ml-2 opacity-70 text-xs">
            (bis{" "}
            {new Date(a.activeUntil).toLocaleString("de-DE", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
            )
          </span>
        )}
      </div>
      {canDismiss && (
        <button
          type="button"
          onClick={() => onDismiss(a.id)}
          aria-label={t("announcement.dismiss")}
          className="text-xs px-2 py-0.5 rounded hover:bg-black/15 opacity-70 hover:opacity-100"
        >
          ×
        </button>
      )}
    </div>
  );
}
