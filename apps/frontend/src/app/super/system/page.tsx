"use client";

/**
 * Super-Admin — System (Self-Hosting Operations)
 *
 * Drei Bereiche fuer den Betrieb:
 *
 *  1. System-Health: DB, Redis, S3, Worker, Queue-Lengths, Disk-Frei
 *     Pollt alle 10s damit Outages live sichtbar werden
 *  2. Update-Check: latest Forgejo-Release vs lokale Version
 *  3. DB-Backup-Status: Alter der letzten erfolgreichen Sicherung
 *
 * Bewusst keine Aktion-Buttons — diese Page ist Read-Only. Wer Updates
 * deployen will, macht das auf der Shell mit dem dokumentierten
 * Deploy-Command. Wer Backups konfigurieren will, setzt die ENV-Variable.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { SuperShell } from "@/components/super/SuperShell";

type SystemResponse = Awaited<ReturnType<typeof api.superSystemStatus>>;

export default function SuperSystemPage() {
  return (
    <SuperShell>
      <SystemContent />
    </SuperShell>
  );
}

function SystemContent() {
  const [data, setData] = useState<SystemResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await api.superSystemStatus();
        if (!cancelled) setData(r);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Fehler");
      }
    }
    void load();
    const id = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="px-4 sm:px-8 py-6 max-w-5xl">
      <h1 className="text-2xl font-semibold mb-1">System</h1>
      <p className="text-ui-sm text-ink-tertiary mb-6">
        Live-Status der Infrastruktur, Update-Check und Backup-Status.
        Aktualisiert sich alle 10 Sekunden.
      </p>

      {error && (
        <div className="rounded-md border border-semantic-danger/30 bg-semantic-danger/8 px-3 py-2 mb-4 text-sm text-semantic-danger">
          {error}
        </div>
      )}

      {!data ? (
        <div className="text-sm text-ink-tertiary">Lädt…</div>
      ) : (
        <div className="space-y-6">
          <SystemHealthCard health={data.health} />
          <UpdateCheckCard update={data.update} />
          {data.backup.map((b) => (
            <BackupStatusCard key={b.key} backup={b} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// System-Health
// ---------------------------------------------------------------------------

function SystemHealthCard({
  health,
}: {
  health: SystemResponse["health"];
}) {
  const services = [
    { key: "db", label: "PostgreSQL", check: health.db },
    { key: "redis", label: "Redis", check: health.redis },
    { key: "s3", label: "S3-Storage", check: health.s3 },
    { key: "worker", label: "Worker", check: health.worker },
  ];

  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">System-Health</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {services.map((s) => (
          <HealthBadge key={s.key} label={s.label} check={s.check} />
        ))}
      </div>

      <div className="rounded-md border border-line-subtle bg-surface-raised p-4 space-y-3">
        <div>
          <div className="text-ui-xs uppercase tracking-[0.12em] text-ink-tertiary mb-2">
            Queue-Lengths
          </div>
          {Object.keys(health.queues).length === 0 ? (
            <div className="text-sm text-ink-tertiary italic">Keine Daten.</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-sm font-mono">
              {Object.entries(health.queues).map(([name, len]) => (
                <div key={name} className="flex justify-between">
                  <span className="text-ink-tertiary text-xs">
                    {name.toLowerCase()}
                  </span>
                  <span
                    className={
                      len === -1
                        ? "text-semantic-danger"
                        : len > 100
                          ? "text-semantic-warning"
                          : "text-ink-primary"
                    }
                  >
                    {len === -1 ? "err" : len}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {health.diskFreeMib !== null && (
          <div className="flex justify-between text-sm pt-2 border-t border-line-subtle">
            <span className="text-ink-tertiary">Disk frei (Container)</span>
            <span className="font-mono">
              {formatMib(health.diskFreeMib)}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function HealthBadge({
  label,
  check,
}: {
  label: string;
  check: { ok: boolean; latencyMs: number | null; message?: string };
}) {
  return (
    <div
      className={
        "rounded-md border p-4 " +
        (check.ok
          ? "border-line-subtle bg-surface-raised"
          : "border-semantic-danger/30 bg-semantic-danger/8")
      }
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-ui-xs uppercase tracking-[0.12em] text-ink-tertiary">
          {label}
        </span>
        <span
          className={
            check.ok
              ? "text-xs text-semantic-success font-medium"
              : "text-xs text-semantic-danger font-medium"
          }
        >
          {check.ok ? "● OK" : "● DOWN"}
        </span>
      </div>
      <div className="text-2xl font-semibold">
        {check.latencyMs !== null ? `${check.latencyMs} ms` : "—"}
      </div>
      {check.message && (
        <div className="text-xs text-ink-tertiary mt-1 truncate" title={check.message}>
          {check.message}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Update-Check
// ---------------------------------------------------------------------------

function UpdateCheckCard({
  update,
}: {
  update: SystemResponse["update"];
}) {
  if (update.disabled) {
    return (
      <section>
        <h2 className="text-lg font-semibold mb-3">Update-Check</h2>
        <div className="rounded-md border border-line-subtle bg-surface-raised p-4">
          <div className="text-sm text-ink-tertiary">{update.disabled}</div>
          <div className="text-xs text-ink-tertiary mt-2">
            Aktuelle Version:{" "}
            <span className="font-mono">{update.currentVersion}</span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">Update-Check</h2>
      <div
        className={
          "rounded-md border p-4 " +
          (update.updateAvailable
            ? "border-accent/40 bg-accent/8"
            : "border-line-subtle bg-surface-raised")
        }
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-ui-xs uppercase tracking-[0.12em] text-ink-tertiary mb-1">
              {update.updateAvailable ? "Update verfügbar" : "Aktuell"}
            </div>
            <div className="text-lg">
              <span className="font-mono">{update.currentVersion}</span>
              {update.updateAvailable && (
                <>
                  {" → "}
                  <span className="font-mono font-semibold text-accent">
                    {update.latestVersion}
                  </span>
                </>
              )}
              {!update.updateAvailable && update.latestVersion && (
                <span className="text-ink-tertiary text-sm ml-2">
                  (latest: {update.latestVersion})
                </span>
              )}
            </div>
            {update.publishedAt && (
              <div className="text-xs text-ink-tertiary mt-1">
                Release vom{" "}
                {new Date(update.publishedAt).toLocaleDateString("de-DE", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}
              </div>
            )}
          </div>
          {update.releaseUrl && (
            <a
              href={update.releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-accent hover:underline"
            >
              ↗ Release-Notes
            </a>
          )}
        </div>

        {update.releaseNotes && update.updateAvailable && (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-ink-secondary">
              Release-Notes anzeigen
            </summary>
            <pre className="mt-2 p-3 bg-surface-sunken rounded text-xs font-mono whitespace-pre-wrap overflow-x-auto">
              {update.releaseNotes}
            </pre>
          </details>
        )}

        {update.updateAvailable && (
          <div className="mt-4 rounded-md bg-surface-sunken p-3 text-xs font-mono">
            cd /opt/docker/lumio/lumio && git pull && \<br />
            docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.gpu.yml up -d --build api worker frontend
          </div>
        )}

        {update.checkedAt && (
          <div className="text-xs text-ink-tertiary mt-3">
            Geprüft:{" "}
            {new Date(update.checkedAt).toLocaleString("de-DE", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Backup-Status
// ---------------------------------------------------------------------------

function BackupStatusCard({
  backup,
}: {
  backup: SystemResponse["backup"][number];
}) {
  if (!backup.configured) {
    return (
      <section>
        <h2 className="text-lg font-semibold mb-3">{backup.label}</h2>
        <div className="rounded-md border border-semantic-warning/30 bg-semantic-warning/8 p-4">
          <div className="text-sm text-ink-secondary mb-2">{backup.message}</div>
          <details className="text-xs">
            <summary className="cursor-pointer text-ink-tertiary">
              So konfigurierst du es
            </summary>
            <div className="mt-2 space-y-2">
              <p>
                Setze die Environment-Variable{" "}
                <code className="bg-surface-sunken px-1 rounded">BACKUP_STATUS_PATH</code>{" "}
                auf einen Pfad, in den dein nightly-Backup-Skript nach
                erfolgreichem <code className="bg-surface-sunken px-1 rounded">pg_dump</code>{" "}
                den Timestamp und die Dump-Groesse schreibt:
              </p>
              <pre className="bg-surface-sunken p-2 rounded font-mono whitespace-pre-wrap">
                {`# In deinem Backup-Cronjob nach erfolgreichem pg_dump:
DUMP_PATH="/backups/lumio-$(date -u +%Y%m%d).sql.gz"
pg_dump ... | gzip > "$DUMP_PATH"
echo -e "$(date -u +%FT%TZ)\\n$(stat -c%s "$DUMP_PATH")" \\
  > "$BACKUP_STATUS_PATH"`}
              </pre>
            </div>
          </details>
        </div>
      </section>
    );
  }

  const healthColor =
    backup.health === "ok"
      ? "border-line-subtle bg-surface-raised"
      : backup.health === "warning"
        ? "border-semantic-warning/30 bg-semantic-warning/8"
        : "border-semantic-danger/30 bg-semantic-danger/8";
  const healthLabel =
    backup.health === "ok"
      ? "OK"
      : backup.health === "warning"
        ? "WARNUNG"
        : "KRITISCH";
  const healthTextColor =
    backup.health === "ok"
      ? "text-semantic-success"
      : backup.health === "warning"
        ? "text-semantic-warning"
        : "text-semantic-danger";

  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">{backup.label}</h2>
      <div className={`rounded-md border ${healthColor} p-4`}>
        <div className="flex items-start justify-between mb-2 flex-wrap gap-2">
          <div>
            <div className="text-ui-xs uppercase tracking-[0.12em] text-ink-tertiary mb-1">
              Letzter erfolgreicher Backup
            </div>
            <div className="text-lg">
              {backup.lastBackupAt
                ? new Date(backup.lastBackupAt).toLocaleString("de-DE", {
                    day: "2-digit",
                    month: "long",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "—"}
            </div>
            {backup.ageHours !== null && (
              <div className="text-sm text-ink-tertiary mt-0.5">
                vor {formatAge(backup.ageHours)}
              </div>
            )}
          </div>
          <div className={`text-sm font-medium ${healthTextColor}`}>
            ● {healthLabel}
          </div>
        </div>

        <div className="text-sm text-ink-secondary mt-2">{backup.message}</div>

        {backup.sizeBytes !== null && (
          <div className="text-xs text-ink-tertiary mt-2 font-mono">
            Größe: {formatBytes(backup.sizeBytes)}
          </div>
        )}

        {backup.statusPath && (
          <div className="text-xs text-ink-tertiary mt-1 font-mono">
            Status-Datei: {backup.statusPath}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatMib(mib: number): string {
  if (mib < 1024) return `${mib} MiB`;
  return `${(mib / 1024).toFixed(1)} GiB`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(2)} ${units[i]}`;
}

function formatAge(hours: number): string {
  if (hours < 1) {
    const min = Math.floor(hours * 60);
    return `${min} Min.`;
  }
  if (hours < 48) return `${Math.floor(hours)} Std.`;
  return `${Math.floor(hours / 24)} Tagen`;
}
