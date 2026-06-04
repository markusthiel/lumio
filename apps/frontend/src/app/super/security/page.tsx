"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type SuperSecurityResponse } from "@/lib/api";
import { SuperShell } from "@/components/super/SuperShell";

export default function SuperSecurityPage() {
  return (
    <SuperShell>
      <SecurityView />
    </SuperShell>
  );
}

const ACTION_LABEL: Record<string, string> = {
  "auth.login.failed": "Login",
  "auth.login.totp.failed": "2FA",
  "auth.webauthn.login.failed": "WebAuthn",
  "super.login.failed": "Super-Login",
};

function SecurityView() {
  const [data, setData] = useState<SuperSecurityResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.superGetSecurity());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="px-4 sm:px-8 py-6 max-w-5xl">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
        <h1 className="text-2xl font-semibold">Security</h1>
        <button
          type="button"
          onClick={() => void load()}
          className="h-9 px-4 rounded border border-line-subtle text-ui-sm hover:bg-surface-sunken"
        >
          Aktualisieren
        </button>
      </div>
      <p className="text-ui-sm text-ink-tertiary mb-6 max-w-2xl">
        Abuse-Signale aus dem Audit-Log: fehlgeschlagene Anmeldungen (inkl. 2FA,
        WebAuthn, Super-Admin) und fehlgeschlagene Galerie-Entsperrungen
        (Brute-Force-Indikator). Zeitraum: letzte 7 Tage.
      </p>

      {loading || !data ? (
        <div className="text-ui text-ink-tertiary">Lädt…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            <CountCard
              label="Fehl-Logins 24 h"
              value={data.counts.failedLogins.d1}
            />
            <CountCard
              label="Fehl-Logins 7 T"
              value={data.counts.failedLogins.d7}
              muted
            />
            <CountCard
              label="Fehl-Entsperrungen 24 h"
              value={data.counts.failedUnlocks.d1}
            />
            <CountCard
              label="Fehl-Entsperrungen 7 T"
              value={data.counts.failedUnlocks.d7}
              muted
            />
          </div>

          {data.topIps.length > 0 && (
            <div className="mb-8">
              <h2 className="text-ui font-semibold mb-3">
                Top-IPs (Fehl-Logins, 7 T)
              </h2>
              <div className="border border-line-subtle rounded-md bg-surface-raised overflow-hidden">
                <table className="w-full text-ui-sm">
                  <tbody>
                    {data.topIps.map((r) => (
                      <tr
                        key={r.ip}
                        className="border-b border-line-subtle last:border-0"
                      >
                        <td className="px-3 py-2 font-mono text-ui-xs">
                          {r.ip}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.count}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="mb-8">
            <h2 className="text-ui font-semibold mb-3">
              Letzte fehlgeschlagene Anmeldungen
            </h2>
            {data.recentLogins.length === 0 ? (
              <EmptyBox text="Keine fehlgeschlagenen Anmeldungen in den letzten 7 Tagen." />
            ) : (
              <div className="border border-line-subtle rounded-md bg-surface-raised overflow-x-auto">
                <table className="w-full text-ui-sm">
                  <tbody>
                    {data.recentLogins.map((r, i) => (
                      <tr
                        key={i}
                        className="border-b border-line-subtle last:border-0 align-top"
                      >
                        <td className="px-3 py-2">
                          <span className="px-2 py-0.5 rounded text-ui-xs font-medium bg-semantic-warning/10 text-semantic-warning whitespace-nowrap">
                            {ACTION_LABEL[r.action] ?? r.action}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {r.email && (
                            <div className="break-all">{r.email}</div>
                          )}
                          <div className="text-ink-tertiary text-ui-xs">
                            {r.tenant ? r.tenant + " · " : ""}
                            {r.reason ?? ""}
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono text-ui-xs whitespace-nowrap">
                          {r.ip}
                        </td>
                        <td className="px-3 py-2 text-ink-tertiary text-ui-xs whitespace-nowrap">
                          {new Date(r.at).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {data.recentUnlocks.length > 0 && (
            <div className="mb-8">
              <h2 className="text-ui font-semibold mb-3">
                Letzte fehlgeschlagene Galerie-Entsperrungen
              </h2>
              <div className="border border-line-subtle rounded-md bg-surface-raised overflow-x-auto">
                <table className="w-full text-ui-sm">
                  <tbody>
                    {data.recentUnlocks.map((r, i) => (
                      <tr
                        key={i}
                        className="border-b border-line-subtle last:border-0"
                      >
                        <td className="px-3 py-2 text-ink-secondary">
                          {r.tenant ?? "—"}
                        </td>
                        <td className="px-3 py-2 font-mono text-ui-xs">
                          {r.ip}
                        </td>
                        <td className="px-3 py-2 text-ink-tertiary text-ui-xs whitespace-nowrap text-right">
                          {new Date(r.at).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CountCard({
  label,
  value,
  muted,
}: {
  label: string;
  value: number;
  muted?: boolean;
}) {
  return (
    <div className="border border-line-subtle rounded-md bg-surface-raised p-3">
      <div
        className={
          "text-2xl font-semibold tabular-nums " +
          (value > 0 && !muted
            ? "text-semantic-warning"
            : "text-ink-primary")
        }
      >
        {value}
      </div>
      <div className="text-ui-xs text-ink-tertiary mt-0.5">{label}</div>
    </div>
  );
}

function EmptyBox({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-line-subtle bg-surface-sunken p-8 text-center">
      <p className="text-ui-sm text-ink-tertiary">{text}</p>
    </div>
  );
}
