"use client";

/**
 * Super-Admin — Print-Provider-Verwaltung
 *
 * Liste aller von Lumio unterstuetzten Print-Anbieter mit ihrem
 * Implementations-Stand (Stage) und globalem Aktivierungs-Schalter.
 *
 * Nur 'production' und 'beta'-Provider sollten aktiviert werden —
 * 'planned' sind reine Stubs ohne API-Implementation; das Toggle
 * waere nutzlos. Wir lassen den Toggle aber technisch zu fuer
 * Test-Szenarien (und kennzeichnen 'planned' im UI deutlich).
 *
 * Self-Print steht ganz oben und ist nicht umschaltbar.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { SuperShell } from "@/components/super/SuperShell";

type Response = Awaited<ReturnType<typeof api.superListPrintProviders>>;
type Provider = Response["providers"][number];

export default function SuperPrintProvidersPage() {
  return (
    <SuperShell>
      <Content />
    </SuperShell>
  );
}

function Content() {
  const [data, setData] = useState<Response | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const r = await api.superListPrintProviders();
      setData(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggle(p: Provider) {
    setBusyKey(p.key);
    setError(null);
    try {
      await api.superTogglePrintProvider(p.key, !p.enabled);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="px-4 sm:px-8 py-6 max-w-5xl">
      <h1 className="text-2xl font-semibold mb-1">Print-Provider</h1>
      <p className="text-ui-sm text-ink-tertiary mb-6">
        Globale Aktivierung der Print-Lab-Anbindungen. Hier aktivierte
        Provider sind in den Studio-Settings auswählbar. Self-Print ist
        immer verfügbar — Tenants ohne API-Lab können trotzdem den
        Print-Shop nutzen.
      </p>

      {error && (
        <div className="rounded-md border border-semantic-danger/30 bg-semantic-danger/8 px-3 py-2 mb-4 text-sm text-semantic-danger">
          {error}
        </div>
      )}

      {!data ? (
        <div className="text-sm text-ink-tertiary">Lädt…</div>
      ) : (
        <div className="space-y-2">
          {data.providers.map((p) => (
            <ProviderRow
              key={p.key}
              p={p}
              busy={busyKey === p.key}
              onToggle={() => toggle(p)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProviderRow({
  p,
  busy,
  onToggle,
}: {
  p: Provider;
  busy: boolean;
  onToggle: () => void;
}) {
  const isSelfPrint = p.stage === "self_print";
  const stageBadge = (() => {
    switch (p.stage) {
      case "production":
        return { label: "production", classes: "bg-semantic-success/15 text-semantic-success" };
      case "beta":
        return { label: "beta", classes: "bg-accent/15 text-accent" };
      case "planned":
        return { label: "planned", classes: "bg-semantic-warning/15 text-semantic-warning" };
      case "self_print":
        return { label: "self-print", classes: "bg-ink-tertiary/15 text-ink-secondary" };
    }
  })();

  return (
    <div className="rounded-md border border-line-subtle bg-surface-raised p-4">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <strong className="text-sm">{p.label}</strong>
            <span
              className={`text-xs px-1.5 py-0.5 rounded font-mono ${stageBadge.classes}`}
            >
              {stageBadge.label}
            </span>
            <span className="text-xs text-ink-tertiary font-mono">
              {p.key}
            </span>
            <span className="text-xs text-ink-tertiary">· {p.market}</span>
          </div>
          <div className="text-xs text-ink-secondary mb-1">{p.tagline}</div>
          <div className="text-xs text-ink-tertiary">
            Kategorien:{" "}
            {p.categories.length > 0
              ? p.categories.join(", ")
              : "—"}
            {p.websiteUrl && (
              <>
                {" · "}
                <a
                  href={p.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  Website
                </a>
              </>
            )}
            {p.apiKeyHelpUrl && (
              <>
                {" · "}
                <a
                  href={p.apiKeyHelpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  API-Setup
                </a>
              </>
            )}
          </div>
        </div>

        {isSelfPrint ? (
          <span className="text-xs text-ink-tertiary px-3 py-1.5">
            immer aktiv
          </span>
        ) : (
          <button
            type="button"
            onClick={onToggle}
            disabled={busy}
            className={
              p.enabled
                ? "shrink-0 inline-flex items-center h-6 w-11 rounded-full bg-semantic-success transition-colors disabled:opacity-50"
                : "shrink-0 inline-flex items-center h-6 w-11 rounded-full bg-surface-sunken transition-colors disabled:opacity-50"
            }
            aria-label={p.enabled ? "Deaktivieren" : "Aktivieren"}
          >
            <span
              className={
                p.enabled
                  ? "inline-block h-5 w-5 rounded-full bg-white shadow translate-x-5 transition-transform"
                  : "inline-block h-5 w-5 rounded-full bg-white shadow translate-x-0.5 transition-transform"
              }
            />
          </button>
        )}
      </div>

      {p.stage === "planned" && p.enabled && (
        <div className="mt-2 text-xs rounded border border-semantic-warning/30 bg-semantic-warning/8 px-2 py-1.5 text-semantic-warning">
          Achtung: Provider ist als &apos;planned&apos; markiert — die API-
          Anbindung ist noch nicht implementiert. Tenants koennen den
          Provider auswaehlen, Bestellungen werden aber bei Submit fehlschlagen.
        </div>
      )}
    </div>
  );
}
