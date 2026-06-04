"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { SuperShell } from "@/components/super/SuperShell";
import { useT } from "@/lib/i18n";

export default function SuperDashboardPage() {
  return (
    <SuperShell>
      <DashboardContent />
    </SuperShell>
  );
}

type StatsResponse = Awaited<ReturnType<typeof api.superStats>>;

function DashboardContent() {
  const t = useT();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    api.superStats().then(setStats).catch(() => setStats(null));
  }, [refreshTick]);

  return (
    <div className="px-4 sm:px-8 py-6 max-w-4xl">
      <h1 className="text-2xl font-semibold mb-1">{t("superDash.title")}</h1>
      <p className="text-ui-sm text-ink-tertiary mb-6">{t("superDash.subtitle")}</p>

      {!stats ? (
        <div className="text-ui text-ink-tertiary">{t("common.loading")}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard
              label={t("superDash.statActive")}
              value={stats.tenants.active ?? 0}
              tone="success"
            />
            <StatCard
              label={t("superDash.statSuspended")}
              value={stats.tenants.suspended ?? 0}
              tone={stats.tenants.suspended ? "warning" : "neutral"}
            />
            <StatCard
              label={t("superDash.statGrace")}
              value={stats.tenants.pending_deletion ?? 0}
              tone={
                (stats.tenants.pending_deletion ?? 0) > 0 ? "warning" : "neutral"
              }
            />
            <StatCard
              label={t("superDash.statArchived")}
              value={stats.tenants.archived ?? 0}
              tone="neutral"
            />
            <StatCard label={t("superDash.statUsers")} value={stats.totalUsers} />
            <StatCard label={t("superDash.statGalleries")} value={stats.totalGalleries} />
            <StatCard label={t("superDash.statFiles")} value={stats.totalFiles} />
            <StatCard
              label={t("superDash.statComped")}
              value={stats.compedTenants ?? 0}
            />
          </div>

          {stats.failedPayments.length > 0 && (
            <FailedPaymentsList payments={stats.failedPayments} />
          )}

          {stats.pendingDeletions.length > 0 && (
            <PendingDeletionsList
              pending={stats.pendingDeletions}
              onChange={() => setRefreshTick((n) => n + 1)}
            />
          )}

          <SignupsSparkline weekly={stats.signupsPerWeek} />

          <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <RecentSignupsList signups={stats.recentSignups} />
            <PlanDistribution plans={stats.planDistribution} />
          </div>
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
  const t = useT();
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold mb-1">{t("superDash.graceTitle")}</h2>
      <p className="text-ui-sm text-ink-tertiary mb-4">
        {t("superDash.graceDesc")}
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
  const t = useT();
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
      setError(err instanceof Error ? err.message : t("common.error"));
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
            {t("superDash.ownerLabel")} {tenant.ownerName ?? tenant.ownerEmail} ({tenant.ownerEmail})
          </div>
        )}
        <div className="text-xs text-ink-tertiary mt-0.5">
          {t("superDash.deletionOn", { date: dateStr })}
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
                ? t("superDash.today")
                : daysRemaining === 1
                  ? t("superDash.tomorrow")
                  : t("superDash.inDays", { n: daysRemaining })}
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
            ? t("superDash.undoing")
            : confirming
              ? t("superDash.confirmUndo")
              : t("superDash.undoDeletion")}
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

