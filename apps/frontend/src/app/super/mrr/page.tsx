"use client";

/**
 * Super-Admin MRR-Page
 *
 * Monthly Recurring Revenue — die wichtigste SaaS-Kennzahl.
 *
 * Anzeige:
 *  - Aktuelle MRR als Hero-Zahl (live aus DB)
 *  - Trialing-MRR daneben (Forecast wenn alle aus Trial konvertieren)
 *  - Active vs Trialing Subscription-Count
 *  - Trend (letzte 90 Tage Snapshots als SVG-Linechart)
 *  - Aufschluesselung pro Plan
 *
 * MRR-Logik dokumentiert in services/mrr.ts. Currency: EUR.
 *
 * Snapshots werden nightly via Sweeper geschrieben (idempotent durch
 * UNIQUE date-Index). Vor dem ersten Snapshot ist history leer — die
 * Sparkline bleibt entsprechend leer; die Hero-Zahl ist trotzdem da.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { SuperShell } from "@/components/super/SuperShell";

type MrrResponse = Awaited<ReturnType<typeof api.superMrr>>;

export default function SuperMrrPage() {
  return (
    <SuperShell>
      <MrrContent />
    </SuperShell>
  );
}

function MrrContent() {
  const [data, setData] = useState<MrrResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .superMrr()
      .then(setData)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Fehler beim Laden")
      );
  }, []);

  return (
    <div className="px-4 sm:px-8 py-6 max-w-5xl">
      <h1 className="text-2xl font-semibold mb-1">MRR · Monthly Recurring Revenue</h1>
      <p className="text-ui-sm text-ink-tertiary mb-6">
        Aktuelle Live-Berechnung plus Tages-Snapshots (90 Tage). Yearly-Subs
        werden durch 12 normalisiert. Trialing-MRR ist Forecast.
      </p>

      {error && (
        <div className="rounded-md border border-semantic-danger/30 bg-semantic-danger/8 px-3 py-2 mb-4 text-sm text-semantic-danger">
          {error}
        </div>
      )}

      {!data ? (
        <div className="text-sm text-ink-tertiary">Lädt…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
            <HeroCard
              label="MRR aktuell"
              value={formatEur(data.current.mrrCents)}
              big
            />
            <HeroCard
              label="Trialing-MRR (Forecast)"
              value={formatEur(data.current.trialingMrrCents)}
              subtle
            />
            <HeroCard
              label="Aktive paid Subs"
              value={data.current.activeSubs.toLocaleString("de-DE")}
            />
            <HeroCard
              label="Trial-Subs"
              value={data.current.trialingSubs.toLocaleString("de-DE")}
              subtle
            />
          </div>

          {data.history.length >= 2 && (
            <MrrTrend history={data.history} />
          )}

          <PerPlanTable perPlan={data.current.perPlan} />

          {data.history.length < 2 && (
            <div className="mt-6 rounded-md border border-line-subtle bg-surface-raised p-4 text-ui-sm text-ink-tertiary">
              Trend-Sparkline kommt sobald genug Tagessnapshots vorliegen
              (täglich via Sweeper, idempotent).
            </div>
          )}
        </>
      )}
    </div>
  );
}

function HeroCard({
  label,
  value,
  big = false,
  subtle = false,
}: {
  label: string;
  value: string;
  big?: boolean;
  subtle?: boolean;
}) {
  return (
    <div className="rounded-md border border-line-subtle bg-surface-raised p-4">
      <div className="text-ui-xs uppercase tracking-[0.12em] text-ink-tertiary">
        {label}
      </div>
      <div
        className={
          big
            ? "text-4xl font-semibold mt-2 text-accent"
            : subtle
              ? "text-2xl font-semibold mt-2 text-ink-secondary"
              : "text-2xl font-semibold mt-2 text-ink-primary"
        }
      >
        {value}
      </div>
    </div>
  );
}

function MrrTrend({
  history,
}: {
  history: MrrResponse["history"];
}) {
  const W = 800;
  const H = 200;
  const PAD = 8;

  // Skalierung: y-Achse 0 bis max(mrr+trialingMrr), x-Achse linear über
  // die Anzahl der Snapshot-Tage. Wir koennten die Lueckentage zwischen
  // Snapshots interpolieren, aber die Realitaet ist: Sweeper-Run = 1
  // Snapshot pro Tag. Wenn ein Tag fehlt (z.B. Outage), ist das ehrlich.
  const max = Math.max(
    1,
    ...history.map((h) => h.mrrCents + h.trialingMrrCents)
  );
  const n = history.length;
  const scaleX = (i: number) => PAD + (i / (n - 1)) * (W - 2 * PAD);
  const scaleY = (v: number) => H - PAD - (v / max) * (H - 2 * PAD);

  const pathMrr = history
    .map(
      (h, i) =>
        `${i === 0 ? "M" : "L"} ${scaleX(i).toFixed(1)} ${scaleY(h.mrrCents).toFixed(1)}`
    )
    .join(" ");

  // Total = mrr + trialing. Gestapelt darstellen via separate Linie auf
  // (mrr + trialing); die Differenz visualisiert den Forecast-Potenzial.
  const pathTotal = history
    .map(
      (h, i) =>
        `${i === 0 ? "M" : "L"} ${scaleX(i).toFixed(1)} ${scaleY(h.mrrCents + h.trialingMrrCents).toFixed(1)}`
    )
    .join(" ");

  return (
    <section className="mt-2 mb-6">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-lg font-semibold">Trend · {history.length} Tage</h2>
        <div className="flex gap-3 text-xs text-ink-tertiary">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-3 h-0.5 bg-accent" />
            MRR
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-3 h-0.5 border-t border-dashed border-ink-tertiary" />
            inkl. Trialing-Forecast
          </span>
        </div>
      </div>
      <div className="border border-line-subtle rounded-md bg-surface-raised p-4">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ height: 200 }}
          preserveAspectRatio="none"
        >
          {/* Y-Achsen-Gridlines bei 25/50/75/100% */}
          {[0.25, 0.5, 0.75, 1].map((p) => (
            <line
              key={p}
              x1={PAD}
              x2={W - PAD}
              y1={scaleY(max * p)}
              y2={scaleY(max * p)}
              className="stroke-line-subtle"
              strokeDasharray="2 3"
            />
          ))}
          {/* Gestrichelte Linie = MRR + Trialing-Forecast */}
          <path
            d={pathTotal}
            fill="none"
            className="stroke-ink-tertiary"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
          {/* Solide Linie = harte MRR */}
          <path
            d={pathMrr}
            fill="none"
            className="stroke-accent"
            strokeWidth={2}
          />
        </svg>
        <div className="mt-2 flex items-center justify-between text-xs text-ink-tertiary">
          <span>{history[0].date}</span>
          <span>max: {formatEur(max)}</span>
          <span>{history[history.length - 1].date}</span>
        </div>
      </div>
    </section>
  );
}

