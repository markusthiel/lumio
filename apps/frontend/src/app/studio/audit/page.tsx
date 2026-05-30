"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, type AuditEvent, type Gallery } from "@/lib/api";
import { PageHeader } from "@/components/studio/PageHeader";
import { Button } from "@/components/ui";

const PAGE_SIZE = 100;

// Hübsche Labels für die meistgenutzten Aktionen. Unbekannte Aktionen
// werden roh angezeigt — das ist ok, weil der Action-Name selbst schon
// punktnotiert und einigermaßen lesbar ist.
const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Login",
  "auth.login.failed": "Login fehlgeschlagen",
  "auth.login.totp": "Login (2FA)",
  "auth.login.totp.failed": "2FA fehlgeschlagen",
  "auth.logout": "Logout",
  "gallery.create": "Galerie erstellt",
  "gallery.update": "Galerie geändert",
  "gallery.delete": "Galerie gelöscht",
  "file.delete": "Datei gelöscht",
  "file.bulk": "Massenoperation",
  "share.create": "Share-Link erstellt",
  "share.delete": "Share-Link gelöscht",
  "share.unlock": "Galerie entsperrt",
  "share.unlock.failed": "Entsperren fehlgeschlagen",
  "selection.finalize": "Auswahl abgeschlossen",
  "branding.create": "Branding erstellt",
  "branding.update": "Branding geändert",
  "branding.delete": "Branding gelöscht",
  "branding.set_default": "Branding als Standard",
};

const ACTION_OPTIONS = Object.keys(ACTION_LABELS);

