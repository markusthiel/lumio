"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api,
  type SuperComplianceResponse,
  type ComplianceTenantRow,
} from "@/lib/api";
import { SuperShell } from "@/components/super/SuperShell";

export default function SuperCompliancePage() {
  return (
    <SuperShell>
      <ComplianceView />
    </SuperShell>
  );
}

function isFlagged(t: ComplianceTenantRow): boolean {
  return (
    !t.dpaSigned ||
    t.dpaOutdated ||
    !!t.deletionScheduledFor ||
    !!t.archiveScheduledAt ||
    t.status === "archived"
  );
}

function ComplianceView() {
  const [data, setData] = useState<SuperComplianceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.superGetCompliance());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows =
    data?.tenants.filter((t) => (onlyFlagged ? isFlagged(t) : true)) ?? [];

  return (
    <div className="px-4 sm:px-8 py-6 max-w-5xl">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
        <h1 className="text-2xl font-semibold">Compliance</h1>
        <button
          type="button"
          onClick={() => void load()}
          className="h-9 px-4 rounded border border-line-subtle text-ui-sm hover:bg-surface-sunken"
        >
          Aktualisieren
        </button>
      </div>
      <p className="text-ui-sm text-ink-tertiary mb-6 max-w-2xl">
        AVV-/DSGVO-Status pro Tenant: Auftragsverarbeitungsvertrag (DPA) und
        Lösch-/Archivierungs-Lifecycle. Aktuelle DPA-Version:{" "}
        <strong>{data?.currentDpaVersion ?? "—"}</strong>.
      </p>

      {loading || !data ? (
        <div className="text-ui text-ink-tertiary">Lädt…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <CountCard label="DPA aktuell" value={data.counts.dpaSigned} />
            <CountCard
              label="DPA veraltet"
              value={data.counts.dpaOutdated}
              warn
            />
            <CountCard label="DPA fehlt" value={data.counts.dpaMissing} warn />
            <CountCard
              label="Löschung geplant"
              value={data.counts.deletionScheduled}
              warn
            />
          </div>

          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="text-ui-sm text-ink-tertiary">
              {rows.length} von {data.counts.total} Tenants
            </div>
            <label className="flex items-center gap-2 text-ui-sm text-ink-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={onlyFlagged}
                onChange={(e) => setOnlyFlagged(e.target.checked)}
              />
              Nur auffällige
            </label>
          </div>

          <div className="border border-line-subtle rounded-md bg-surface-raised overflow-x-auto">
            <table className="w-full text-ui-sm">
              <thead className="text-ink-tertiary text-ui-xs uppercase tracking-wide">
                <tr className="border-b border-line-subtle">
                  <th className="text-left font-medium px-3 py-2">Tenant</th>
                  <th className="text-left font-medium px-3 py-2">Status</th>
                  <th className="text-left font-medium px-3 py-2">DPA</th>
                  <th className="text-left font-medium px-3 py-2">Lifecycle</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-line-subtle last:border-0 align-top"
                  >
                    <td className="px-3 py-2">
                      <div>{t.name}</div>
                      <div className="text-ink-tertiary text-ui-xs font-mono">
                        {t.slug}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="px-3 py-2">
                      <DpaCell t={t} />
                    </td>
                    <td className="px-3 py-2">
                      <LifecycleCell t={t} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function CountCard({
  label,
  value,
  warn,
}: {
  label: string;
  value: number;
  warn?: boolean;
}) {
  return (
    <div className="border border-line-subtle rounded-md bg-surface-raised p-3">
      <div
        className={
          "text-2xl font-semibold tabular-nums " +
          (warn && value > 0 ? "text-semantic-warning" : "text-ink-primary")
        }
      >
        {value}
      </div>
      <div className="text-ui-xs text-ink-tertiary mt-0.5">{label}</div>
    </div>
  );
}

function Pill({
  text,
  tone,
}: {
  text: string;
  tone: "success" | "warning" | "danger" | "muted";
}) {
  const cls =
    tone === "success"
      ? "bg-semantic-success/10 text-semantic-success"
      : tone === "warning"
      ? "bg-semantic-warning/10 text-semantic-warning"
      : tone === "danger"
      ? "bg-semantic-danger/10 text-semantic-danger"
      : "bg-surface-sunken text-ink-tertiary";
  return (
    <span
      className={
        "px-2 py-0.5 rounded text-ui-xs font-medium whitespace-nowrap " + cls
      }
    >
      {text}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "active"
      ? "success"
      : status === "archived"
      ? "muted"
      : "warning";
  const label: Record<string, string> = {
    active: "aktiv",
    suspended: "gesperrt",
    archived: "archiviert",
    pending_deletion: "Löschung",
  };
  return <Pill text={label[status] ?? status} tone={tone as never} />;
}

function DpaCell({ t }: { t: ComplianceTenantRow }) {
  if (!t.dpaSigned) return <Pill text="fehlt" tone="danger" />;
  if (t.dpaOutdated)
    return <Pill text={`veraltet (v${t.dpaVersion})`} tone="warning" />;
  return (
    <div>
      <Pill text={`v${t.dpaVersion}`} tone="success" />
      {t.dpaAcceptedAt && (
        <div className="text-ink-tertiary text-ui-xs mt-0.5">
          {new Date(t.dpaAcceptedAt).toLocaleDateString()}
          {t.dpaAcceptedBy ? ` · ${t.dpaAcceptedBy}` : ""}
        </div>
      )}
    </div>
  );
}

function LifecycleCell({ t }: { t: ComplianceTenantRow }) {
  if (t.archivedAt)
    return (
      <span className="text-ink-tertiary text-ui-xs">
        archiviert am {new Date(t.archivedAt).toLocaleDateString()}
      </span>
    );
  if (t.deletionScheduledFor)
    return (
      <span className="text-semantic-danger text-ui-xs">
        Löschung am {new Date(t.deletionScheduledFor).toLocaleDateString()}
      </span>
    );
  if (t.archiveScheduledAt)
    return (
      <span className="text-semantic-warning text-ui-xs">
        Archivierung am{" "}
        {new Date(t.archiveScheduledAt).toLocaleDateString()}
      </span>
    );
  return <span className="text-ink-tertiary text-ui-xs">—</span>;
}
