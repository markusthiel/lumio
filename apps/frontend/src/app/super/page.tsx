"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { SuperShell } from "@/components/super/SuperShell";

export default function SuperDashboardPage() {
  return (
    <SuperShell>
      <DashboardContent />
    </SuperShell>
  );
}

function DashboardContent() {
  const [stats, setStats] = useState<{
    tenants: Record<string, number>;
    totalUsers: number;
    totalGalleries: number;
    totalFiles: number;
  } | null>(null);

  useEffect(() => {
    api.superStats().then(setStats).catch(() => setStats(null));
  }, []);

  return (
    <div className="px-8 py-6 max-w-4xl">
      <h1 className="text-2xl font-semibold mb-1">Übersicht</h1>
      <p className="text-ui-sm text-ink-tertiary mb-6">
        Plattform-Status auf einen Blick.
      </p>

      {!stats ? (
        <div className="text-ui text-ink-tertiary">Lädt…</div>
      ) : (
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
            label="Tenants archiviert"
            value={stats.tenants.archived ?? 0}
            tone="neutral"
          />
          <StatCard label="User insgesamt" value={stats.totalUsers} />
          <StatCard label="Galerien insgesamt" value={stats.totalGalleries} />
          <StatCard label="Files insgesamt" value={stats.totalFiles} />
        </div>
      )}
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
