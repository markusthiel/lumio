"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, type SuperTenantSummary } from "@/lib/api";
import { SuperShell } from "@/components/super/SuperShell";
import { CreateTenantDialog } from "@/components/super/CreateTenantDialog";

export default function SuperTenantsPage() {
  return (
    <SuperShell>
      <TenantsList />
    </SuperShell>
  );
}

function TenantsList() {
  const [tenants, setTenants] = useState<SuperTenantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.superListTenants();
      setTenants(r.tenants);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="px-4 sm:px-8 py-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Tenants</h1>
          <p className="text-ui-sm text-ink-tertiary mt-0.5">
            Alle Foto-Studios auf dieser Plattform.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="h-9 px-4 rounded bg-accent text-accent-contrast font-medium text-ui-sm hover:bg-accent-hover transition-colors duration-motion"
        >
          + Neuer Tenant
        </button>
      </div>

      {loading ? (
        <div className="text-ui text-ink-tertiary">Lädt…</div>
      ) : tenants.length === 0 ? (
        <div className="rounded-md border border-dashed border-line-subtle bg-surface-sunken p-12 text-center">
          <p className="text-ui text-ink-tertiary">
            Noch keine Tenants — leg den ersten an.
          </p>
        </div>
      ) : (
        <ul className="rounded-md border border-line-subtle bg-surface-raised divide-y divide-line-subtle overflow-hidden">
          {tenants.map((t) => (
            <li key={t.id}>
              <Link
                href={`/super/tenants/${t.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-surface-overlay transition-colors duration-motion"
              >
                <StatusDot status={t.status} />
                <div className="flex-1 min-w-0">
                  <div className="text-ui text-ink-primary truncate">
                    {t.name}
                    {t.displayName && t.displayName !== t.name && (
                      <span className="text-ui-xs text-ink-tertiary ml-2 font-normal">
                        → öffentlich „{t.displayName}"
                      </span>
                    )}
                  </div>
                  <div className="text-ui-xs text-ink-tertiary truncate font-mono">
                    {t.slug}
                    {t.customDomain && ` · ${t.customDomain}`}
                  </div>
                </div>
                <div className="text-ui-xs text-ink-tertiary text-right tabular-nums flex-shrink-0">
                  {t.userCount} User · {t.galleryCount} Galerien
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <CreateTenantDialog
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

function StatusDot({ status }: { status: SuperTenantSummary["status"] }) {
  const color =
    status === "active"
      ? "bg-semantic-success"
      : status === "suspended"
      ? "bg-semantic-warning"
      : "bg-ink-tertiary";
  const title =
    status === "active"
      ? "Aktiv"
      : status === "suspended"
      ? "Suspendiert"
      : "Archiviert";
  return (
    <span
      className={`block w-2 h-2 rounded-full flex-shrink-0 ${color}`}
      title={title}
      aria-label={title}
    />
  );
}