export default function AuditPage() {
  const router = useRouter();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [galleries, setGalleries] = useState<Gallery[]>([]);

  // Filter
  const [galleryId, setGalleryId] = useState<string>("");
  const [action, setAction] = useState<string>("");
  const [since, setSince] = useState<string>("");
  const [until, setUntil] = useState<string>("");

  const fetchPage = useCallback(
    async (reset: boolean) => {
      setLoading(true);
      try {
        const res = await api.listAuditEvents({
          galleryId: galleryId || undefined,
          action: action || undefined,
          since: since ? new Date(since).toISOString() : undefined,
          until: until ? new Date(until).toISOString() : undefined,
          limit: PAGE_SIZE,
          cursor: reset ? undefined : nextCursor ?? undefined,
        });
        setEvents((prev) => (reset ? res.events : [...prev, ...res.events]));
        setNextCursor(res.nextCursor);
      } catch (err) {
        if (err instanceof Error && err.message.includes("401")) {
          router.replace("/login");
        }
      } finally {
        setLoading(false);
      }
    },
    [galleryId, action, since, until, nextCursor, router]
  );

  // Galerie-Liste für den Filter
  useEffect(() => {
    void (async () => {
      try {
        const res = await api.listGalleries();
        setGalleries(res.galleries);
      } catch {
        /* nicht-blockierend */
      }
    })();
  }, []);

  // Erste Page beim Mount + bei Filterwechsel. nextCursor MUSS aus den
  // Deps draußen bleiben, sonst löst der reset einen Loop aus.
  useEffect(() => {
    void fetchPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryId, action, since, until]);

  function exportCsv() {
    // Client-seitig: nimmt den aktuellen Filtersatz (alle bereits
    // geladenen Events). Für den großen Export auf dem Server gibt's
    // eine TODO-Notiz in der Roadmap.
    const rows = [
      ["timestamp", "action", "actorType", "actorId", "targetType", "targetId", "ipAddress", "payload"],
      ...events.map((e) => [
        e.createdAt,
        e.action,
        e.actorType,
        e.actorId ?? "",
        e.targetType ?? "",
        e.targetId ?? "",
        e.ipAddress ?? "",
        e.payload ? JSON.stringify(e.payload) : "",
      ]),
    ];
    const csv = rows
      .map((r) =>
        r
          .map((cell) => {
            const s = String(cell);
            return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(",")
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lumio-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Studio", href: "/studio" }, { label: "Audit" }]}
        title="Audit-Log"
        description="Logins, Galerie-Änderungen, Kunden-Aktivität. Read-only, gefiltert nach deinem Tenant."
        actions={
          <Button
            variant="secondary"
            onClick={exportCsv}
            disabled={events.length === 0}
          >
            CSV exportieren ({events.length})
          </Button>
        }
      />

      <div className="px-6 sm:px-8 lg:px-12 py-6 space-y-4 max-w-5xl">
        {/* Filter-Bar */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          <div>
            <label className="block text-xs text-ink-tertiary mb-1">Galerie</label>
            <select
              value={galleryId}
              onChange={(e) => setGalleryId(e.target.value)}
              className="w-full rounded-md border border-line-subtle px-2 py-1.5 bg-surface-raised"
            >
              <option value="">Alle</option>
              {galleries.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-ink-tertiary mb-1">Aktion</label>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="w-full rounded-md border border-line-subtle px-2 py-1.5 bg-surface-raised"
            >
              <option value="">Alle</option>
              {ACTION_OPTIONS.map((a) => (
                <option key={a} value={a}>
                  {ACTION_LABELS[a] ?? a}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-ink-tertiary mb-1">Von</label>
            <input
              type="datetime-local"
              value={since}
              onChange={(e) => setSince(e.target.value)}
              className="w-full rounded-md border border-line-subtle px-2 py-1.5 bg-surface-raised"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-tertiary mb-1">Bis</label>
            <input
              type="datetime-local"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              className="w-full rounded-md border border-line-subtle px-2 py-1.5 bg-surface-raised"
            />
          </div>
        </section>

        {/* Tabelle */}
        <section className="rounded-lg border border-line-subtle bg-surface-raised overflow-x-auto">
          {events.length === 0 && !loading ? (
            <div className="p-8 text-sm text-ink-tertiary text-center">
              Keine Events für diesen Filter.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-surface-sunken text-ink-secondary">
                <tr>
                  <th className="text-left p-2 font-medium">Zeitpunkt</th>
                  <th className="text-left p-2 font-medium">Aktion</th>
                  <th className="text-left p-2 font-medium">Akteur</th>
                  <th className="text-left p-2 font-medium">Ziel</th>
                  <th className="text-left p-2 font-medium">IP</th>
                  <th className="text-left p-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <EventRow key={e.id} event={e} galleries={galleries} />
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Pagination */}
        <div className="flex items-center justify-center gap-3 pt-2">
          {loading && (
            <div className="text-xs text-ink-tertiary">Lädt…</div>
          )}
          {nextCursor && !loading && (
            <button
              type="button"
              onClick={() => void fetchPage(false)}
              className="text-sm rounded-md border border-line-subtle px-3 py-1.5 hover:bg-surface-sunken"
            >
              Mehr laden
            </button>
          )}
          {!nextCursor && events.length > 0 && !loading && (
            <div className="text-xs text-ink-tertiary">— Ende —</div>
          )}
        </div>
      </div>
    </>
  );
}

function EventRow({
  event,
  galleries,
}: {
  event: AuditEvent;
  galleries: Gallery[];
}) {
  const label = ACTION_LABELS[event.action] ?? event.action;

  // Failure-Aktionen rot hinterlegen — die fallen beim Scrollen sofort auf
  const failed = event.action.endsWith(".failed");

  // Galerie-Name aus payload.galleryId oder targetId rekonstruieren
  const galleryId =
    (event.payload as { galleryId?: string } | null)?.galleryId ??
    (event.targetType === "gallery" ? event.targetId : null);
  const gallery = galleryId ? galleries.find((g) => g.id === galleryId) : null;

  return (
    <tr className={`border-t border-line-subtle ${failed ? "bg-rose-50" : ""}`}>
      <td className="p-2 whitespace-nowrap font-mono text-ink-secondary">
        {formatTimestamp(event.createdAt)}
      </td>
      <td className="p-2 whitespace-nowrap">
        <span
          className={`inline-block px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-medium ${
            failed
              ? "bg-rose-100 text-rose-800"
              : "bg-surface-sunken text-ink-secondary"
          }`}
        >
          {label}
        </span>
      </td>
      <td className="p-2 whitespace-nowrap text-ink-secondary">
        {event.actorType}
        {event.actorId && (
          <span className="text-ink-tertiary ml-1 font-mono">
            ({event.actorId.slice(0, 8)}…)
          </span>
        )}
      </td>
      <td className="p-2 whitespace-nowrap text-ink-secondary">
        {gallery ? (
          <Link
            href={`/studio/${gallery.id}`}
            className="text-ink-secondary hover:underline"
          >
            {gallery.title}
          </Link>
        ) : event.targetType ? (
          <span className="text-ink-tertiary">
            {event.targetType}
            {event.targetId ? ` (${event.targetId.slice(0, 8)}…)` : ""}
          </span>
        ) : (
          <span className="text-ink-tertiary">—</span>
        )}
      </td>
      <td className="p-2 whitespace-nowrap font-mono text-ink-tertiary">
        {event.ipAddress ?? "—"}
      </td>
      <td className="p-2 font-mono text-ink-tertiary max-w-md truncate">
        {event.payload ? JSON.stringify(event.payload) : ""}
      </td>
    </tr>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
