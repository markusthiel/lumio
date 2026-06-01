"use client";

/**
 * Lumio Studio — Analytics-Dashboard (advanced_analytics)
 *
 * Tenant-Level-Uebersicht ueber alle Galerien:
 *   - KPI-Cards: Visits, Likes, Comments, Finalized Selections, Print-Orders, Revenue
 *   - Trend-Charts: tägliche Visits + Likes (LineChart)
 *   - Storage-Trend: kumulative Files-Groesse (AreaChart)
 *   - Top 5 Galerien nach Visits + nach Likes
 *
 * Pro-Galerie-Funnel ist als eigene Page nicht hier — der wird in
 * /studio/[id]/stats angehaengt (separater Commit waere).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { PageHeader } from "@/components/studio/PageHeader";

export const dynamic = "force-dynamic";

type Overview = Awaited<ReturnType<typeof api.getAnalyticsOverview>>;

const RANGE_PRESETS = [
  { days: 7, label: "7 Tage" },
  { days: 30, label: "30 Tage" },
  { days: 90, label: "90 Tage" },
  { days: 365, label: "12 Monate" },
];

export default function AnalyticsPage() {
  const t = useT();
  const [data, setData] = useState<Overview | null>(null);
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const r = await api.getAnalyticsOverview(days);
        if (!cancelled) {
          setData(r);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t("common.error"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [days]);

  return (
    <>
      <PageHeader
        title={t("analytics.title")}
        actions={
          <div className="flex gap-1.5">
            {RANGE_PRESETS.map((p) => (
              <button
                key={p.days}
                type="button"
                onClick={() => setDays(p.days)}
                className={
                  days === p.days
                    ? "px-2.5 py-1 text-xs rounded bg-accent text-white"
                    : "px-2.5 py-1 text-xs rounded bg-surface-sunken text-ink-secondary hover:bg-surface-raised"
                }
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      />
      <div className="px-6 sm:px-8 lg:px-12 py-6 space-y-5 max-w-5xl">

      {error && (
        <div className="rounded-md border border-semantic-danger/30 bg-semantic-danger/8 px-3 py-2 text-sm text-semantic-danger">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="text-sm text-ink-tertiary">Lädt…</div>
      )}

      {data && (
        <>
          {/* KPI-Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard label={t("analytics.galleries")} value={data.totals.galleries} />
            <KpiCard label={t("analytics.files")} value={data.totals.files} />
            <KpiCard label={t("analytics.visits")} value={data.totals.visits} highlight />
            <KpiCard label={t("analytics.likes")} value={data.totals.likes} />
            <KpiCard label={t("analytics.comments")} value={data.totals.comments} />
            {data.totals.printOrders > 0 ? (
              <KpiCard
                label={t("analytics.printRevenue")}
                value={(data.totals.printRevenueCents / 100).toLocaleString(
                  "de-DE",
                  { style: "currency", currency: "EUR" }
                )}
                highlight
              />
            ) : (
              <KpiCard
                label={t("analytics.selectionsComplete")}
                value={data.totals.finalizedSelections}
              />
            )}
          </div>

          {/* Trends: Visits + Likes */}
          <Section title={t("analytics.chartVisitsLikes")}>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={mergeTrends(
                    data.trends.dailyVisits,
                    data.trends.dailyLikes
                  )}
                >
                  <CartesianGrid stroke="var(--brand-border)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="day"
                    tickFormatter={(v) => fmtDate(v)}
                    fontSize={12}
                  />
                  <YAxis fontSize={12} allowDecimals={false} />
                  <Tooltip
                    labelFormatter={(v) => fmtDate(v)}
                    contentStyle={{
                      background: "var(--brand-surface-raised)",
                      border: "1px solid var(--brand-border)",
                      borderRadius: 4,
                      fontSize: 13,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="visits"
                    name="Besuche"
                    stroke="var(--brand-accent)"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="likes"
                    name="Likes"
                    stroke="#22c55e"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Section>

          {/* Storage-Trend */}
          {data.trends.storage.length > 0 && (
            <Section title={t("analytics.chartStorage")}>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.trends.storage}>
                    <CartesianGrid
                      stroke="var(--brand-border)"
                      strokeDasharray="3 3"
                    />
                    <XAxis
                      dataKey="day"
                      tickFormatter={(v) => fmtDate(v)}
                      fontSize={12}
                    />
                    <YAxis
                      tickFormatter={(v: number) => fmtBytes(v)}
                      fontSize={12}
                    />
                    <Tooltip
                      labelFormatter={(v) => fmtDate(v as string)}
                      formatter={(v) => fmtBytes(Number(v))}
                      contentStyle={{
                        background: "var(--brand-surface-raised)",
                        border: "1px solid var(--brand-border)",
                        borderRadius: 4,
                        fontSize: 13,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="cumulative"
                      name="Gespeicherte Daten"
                      stroke="var(--brand-accent)"
                      fill="var(--brand-accent)"
                      fillOpacity={0.15}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Section>
          )}

          {/* Top-Listen */}
          <div className="grid md:grid-cols-2 gap-4">
            <Section title={t("analytics.topVisits")}>
              <TopList rows={data.top.byVisits} metricKey="visits" metricLabel="Besuche" />
            </Section>
            <Section title={t("analytics.topLikes")}>
              <TopList rows={data.top.byLikes} metricKey="likes" metricLabel="Likes" />
            </Section>
          </div>
        </>
      )}
      </div>
    </>
  );
}

function KpiCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number | string;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        highlight
          ? "rounded-md border border-accent/30 bg-accent/8 p-3"
          : "rounded-md border border-line-subtle bg-surface-raised p-3"
      }
    >
      <div className="text-xs text-ink-tertiary uppercase tracking-wide mb-1">
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums">
        {typeof value === "number" ? value.toLocaleString("de-DE") : value}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-line-subtle bg-surface-raised p-4">
      <h2 className="text-sm font-semibold mb-3">{title}</h2>
      {children}
    </section>
  );
}

function TopList({
  rows,
  metricKey,
  metricLabel,
}: {
  rows: Array<{ galleryId: string; title: string; slug: string } & Record<string, unknown>>;
  metricKey: string;
  metricLabel: string;
}) {
  if (rows.length === 0 || rows.every((r) => (r[metricKey] ?? 0) === 0)) {
    return (
      <p className="text-sm text-ink-tertiary py-4 text-center">
        Noch keine Daten für diesen Zeitraum.
      </p>
    );
  }
  return (
    <ol className="divide-y divide-line-subtle text-sm">
      {rows.map((r, i) => (
        <li
          key={r.galleryId}
          className="py-2 flex justify-between gap-3 items-center"
        >
          <div className="flex gap-3 min-w-0 flex-1">
            <span className="text-ink-tertiary tabular-nums w-5 shrink-0">
              {i + 1}.
            </span>
            <Link
              href={`/studio/${r.galleryId}/stats`}
              className="truncate hover:text-accent"
            >
              {r.title}
            </Link>
          </div>
          <span className="tabular-nums shrink-0">
            {(r[metricKey] as number).toLocaleString("de-DE")}{" "}
            <span className="text-ink-tertiary text-xs">{metricLabel}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function fmtDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes < 1024 * 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  return `${(bytes / (1024 * 1024 * 1024 * 1024)).toFixed(2)} TB`;
}

/** Merge zwei Zeit-Serien (visits + likes) auf gemeinsame day-Achse. */
function mergeTrends(
  visits: Array<{ day: string; count: number }>,
  likes: Array<{ day: string; count: number }>
): Array<{ day: string; visits: number; likes: number }> {
  const byDay = new Map<string, { visits: number; likes: number }>();
  for (const v of visits) {
    const key = new Date(v.day).toISOString().slice(0, 10);
    byDay.set(key, { visits: v.count, likes: 0 });
  }
  for (const l of likes) {
    const key = new Date(l.day).toISOString().slice(0, 10);
    const e = byDay.get(key) ?? { visits: 0, likes: 0 };
    e.likes = l.count;
    byDay.set(key, e);
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({ day, ...v }));
}