// ---------------------------------------------------------------------------
// Recent-Signups
// ---------------------------------------------------------------------------
function RecentSignupsList({
  signups,
}: {
  signups: StatsResponse["recentSignups"];
}) {
  const t = useT();
  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">{t("superDash.recentTitle")}</h2>
      {signups.length === 0 ? (
        <div className="text-sm text-ink-tertiary">{t("superDash.noSignups")}</div>
      ) : (
        <div className="border border-line-subtle rounded-md bg-surface-raised divide-y divide-line-subtle">
          {signups.map((s) => (
            <Link
              key={s.id}
              href={`/super/tenants/${s.id}`}
              className="block px-4 py-2.5 hover:bg-surface-sunken/40"
            >
              <div className="flex items-center justify-between gap-3 min-w-0">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{s.name}</div>
                  <div className="text-xs text-ink-tertiary truncate">
                    {s.planName ?? t("superDash.noPlan")}
                    {s.subscriptionStatus && (
                      <>
                        {" · "}
                        <span className="font-mono">{s.subscriptionStatus}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-xs text-ink-tertiary shrink-0">
                  {relativeTime(s.createdAt, t)}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Plan-Verteilung
// ---------------------------------------------------------------------------
// Horizontaler Bar-Chart pro Plan, gestapelt nach Subscription-Status
// (active vs trialing vs canceled etc.). So sieht man auf einen Blick
// wo die Basis ist und wo der Trial-Pool wartet.
function PlanDistribution({
  plans,
}: {
  plans: StatsResponse["planDistribution"];
}) {
  const t = useT();
  if (plans.length === 0) {
    return (
      <section>
        <h2 className="text-lg font-semibold mb-3">{t("superDash.planDistTitle")}</h2>
        <div className="text-sm text-ink-tertiary">{t("superDash.noSubs")}</div>
      </section>
    );
  }

  const maxTotal = Math.max(...plans.map((p) => p.total));

  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">{t("superDash.planDistTitle")}</h2>
      <div className="border border-line-subtle rounded-md bg-surface-raised p-4 space-y-3">
        {plans.map((p) => (
          <div key={p.planId}>
            <div className="flex items-baseline justify-between mb-1 text-sm">
              <span className="font-medium">{p.planName}</span>
              <span className="text-ink-tertiary">
                {p.total} {t(p.total === 1 ? "superDash.tenant" : "superDash.tenants")}
                {p.comped > 0 && (
                  <span className="ml-1 text-semantic-success">
                    ({t("superDash.ofWhichFree", { n: p.comped })})
                  </span>
                )}
              </span>
            </div>
            <StatusStackBar
              byStatus={p.byStatus}
              max={maxTotal}
              total={p.total}
            />
          </div>
        ))}
        <div className="pt-2 border-t border-line-subtle flex flex-wrap gap-3 text-xs text-ink-tertiary">
          <StatusLegendDot color="bg-semantic-success" label="active" />
          <StatusLegendDot color="bg-accent" label="trialing" />
          <StatusLegendDot color="bg-semantic-warning" label="past_due" />
          <StatusLegendDot color="bg-semantic-danger" label="unpaid" />
          <StatusLegendDot color="bg-ink-tertiary" label="canceled" />
        </div>
      </div>
    </section>
  );
}

function StatusStackBar({
  byStatus,
  max,
  total,
}: {
  byStatus: Record<string, number>;
  max: number;
  total: number;
}) {
  // Anteil der Bar gegenueber dem groessten Plan. So bleiben Plans mit
  // wenigen Tenants schmaler — gibt Wuerde Verhaeltnis.
  const widthPct = max > 0 ? (total / max) * 100 : 0;
  const order: Array<{ key: string; color: string }> = [
    { key: "active", color: "bg-semantic-success" },
    { key: "trialing", color: "bg-accent" },
    { key: "past_due", color: "bg-semantic-warning" },
    { key: "unpaid", color: "bg-semantic-danger" },
    { key: "canceled", color: "bg-ink-tertiary" },
  ];
  return (
    <div className="h-2 bg-surface-sunken rounded overflow-hidden" style={{ width: `${widthPct}%` }}>
      <div className="flex h-full">
        {order.map(({ key, color }) => {
          const n = byStatus[key] ?? 0;
          if (n === 0) return null;
          const pct = (n / total) * 100;
          return (
            <div
              key={key}
              className={color}
              style={{ width: `${pct}%` }}
              title={`${key}: ${n}`}
            />
          );
        })}
      </div>
    </div>
  );
}

function StatusLegendDot({
  color,
  label,
}: {
  color: string;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block w-2 h-2 rounded-sm ${color}`} />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Signup-Trend (12 Wochen)
// ---------------------------------------------------------------------------
// SVG-Inline-Sparkline ohne Lib. Bei 12 Datenpunkten ist eine Recharts-
// Dependency Overkill.
function SignupsSparkline({
  weekly,
}: {
  weekly: StatsResponse["signupsPerWeek"];
}) {
  const t = useT();
  if (weekly.length === 0) return null;
  const max = Math.max(...weekly.map((w) => w.count), 1);
  const total = weekly.reduce((sum, w) => sum + w.count, 0);

  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-lg font-semibold">{t("superDash.signupsTitle")}</h2>
        <span className="text-sm text-ink-tertiary">
          {total} {t(total === 1 ? "superDash.tenant" : "superDash.tenants")} {t("superDash.totalSuffix")}
        </span>
      </div>
      <div className="border border-line-subtle rounded-md bg-surface-raised p-4">
        <div className="flex items-end gap-1 h-24">
          {weekly.map((w) => {
            // Nicht-Null-Wochen bekommen mind. 6% Höhe (sichtbar), Null-Wochen
            // eine dünne Grundlinie — so liest sich das immer als Diagramm.
            const pct = w.count === 0 ? 0 : Math.max(6, (w.count / max) * 100);
            return (
              <div
                key={w.weekStart}
                className="flex-1 h-full flex items-end"
                title={`${t("superDash.weekOf")} ${w.weekStart}: ${w.count} ${t(w.count === 1 ? "superDash.signup" : "superDash.signups")}`}
              >
                <div
                  className={
                    "w-full rounded-sm " +
                    (w.count === 0 ? "bg-accent/15 h-px" : "bg-accent")
                  }
                  style={w.count === 0 ? undefined : { height: `${pct}%` }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function relativeTime(
  iso: string,
  t: (key: string, vars?: Record<string, string | number>) => string
): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return t("superDash.justNow");
  if (m < 60) return t("superDash.minAgo", { m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("superDash.hAgo", { h });
  const d = Math.floor(h / 24);
  if (d < 30) return t(d === 1 ? "superDash.dayAgo" : "superDash.daysAgo", { d });
  return new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Failed-Payments
// ---------------------------------------------------------------------------
// Prominenter Block: Tenants mit problematischem Subscription-Status.
// Reihenfolge nach Aelteste-Probleme zuerst (kommt aus Backend so).
function FailedPaymentsList({
  payments,
}: {
  payments: StatsResponse["failedPayments"];
}) {
  const t = useT();
  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold mb-1 text-semantic-danger">
        {t("superDash.paymentIssues")} · {payments.length}
      </h2>
      <p className="text-ui-sm text-ink-tertiary mb-3">
        {t("superDash.paymentIssuesDesc")}
      </p>
      <div className="border border-semantic-danger/30 rounded-md bg-semantic-danger/5 divide-y divide-line-subtle">
        {payments.map((p) => (
          <FailedPaymentRow key={p.tenantId} payment={p} />
        ))}
      </div>
    </section>
  );
}

function FailedPaymentRow({
  payment,
}: {
  payment: StatsResponse["failedPayments"][number];
}) {
  const t = useT();
  const sinceDays = Math.floor(
    (Date.now() - new Date(payment.problemSince).getTime()) /
      (1000 * 60 * 60 * 24)
  );

  return (
    <div className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={`/super/tenants/${payment.tenantId}`}
            className="text-sm font-medium hover:underline"
          >
            {payment.tenantName}
          </Link>
          <span className="text-xs px-1.5 py-0.5 rounded bg-semantic-danger/15 text-semantic-danger font-mono">
            {payment.status}
          </span>
          {payment.readOnlySince && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-semantic-warning/15 text-semantic-warning">{t("superDash.readOnly")}</span>
          )}
        </div>
        <div className="text-xs text-ink-tertiary mt-0.5 truncate">
          {payment.planName}
          {payment.ownerEmail && (
            <>
              {" · "}
              {payment.ownerEmail}
            </>
          )}
          {" · "}
          {sinceDays === 0
            ? t("superDash.escalatedToday")
            : sinceDays === 1
              ? t("superDash.sinceYesterday")
              : t("superDash.sinceDaysN", { n: sinceDays })}
        </div>
      </div>
      {payment.stripeCustomerId && (
        <a
          href={`https://dashboard.stripe.com/customers/${payment.stripeCustomerId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs px-3 py-1.5 rounded border border-line-subtle hover:bg-surface-sunken whitespace-nowrap"
          onClick={(e) => e.stopPropagation()}
        >{t("superDash.openInStripe")}</a>
      )}
    </div>
  );
}
