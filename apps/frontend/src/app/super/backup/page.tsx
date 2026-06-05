"use client";

/**
 * Super-Admin — Backup-Portal
 *
 * Zwei Bereiche:
 *  1. Monitoring: Status der System-Backups (DB + Medien) — dieselbe
 *     Datenquelle wie die System-Seite (/super/system → backup[]).
 *  2. Notfall-Export pro Tenant: löst einen Super-Admin-Export aller
 *     Galerien eines Tenants aus (Originale + metadata.json, ein ZIP pro
 *     Galerie) und stellt die Download-Links bereit. Use-Case: ein Kunde
 *     hat versehentlich alles gelöscht und braucht seine Quelldateien.
 *
 * Per-Tenant-Rückspielen (Restore) ist bewusst NICHT hier — das ist ein
 * separates, risikoreiches Thema (Phase 3).
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { SuperShell } from "@/components/super/SuperShell";

type SystemResponse = Awaited<ReturnType<typeof api.superSystemStatus>>;
type BackupStatus = SystemResponse["backup"][number];
type TenantList = Awaited<ReturnType<typeof api.superListTenants>>["tenants"];
type ExportList = Awaited<ReturnType<typeof api.superListTenantExports>>["exports"];
type ExportDetail = Awaited<
  ReturnType<typeof api.superTenantExportDetail>
>["export"];

export default function SuperBackupPage() {
  return (
    <SuperShell>
      <BackupContent />
    </SuperShell>
  );
}

function BackupContent() {
  const [system, setSystem] = useState<SystemResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await api.superSystemStatus();
        if (!cancelled) setSystem(r);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Fehler");
      }
    }
    void load();
    const id = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="px-4 sm:px-8 py-6 max-w-5xl">
      <h1 className="text-2xl font-semibold mb-1">Backup</h1>
      <p className="text-ui-sm text-ink-tertiary mb-6">
        Status der System-Backups und Notfall-Export der Originaldateien pro
        Tenant.
      </p>

      {error && (
        <div className="rounded-md border border-semantic-danger/30 bg-semantic-danger/8 px-3 py-2 mb-4 text-sm text-semantic-danger">
          {error}
        </div>
      )}

      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-3">Monitoring</h2>
        {!system ? (
          <div className="text-sm text-ink-tertiary">Lädt…</div>
        ) : (
          <div className="space-y-2">
            {system.backup.map((b) => (
              <BackupStatusRow key={b.key} backup={b} />
            ))}
          </div>
        )}
      </section>

      <TenantExportSection />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Monitoring-Zeile
// ---------------------------------------------------------------------------

function BackupStatusRow({ backup }: { backup: BackupStatus }) {
  const tone =
    backup.health === "ok"
      ? "text-semantic-success"
      : backup.health === "warning"
        ? "text-semantic-warning"
        : backup.health === "critical"
          ? "text-semantic-danger"
          : "text-ink-tertiary";
  return (
    <div className="rounded-md border border-line-subtle bg-surface-raised p-3 flex items-start justify-between gap-3 flex-wrap">
      <div>
        <div className="font-medium">{backup.label}</div>
        <div className="text-sm text-ink-secondary mt-0.5">{backup.message}</div>
        {backup.lastBackupAt && (
          <div className="text-xs text-ink-tertiary mt-1">
            Zuletzt:{" "}
            {new Date(backup.lastBackupAt).toLocaleString("de-DE", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
            {backup.sizeBytes !== null && ` · ${formatBytes(backup.sizeBytes)}`}
          </div>
        )}
      </div>
      <div className={`text-sm font-medium whitespace-nowrap ${tone}`}>
        ● {backup.health.toUpperCase()}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-Tenant-Notfall-Export
// ---------------------------------------------------------------------------

function TenantExportSection() {
  const [tenants, setTenants] = useState<TenantList | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<TenantList[number] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .superListTenants()
      .then((r) => {
        if (!cancelled) setTenants(r.tenants);
      })
      .catch(() => {
        if (!cancelled) setTenants([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = (tenants ?? []).filter((t) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return (
      t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q)
    );
  });

  return (
    <section>
      <h2 className="text-lg font-semibold mb-1">Notfall-Export (Originale)</h2>
      <p className="text-ui-sm text-ink-tertiary mb-4">
        Exportiert alle Galerien eines Tenants als ZIP (Originale +
        metadata.json), ein Archiv pro Galerie. Download-Links sind 30 Tage
        gültig.
      </p>

      {!selected ? (
        <>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Tenant suchen (Name oder Slug)…"
            className="w-full rounded-md border border-line-subtle bg-surface-base px-3 py-2 text-sm mb-3"
          />
          {!tenants ? (
            <div className="text-sm text-ink-tertiary">Lädt…</div>
          ) : (
            <div className="space-y-1 max-h-96 overflow-auto">
              {visible.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelected(t)}
                  className="w-full text-left rounded-md border border-line-subtle bg-surface-raised px-3 py-2 hover:bg-surface-sunken flex items-center justify-between gap-2"
                >
                  <span>
                    <span className="font-medium">{t.name}</span>{" "}
                    <span className="text-ink-tertiary text-sm">/{t.slug}</span>
                  </span>
                  <span className="text-xs text-ink-tertiary whitespace-nowrap">
                    {t.galleryCount} Galerien · {t.status}
                  </span>
                </button>
              ))}
              {visible.length === 0 && (
                <div className="text-sm text-ink-tertiary">
                  Kein Tenant gefunden.
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <TenantExportPanel
          tenant={selected}
          onBack={() => setSelected(null)}
        />
      )}
    </section>
  );
}

function TenantExportPanel({
  tenant,
  onBack,
}: {
  tenant: TenantList[number];
  onBack: () => void;
}) {
  const [exports, setExports] = useState<ExportList | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const loadExports = useCallback(async () => {
    const r = await api.superListTenantExports(tenant.id);
    setExports(r.exports);
  }, [tenant.id]);

  useEffect(() => {
    void loadExports();
  }, [loadExports]);

  async function trigger() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.superTriggerTenantExport(tenant.id);
      setMsg(
        `Export gestartet: ${r.itemCount} Galerie(n). Die ZIPs werden im Hintergrund gebaut.`
      );
      await loadExports();
    } catch (err) {
      const m = err instanceof Error ? err.message : "Fehler";
      setMsg(
        m.includes("no_galleries")
          ? "Dieser Tenant hat keine Galerien zum Exportieren."
          : `Fehler: ${m}`
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <div>
          <button
            onClick={onBack}
            className="text-sm text-ink-tertiary hover:text-ink-primary"
          >
            ← Tenant-Liste
          </button>
          <div className="text-lg font-medium mt-1">
            {tenant.name}{" "}
            <span className="text-ink-tertiary text-sm">/{tenant.slug}</span>
          </div>
        </div>
        <button
          onClick={trigger}
          disabled={busy || tenant.galleryCount === 0}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast disabled:opacity-50"
        >
          {busy ? "Startet…" : "Originale exportieren"}
        </button>
      </div>

      {msg && (
        <div className="rounded-md border border-line-subtle bg-surface-sunken px-3 py-2 mb-4 text-sm text-ink-secondary">
          {msg}
        </div>
      )}

      {!exports ? (
        <div className="text-sm text-ink-tertiary">Lädt…</div>
      ) : exports.length === 0 ? (
        <div className="text-sm text-ink-tertiary">
          Noch keine Exporte für diesen Tenant.
        </div>
      ) : (
        <div className="space-y-2">
          {exports.map((e) => (
            <ExportRow
              key={e.id}
              tenantId={tenant.id}
              exportSummary={e}
              open={openId === e.id}
              onToggle={() => setOpenId(openId === e.id ? null : e.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ExportRow({
  tenantId,
  exportSummary,
  open,
  onToggle,
}: {
  tenantId: string;
  exportSummary: ExportList[number];
  open: boolean;
  onToggle: () => void;
}) {
  const [detail, setDetail] = useState<ExportDetail | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      try {
        const r = await api.superTenantExportDetail(
          tenantId,
          exportSummary.id
        );
        if (!cancelled) setDetail(r.export);
      } catch {
        /* ignore transient */
      }
    }
    void load();
    // Solange noch gebaut wird, alle 4s nachladen (Download-Links erscheinen).
    const id = setInterval(() => {
      if (exportSummary.status !== "ready") void load();
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [open, tenantId, exportSummary.id, exportSummary.status]);

  return (
    <div className="rounded-md border border-line-subtle bg-surface-raised">
      <button
        onClick={onToggle}
        className="w-full text-left px-3 py-2 flex items-center justify-between gap-2"
      >
        <span className="text-sm">
          {new Date(exportSummary.createdAt).toLocaleString("de-DE", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}{" "}
          · {exportSummary.itemCount} Galerie(n)
        </span>
        <span className="text-xs text-ink-tertiary">
          {exportSummary.status} {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div className="border-t border-line-subtle p-3 space-y-1">
          {!detail ? (
            <div className="text-sm text-ink-tertiary">Lädt…</div>
          ) : (
            detail.items.map((it) => (
              <div
                key={it.id}
                className="flex items-center justify-between gap-2 text-sm py-1 flex-wrap"
              >
                <span>
                  {it.galleryName}
                  <span className="text-ink-tertiary">
                    {" "}
                    {it.fileCount !== null && `· ${it.fileCount} Dateien `}
                    {it.sizeBytes !== null && `· ${formatBytes(it.sizeBytes)}`}
                  </span>
                </span>
                {it.status === "ready" && it.downloadUrl ? (
                  <a
                    href={it.downloadUrl}
                    className="text-accent hover:underline whitespace-nowrap"
                  >
                    ZIP herunterladen
                  </a>
                ) : it.status === "failed" ? (
                  <span className="text-semantic-danger whitespace-nowrap">
                    fehlgeschlagen
                  </span>
                ) : (
                  <span className="text-ink-tertiary whitespace-nowrap">
                    {it.status}…
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024))
  );
  return `${(bytes / 1024 ** i).toFixed(2)} ${units[i]}`;
}
