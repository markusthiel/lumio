"use client";

/**
 * Super-Admin Storage-Uebersicht
 *
 * Liste aller Tenants mit ihrer Storage-Auslastung. Sortiert: ueber-
 * limit-Tenants oben (rot), 'fast voll' (orange), normal, leer/Self-
 * Hosting unten.
 *
 * Use-Cases:
 *  - Capacity-Planning: 'reicht mein S3-Plan noch?'
 *  - Up-Selling: 'wer ist nah am Limit und koennte zu groesserem Plan wechseln?'
 *  - Cost-Awareness: 'wer kostet am meisten?'
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { SuperShell } from "@/components/super/SuperShell";

type StorageResponse = Awaited<ReturnType<typeof api.superTenantsStorage>>;

export default function SuperStoragePage() {
  return (
    <SuperShell>
      <StorageContent />
    </SuperShell>
  );
}

function StorageContent() {
  const [data, setData] = useState<StorageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .superTenantsStorage()
      .then(setData)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Fehler beim Laden")
      );
  }, []);

  const totalUsedBytes = data?.tenants.reduce((sum, t) => sum + t.usedBytes, 0) ?? 0;
  const overLimitCount =
    data?.tenants.filter((t) => (t.usagePct ?? 0) > 100).length ?? 0;
  const nearLimitCount =
    data?.tenants.filter(
      (t) => (t.usagePct ?? 0) > 80 && (t.usagePct ?? 0) <= 100
    ).length ?? 0;

  return (
    <div className="px-4 sm:px-8 py-6 max-w-5xl">
      <h1 className="text-2xl font-semibold mb-1">Storage-Übersicht</h1>
      <p className="text-ui-sm text-ink-tertiary mb-6">
        Alle Tenants nach Auslastung. Werte aus dem Usage-Cache (wird vom
        Worker periodisch aktualisiert).
      </p>

      {error && (
        <div className="rounded-md border border-semantic-danger/30 bg-semantic-danger/8 px-3 py-2 mb-4 text-sm text-semantic-danger">
          {error}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard label="Aktive Tenants" value={data.tenants.length.toLocaleString("de-DE")} />
            <StatCard label="Gesamt-Storage" value={formatBytes(totalUsedBytes)} />
            <StatCard
              label="Über Limit"
              value={overLimitCount.toLocaleString("de-DE")}
              tone={overLimitCount > 0 ? "danger" : "neutral"}
            />
            <StatCard
              label="Über 80%"
              value={nearLimitCount.toLocaleString("de-DE")}
              tone={nearLimitCount > 0 ? "warning" : "neutral"}
            />
          </div>

          <div className="border border-line-subtle rounded-md bg-surface-raised overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-line-subtle text-xs uppercase tracking-wider text-ink-tertiary text-left">
                  <th className="px-3 py-2 font-medium">Tenant</th>
                  <th className="px-3 py-2 font-medium">Plan</th>
                  <th className="px-3 py-2 font-medium text-right">Belegt</th>
                  <th className="px-3 py-2 font-medium text-right">Limit</th>
                  <th className="px-3 py-2 font-medium">Auslastung</th>
                </tr>
              </thead>
              <tbody>
                {data.tenants.map((t) => (
                  <StorageRow key={t.id} t={t} />
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StorageRow({
  t,
}: {
  t: StorageResponse["tenants"][number];
}) {
  const pct = t.usagePct;
  const limitBytes =
    t.totalLimitGib !== null ? t.totalLimitGib * 1024 ** 3 : null;

  return (
    <tr className="border-b border-line-subtle hover:bg-surface-sunken/40">
      <td className="px-3 py-2">
        <Link
          href={`/super/tenants/${t.id}`}
          className="font-medium hover:underline"
        >
          {t.name}
        </Link>
        <div className="text-xs text-ink-tertiary font-mono">{t.slug}</div>
      </td>
      <td className="px-3 py-2 text-sm">
        {t.planName ?? <span className="text-ink-tertiary italic">Kein Plan</span>}
      </td>
      <td className="px-3 py-2 text-right text-sm font-mono">
        {formatBytes(t.usedBytes)}
      </td>
      <td className="px-3 py-2 text-right text-sm font-mono text-ink-tertiary">
        {limitBytes !== null ? (
          <>
            {formatBytes(limitBytes)}
            {t.addonGib > 0 && (
              <div className="text-xs">
                {t.planLimitGib} + {t.addonGib} Add-On
              </div>
            )}
          </>
        ) : (
          "—"
        )}
      </td>
      <td className="px-3 py-2 min-w-[180px]">
        {pct !== null ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-surface-sunken rounded overflow-hidden">
              <div
                className={
                  "h-full " +
                  (pct >= 100
                    ? "bg-semantic-danger"
                    : pct >= 80
                      ? "bg-semantic-warning"
                      : "bg-accent")
                }
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
            <span
              className={
                "text-xs font-mono w-12 text-right " +
                (pct >= 100
                  ? "text-semantic-danger font-medium"
                  : pct >= 80
                    ? "text-semantic-warning"
                    : "text-ink-tertiary")
              }
            >
              {pct.toFixed(0)}%
            </span>
          </div>
        ) : (
          <span className="text-xs text-ink-tertiary">—</span>
        )}
      </td>
    </tr>
  );
}

function StatCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "warning" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "text-semantic-danger"
      : tone === "warning"
        ? "text-semantic-warning"
        : "text-ink-primary";
  return (
    <div className="rounded-md border border-line-subtle bg-surface-raised p-4">
      <div className="text-ui-xs uppercase tracking-[0.12em] text-ink-tertiary">
        {label}
      </div>
      <div className={`text-2xl font-semibold mt-2 ${toneClass}`}>{value}</div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[i]}`;
}
