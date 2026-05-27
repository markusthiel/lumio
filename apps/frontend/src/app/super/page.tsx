"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { SuperShell } from "@/components/super/SuperShell";

export default function SuperDashboardPage() {
  return (
    <SuperShell>
      <DashboardContent />
    </SuperShell>
  );
}

type StatsResponse = Awaited<ReturnType<typeof api.superStats>>;

function DashboardContent() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    api.superStats().then(setStats).catch(() => setStats(null));
  }, [refreshTick]);

  return (
    <div className="px-8 py-6 max-w-4xl">
      <h1 className="text-2xl font-semibold mb-1">Übersicht</h1>
      <p className="text-ui-sm text-ink-tertiary mb-6">
        Plattform-Status auf einen Blick.
      </p>

      {!stats ? (
        <div className="text-ui text-ink-tertiary">Lädt…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard
              label="Tenants aktiv"
              value={stats.tenants.active ?? 0}
              tone="success"
            />
            <StatCard
              label="Tenants suspendiert"
              value={stats.tenants.suspended ?? 0}
              tone={stats.tenants.suspended ? "warning" : "neutral"}
            />
            <StatCard
              label="Karenzphase (Löschung)"
              value={stats.tenants.pending_deletion ?? 0}
              tone={
                (stats.tenants.pending_deletion ?? 0) > 0 ? "warning" : "neutral"
              }
            />
            <StatCard
              label="Tenants archiviert"
              value={stats.tenants.archived ?? 0}
              tone="neutral"
            />
            <StatCard label="User insgesamt" value={stats.totalUsers} />
            <StatCard label="Galerien insgesamt" value={stats.totalGalleries} />
            <StatCard label="Files insgesamt" value={stats.totalFiles} />
          </div>

          {stats.pendingDeletions.length > 0 && (
            <PendingDeletionsList
              pending={stats.pendingDeletions}
              onChange={() => setRefreshTick((n) => n + 1)}
            />
          )}
        </>
      )}
    </div>
  );
}

function PendingDeletionsList({
  pending,
  onChange,
}: {
  pending: StatsResponse["pendingDeletions"];
  onChange: () => void;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold mb-1">Tenants in Karenzphase</h2>
      <p className="text-ui-sm text-ink-tertiary mb-4">
        Diese Studios sind zur endgültigen Löschung markiert. Sie können sich
        bis zum Stichtag selbst zurücknehmen oder du machst es manuell — z.B.
        wenn der Owner sich nicht mehr einloggen kann.
      </p>
      <div className="border border-line-subtle rounded-md bg-surface-raised divide-y divide-line-subtle">
        {pending.map((t) => (
          <PendingDeletionRow key={t.id} tenant={t} onChange={onChange} />
        ))}
      </div>
    </section>
  );
}

function PendingDeletionRow({
  tenant,
  onChange,
}: {
  tenant: StatsResponse["pendingDeletions"][number];
  onChange: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const daysRemaining =
    tenant.scheduledFor !== null
      ? Math.max(
          0,
          Math.ceil(
            (new Date(tenant.scheduledFor).getTime() - Date.now()) /
              (1000 * 60 * 60 * 24)
          )
        )
      : null;

  const dateStr = tenant.scheduledFor
    ? new Date(tenant.scheduledFor).toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : "—";

  async function onCancelClick() {
    if (!confirming) {
      setConfirming(true);
      setTimeout(
        () => setConfirming((curr) => (curr ? false : curr)),
        4000
      );
      return;
    }
    setConfirming(false);
    setWorking(true);
    setError(null);
    try {
      await api.superCancelSelfDeletion(tenant.id);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="min-w-0">
        <Link
          href={`/super/tenants/${tenant.id}`}
          className="text-sm font-medium hover:underline"
        >
          {tenant.name}
        </Link>
        {tenant.ownerEmail && (
          <div className="text-xs text-ink-tertiary truncate">
            Owner: {tenant.ownerName ?? tenant.ownerEmail} ({tenant.ownerEmail})
          </div>
        )}
        <div className="text-xs text-ink-tertiary mt-0.5">
          Löschung am {dateStr}
          {daysRemaining !== null && (
            <span
              className={
                daysRemaining <= 7
                  ? " text-semantic-warning font-medium"
                  : ""
              }
            >
              {" · "}
              {daysRemaining === 0
                ? "heute"
                : daysRemaining === 1
                  ? "morgen"
                  : `in ${daysRemaining} Tagen`}
            </span>
          )}
        </div>
        {error && (
          <div className="text-xs text-semantic-danger mt-1">{error}</div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onCancelClick}
          disabled={working}
          className={
            confirming
              ? "text-xs px-3 py-1.5 rounded border border-semantic-warning text-semantic-warning font-medium hover:bg-semantic-warning/10"
              : "text-xs px-3 py-1.5 rounded border border-line-subtle hover:bg-surface-sunken"
          }
        >
          {working
            ? "Wird zurückgenommen…"
            : confirming
              ? "Sicher? Nochmal klicken"
              : "Löschung zurücknehmen"}
        </button>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "success" | "warning";
}) {
  const toneClass =
    tone === "success"
      ? "text-semantic-success"
      : tone === "warning"
        ? "text-semantic-warning"
        : "text-ink-primary";
  return (
    <div className="rounded-md border border-line-subtle bg-surface-raised p-4">
      <div className="text-ui-xs uppercase tracking-[0.12em] text-ink-tertiary">
        {label}
      </div>
      <div className={`text-3xl font-semibold mt-2 ${toneClass}`}>
        {value.toLocaleString("de-DE")}
      </div>
    </div>
  );
}
