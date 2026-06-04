"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type MailLogRow, type MailCounts } from "@/lib/api";
import { SuperShell } from "@/components/super/SuperShell";

export default function SuperMailLogPage() {
  return (
    <SuperShell>
      <MailLogView />
    </SuperShell>
  );
}

const EMPTY: MailCounts = { sent: 0, failed: 0, skipped: 0 };

function MailLogView() {
  const [recent, setRecent] = useState<MailLogRow[]>([]);
  const [last24h, setLast24h] = useState<MailCounts>(EMPTY);
  const [last7d, setLast7d] = useState<MailCounts>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [onlyFailed, setOnlyFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.superGetMailLog();
      setRecent(r.recent);
      setLast24h(r.stats.last24h);
      setLast7d(r.stats.last7d);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = onlyFailed
    ? recent.filter((r) => r.status === "failed")
    : recent;

  const noSmtp =
    last7d.sent === 0 && last7d.failed === 0 && last7d.skipped > 0;

  return (
    <div className="px-4 sm:px-8 py-6 max-w-5xl">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
        <h1 className="text-2xl font-semibold">E-Mail-Zustellbarkeit</h1>
        <button
          type="button"
          onClick={() => void load()}
          className="h-9 px-4 rounded border border-line-subtle text-ui-sm hover:bg-surface-sunken"
        >
          Aktualisieren
        </button>
      </div>
      <p className="text-ui-sm text-ink-tertiary mb-6 max-w-2xl">
        Protokoll der ausgehenden Mails (gesendet / fehlgeschlagen /
        übersprungen). „Übersprungen" heißt, es war kein SMTP konfiguriert. Der
        Log umfasst die letzten 30 Tage; ältere Einträge werden automatisch
        aufgeräumt.
      </p>

      {noSmtp && (
        <div className="mb-6 rounded-md border border-semantic-warning/40 bg-semantic-warning/10 px-4 py-3 text-ui-sm text-semantic-warning">
          Es wurden zuletzt nur Mails „übersprungen" — vermutlich ist kein SMTP
          konfiguriert. Ohne SMTP werden keine Mails versendet.
        </div>
      )}

      {loading ? (
        <div className="text-ui text-ink-tertiary">Lädt…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <StatGroup title="Letzte 24 Stunden" counts={last24h} />
            <StatGroup title="Letzte 7 Tage" counts={last7d} />
          </div>

          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="text-ui-sm text-ink-tertiary">
              Letzte {recent.length} Mails
            </div>
            <label className="flex items-center gap-2 text-ui-sm text-ink-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={onlyFailed}
                onChange={(e) => setOnlyFailed(e.target.checked)}
              />
              Nur Fehler
            </label>
          </div>

          {rows.length === 0 ? (
            <div className="rounded-md border border-dashed border-line-subtle bg-surface-sunken p-12 text-center">
              <p className="text-ui text-ink-tertiary">
                {onlyFailed
                  ? "Keine fehlgeschlagenen Mails — gut."
                  : "Noch keine Mails protokolliert."}
              </p>
            </div>
          ) : (
            <div className="border border-line-subtle rounded-md bg-surface-raised overflow-hidden">
              <table className="w-full text-ui-sm">
                <thead className="text-ink-tertiary text-ui-xs uppercase tracking-wide">
                  <tr className="border-b border-line-subtle">
                    <th className="text-left font-medium px-3 py-2">Status</th>
                    <th className="text-left font-medium px-3 py-2">
                      Empfänger
                    </th>
                    <th className="text-left font-medium px-3 py-2">Betreff</th>
                    <th className="text-left font-medium px-3 py-2">
                      Zeitpunkt
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr
                      key={m.id}
                      className={
                        "border-b border-line-subtle last:border-0 align-top " +
                        (m.status === "failed" ? "bg-semantic-danger/5" : "")
                      }
                    >
                      <td className="px-3 py-2">
                        <StatusBadge status={m.status} />
                      </td>
                      <td className="px-3 py-2 break-all">{m.recipient}</td>
                      <td className="px-3 py-2">
                        {m.subject}
                        {m.status === "failed" && m.error && (
                          <div className="text-semantic-danger text-ui-xs mt-0.5 break-all">
                            {m.error}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-ink-tertiary text-ui-xs whitespace-nowrap">
                        {new Date(m.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatGroup({ title, counts }: { title: string; counts: MailCounts }) {
  return (
    <div className="border border-line-subtle rounded-md bg-surface-raised p-4">
      <div className="text-ui-xs uppercase tracking-wide text-ink-tertiary mb-3">
        {title}
      </div>
      <div className="flex gap-6">
        <Stat label="Gesendet" value={counts.sent} tone="success" />
        <Stat label="Fehler" value={counts.failed} tone="danger" />
        <Stat label="Übersprungen" value={counts.skipped} tone="muted" />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "danger" | "muted";
}) {
  const color =
    tone === "success"
      ? "text-semantic-success"
      : tone === "danger" && value > 0
      ? "text-semantic-danger"
      : "text-ink-primary";
  return (
    <div>
      <div className={"text-2xl font-semibold tabular-nums " + color}>
        {value}
      </div>
      <div className="text-ui-xs text-ink-tertiary mt-0.5">{label}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    sent: "bg-semantic-success/10 text-semantic-success",
    failed: "bg-semantic-danger/10 text-semantic-danger",
    skipped: "bg-surface-sunken text-ink-tertiary",
  };
  const label: Record<string, string> = {
    sent: "gesendet",
    failed: "Fehler",
    skipped: "übersprungen",
  };
  const cls = map[status] ?? "bg-surface-sunken text-ink-tertiary";
  return (
    <span
      className={
        "px-2 py-0.5 rounded text-ui-xs font-medium whitespace-nowrap " + cls
      }
    >
      {label[status] ?? status}
    </span>
  );
}
