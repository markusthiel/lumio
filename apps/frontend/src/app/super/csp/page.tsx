"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type CspViolationRow } from "@/lib/api";
import { SuperShell } from "@/components/super/SuperShell";

export default function SuperCspPage() {
  return (
    <SuperShell>
      <CspView />
    </SuperShell>
  );
}

function CspView() {
  const [rows, setRows] = useState<CspViolationRow[]>([]);
  const [distinct, setDistinct] = useState(0);
  const [totalEvents, setTotalEvents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.superListCspViolations();
      setRows(r.violations);
      setDistinct(r.distinct);
      setTotalEvents(r.totalEvents);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function clearAll() {
    if (
      !window.confirm(
        "Alle gesammelten CSP-Verstöße löschen? Sinnvoll nach einem Policy-Fix, um sauber neu zu messen."
      )
    ) {
      return;
    }
    setClearing(true);
    try {
      await api.superClearCsp();
      await load();
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="px-4 sm:px-8 py-6 max-w-5xl">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
        <h1 className="text-2xl font-semibold">CSP-Verstöße</h1>
        {rows.length > 0 && (
          <button
            type="button"
            onClick={clearAll}
            disabled={clearing}
            className="h-9 px-4 rounded border border-line-subtle text-ui-sm hover:bg-surface-sunken disabled:opacity-50"
          >
            {clearing ? "Leert…" : "Leeren"}
          </button>
        )}
      </div>
      <p className="text-ui-sm text-ink-tertiary mb-6 max-w-2xl">
        Die Content-Security-Policy läuft im <strong>Report-Only</strong>-Modus
        — sie blockiert nichts, meldet aber Verstöße hierher. Sobald hier über
        echten Traffic nichts Legitimes mehr auftaucht (nur erwartete
        Third-Party-Quellen wie Stripe/Fonts), kann die Policy gefahrlos auf
        „enforced" umgestellt werden. Bis dahin: beobachten und ggf. die
        Whitelist in der Caddy-Policy ergänzen.
      </p>

      {!loading && rows.length > 0 && (
        <div className="text-ui-sm text-ink-tertiary mb-3">
          {distinct} verschiedene Verstöße · {totalEvents} Meldungen gesamt
        </div>
      )}

      {loading ? (
        <div className="text-ui text-ink-tertiary">Lädt…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-line-subtle bg-surface-sunken p-12 text-center">
          <p className="text-ui text-ink-tertiary">
            Noch keine Verstöße gesammelt.
          </p>
          <p className="text-ui-sm text-ink-tertiary mt-2 max-w-md mx-auto">
            Das ist nach frischem Deploy normal — der Browser meldet erst bei
            echtem Seitenaufruf. Wenn nach ein paar Tagen Traffic immer noch
            nichts kommt, passt die Policy vermutlich schon.
          </p>
        </div>
      ) : (
        <div className="border border-line-subtle rounded-md bg-surface-raised overflow-hidden">
          <table className="w-full text-ui-sm">
            <thead className="text-ink-tertiary text-ui-xs uppercase tracking-wide">
              <tr className="border-b border-line-subtle">
                <th className="text-left font-medium px-3 py-2">Directive</th>
                <th className="text-left font-medium px-3 py-2">
                  Blockierte Quelle
                </th>
                <th className="text-right font-medium px-3 py-2">Anzahl</th>
                <th className="text-left font-medium px-3 py-2">
                  Zuletzt
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr
                  key={v.id}
                  className="border-b border-line-subtle last:border-0 align-top"
                >
                  <td className="px-3 py-2 font-mono text-ui-xs whitespace-nowrap">
                    {v.effectiveDirective}
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-mono text-ui-xs break-all">
                      {v.blockedUri}
                    </span>
                    {v.sampleDocumentUri && (
                      <div className="text-ink-tertiary text-ui-xs break-all mt-0.5">
                        auf {v.sampleDocumentUri}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {v.count}
                  </td>
                  <td className="px-3 py-2 text-ink-tertiary text-ui-xs whitespace-nowrap">
                    {new Date(v.lastSeenAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
