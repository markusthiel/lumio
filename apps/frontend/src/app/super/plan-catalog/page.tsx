"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api,
  type PlanCatalogEntry,
  type PlanCatalogDbOnly,
} from "@/lib/api";
import { SuperShell } from "@/components/super/SuperShell";

export default function SuperPlanCatalogPage() {
  return (
    <SuperShell>
      <PlanCatalogView />
    </SuperShell>
  );
}

function eur(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `${(cents / 100).toLocaleString("de-DE")} €`;
}

function gib(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v.toLocaleString("de-DE")} GB`;
}

function yesNo(v: boolean): string {
  return v ? "Ja" : "Nein";
}

function PlanCatalogView() {
  const [plans, setPlans] = useState<PlanCatalogEntry[]>([]);
  const [dbOnly, setDbOnly] = useState<PlanCatalogDbOnly[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.superGetPlanCatalog();
      setPlans(r.plans);
      setDbOnly(r.dbOnly);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const driftCount = plans.filter((p) => p.drift.length > 0).length;
  const missingCount = plans.filter((p) => p.missingInDb).length;

  return (
    <div className="px-4 sm:px-8 py-6 max-w-5xl">
      <h1 className="text-2xl font-semibold mb-2">Plan-Katalog</h1>
      <p className="text-ui-sm text-ink-tertiary mb-6 max-w-2xl">
        Vergleicht die zentrale Plan-Definition im Code (Quelle der Wahrheit für
        Limits &amp; Preise) mit der DB-Tabelle <code>billing_plans</code>, die
        beim Boot daraus gespiegelt wird und die Stripe-Preis-IDs hält. Weicht
        etwas ab, lief die Spiegelung nicht durch — das hier hätte den
        Storage-Bug (1000 statt 3000 GB) sofort gezeigt.
      </p>

      {loading ? (
        <div className="text-ui text-ink-tertiary">Lädt…</div>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap gap-2 text-ui-sm">
            <Badge
              tone={driftCount > 0 ? "warning" : "success"}
              label={
                driftCount > 0
                  ? `${driftCount} Plan(e) mit Drift`
                  : "Keine Drift — Code und DB sind synchron"
              }
            />
            {missingCount > 0 && (
              <Badge
                tone="warning"
                label={`${missingCount} Plan(e) fehlen in der DB`}
              />
            )}
          </div>

          <div className="space-y-4">
            {plans.map((p) => (
              <PlanCard key={p.slug} plan={p} />
            ))}
          </div>

          {dbOnly.length > 0 && (
            <div className="mt-8">
              <h2 className="text-ui font-semibold mb-2">
                Nur in der DB (kein Code-Pendant)
              </h2>
              <p className="text-ui-sm text-ink-tertiary mb-3 max-w-2xl">
                Diese Pläne existieren in <code>billing_plans</code>, aber nicht
                im Code — z. B. Alt-/Custom-Pläne. Limits werden für sie nicht
                aus dem Code erzwungen.
              </p>
              <div className="border border-line-subtle rounded-md bg-surface-raised overflow-hidden">
                <table className="w-full text-ui-sm">
                  <tbody>
                    {dbOnly.map((d) => (
                      <tr
                        key={d.slug}
                        className="border-b border-line-subtle last:border-0"
                      >
                        <td className="px-3 py-2 font-mono text-ui-xs">
                          {d.slug}
                        </td>
                        <td className="px-3 py-2">{d.name}</td>
                        <td className="px-3 py-2 text-right">
                          {d.isActive ? (
                            <span className="text-semantic-success">aktiv</span>
                          ) : (
                            <span className="text-ink-tertiary">inaktiv</span>
                          )}
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

function PlanCard({ plan }: { plan: PlanCatalogEntry }) {
  const driftFields = new Set(plan.drift.map((d) => d.field));
  const hasDrift = plan.drift.length > 0;

  const rows: Array<{
    field: string;
    label: string;
    code: string;
    db: string;
  }> = [
    {
      field: "name",
      label: "Name",
      code: plan.code.name,
      db: plan.db?.name ?? "—",
    },
    {
      field: "storageGib",
      label: "Speicher",
      code: gib(plan.code.storageGib),
      db: gib(plan.db?.storageGib),
    },
    {
      field: "priceMonthlyCents",
      label: "Preis / Monat",
      code: eur(plan.code.priceMonthlyCents),
      db: eur(plan.db?.priceMonthlyCents),
    },
    {
      field: "priceYearlyCents",
      label: "Preis / Jahr",
      code: eur(plan.code.priceYearlyCents),
      db: eur(plan.db?.priceYearlyCents),
    },
    {
      field: "watermark",
      label: "Watermark",
      code: yesNo(plan.code.watermark),
      db: plan.db ? yesNo(plan.db.watermark) : "—",
    },
  ];

  return (
    <div
      className={
        "border rounded-md bg-surface-raised overflow-hidden " +
        (hasDrift || plan.missingInDb
          ? "border-semantic-warning/50"
          : "border-line-subtle")
      }
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line-subtle flex-wrap">
        <div className="flex items-center gap-2">
          <span className="font-mono text-ui-xs px-2 py-0.5 rounded bg-surface-sunken">
            {plan.slug}
          </span>
          <span className="font-semibold">{plan.code.name}</span>
        </div>
        <div className="flex items-center gap-2">
          {plan.missingInDb ? (
            <Badge tone="warning" label="fehlt in DB" />
          ) : (
            <>
              {hasDrift ? (
                <Badge tone="warning" label={`${plan.drift.length}× Drift`} />
              ) : (
                <Badge tone="success" label="synchron" />
              )}
              {plan.db && !plan.db.isActive && (
                <Badge tone="muted" label="inaktiv" />
              )}
            </>
          )}
        </div>
      </div>

      <table className="w-full text-ui-sm">
        <thead className="text-ink-tertiary text-ui-xs uppercase tracking-wide">
          <tr className="border-b border-line-subtle">
            <th className="text-left font-medium px-4 py-1.5">Feld</th>
            <th className="text-left font-medium px-4 py-1.5">Code</th>
            <th className="text-left font-medium px-4 py-1.5">DB</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const drift = driftFields.has(r.field);
            return (
              <tr
                key={r.field}
                className="border-b border-line-subtle last:border-0"
              >
                <td className="px-4 py-1.5 text-ink-secondary">{r.label}</td>
                <td className="px-4 py-1.5 tabular-nums">{r.code}</td>
                <td
                  className={
                    "px-4 py-1.5 tabular-nums " +
                    (drift ? "text-semantic-warning font-medium" : "")
                  }
                >
                  {plan.missingInDb ? "—" : r.db}
                  {drift && <span className="ml-1 text-ui-xs">≠</span>}
                </td>
              </tr>
            );
          })}
          {plan.db && (
            <tr className="last:border-0">
              <td className="px-4 py-1.5 text-ink-secondary">Stripe-Preise</td>
              <td className="px-4 py-1.5 text-ink-tertiary text-ui-xs">—</td>
              <td className="px-4 py-1.5 text-ui-xs">
                <span
                  className={
                    plan.db.hasStripeMonthly
                      ? "text-semantic-success"
                      : "text-ink-tertiary"
                  }
                >
                  Monat {plan.db.hasStripeMonthly ? "✓" : "fehlt"}
                </span>
                {"  ·  "}
                <span
                  className={
                    plan.db.hasStripeYearly
                      ? "text-semantic-success"
                      : "text-ink-tertiary"
                  }
                >
                  Jahr {plan.db.hasStripeYearly ? "✓" : "fehlt"}
                </span>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Badge({
  label,
  tone,
}: {
  label: string;
  tone: "success" | "warning" | "muted";
}) {
  const cls =
    tone === "success"
      ? "bg-semantic-success/10 text-semantic-success"
      : tone === "warning"
      ? "bg-semantic-warning/10 text-semantic-warning"
      : "bg-surface-sunken text-ink-tertiary";
  return (
    <span className={"px-2 py-0.5 rounded text-ui-xs font-medium " + cls}>
      {label}
    </span>
  );
}