function PerPlanTable({
  perPlan,
}: {
  perPlan: MrrResponse["current"]["perPlan"];
}) {
  const entries = Object.entries(perPlan).sort(
    ([, a], [, b]) => b.mrrCents - a.mrrCents
  );
  if (entries.length === 0) return null;
  const total = entries.reduce((sum, [, p]) => sum + p.mrrCents, 0);

  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">MRR pro Plan</h2>
      <div className="border border-line-subtle rounded-md bg-surface-raised overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[480px]">
          <thead>
            <tr className="border-b border-line-subtle text-xs uppercase tracking-wider text-ink-tertiary text-left">
              <th className="px-3 py-2 font-medium">Plan</th>
              <th className="px-3 py-2 font-medium text-right">Subs</th>
              <th className="px-3 py-2 font-medium text-right">MRR</th>
              <th className="px-3 py-2 font-medium text-right">Anteil</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([slug, p]) => {
              const share = total > 0 ? (p.mrrCents / total) * 100 : 0;
              return (
                <tr key={slug} className="border-b border-line-subtle">
                  <td className="px-3 py-2">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-ink-tertiary font-mono">
                      {slug}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">{p.count}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {formatEur(p.mrrCents)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-20 h-1.5 bg-surface-sunken rounded overflow-hidden">
                        <div
                          className="h-full bg-accent"
                          style={{ width: `${share}%` }}
                        />
                      </div>
                      <span className="text-xs text-ink-tertiary w-10 text-right">
                        {share.toFixed(0)}%
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-line-strong bg-surface-sunken/40">
              <td className="px-3 py-2 font-medium">Gesamt</td>
              <td className="px-3 py-2 text-right font-medium">
                {entries.reduce((sum, [, p]) => sum + p.count, 0)}
              </td>
              <td className="px-3 py-2 text-right font-mono font-medium">
                {formatEur(total)}
              </td>
              <td className="px-3 py-2 text-right text-xs text-ink-tertiary">
                100%
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      </div>
    </section>
  );
}

function formatEur(cents: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
