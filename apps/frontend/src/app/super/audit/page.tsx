"use client";

/**
 * Super-Admin Audit-Log Browser
 *
 * Anzeige der zentralen Event-Tabelle mit Filter + Cursor-Pagination.
 *
 * Filter:
 *  - Action (Dropdown mit haeufigsten Actions als Prefix-Suche)
 *  - Actor-Type
 *  - Tenant (Free-Text-Slug-Suche, optional)
 *  - Zeitraum
 *
 * Pagination: cursor-basiert ("Mehr laden"-Button am Ende). Klassische
 * Page-Numbers gehen mit Cursors nicht, aber bei einem Audit-Log will
 * man eh selten zu Seite 42 springen — man scrollt rueckwaerts in der
 * Zeit oder filtert enger. "Mehr laden" passt zur Realnutzung.
 *
 * Payload-Anzeige: pro Eintrag ausklappbar. Standardmaessig kompakt,
 * Klick auf den Eintrag faltet das JSON aus. So bleibt die Tabelle
 * scanbar, Details on demand.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { SuperShell } from "@/components/super/SuperShell";

type AuditResponse = Awaited<ReturnType<typeof api.superAuditLog>>;
type AuditRow = AuditResponse["events"][number];

export default function SuperAuditPage() {
  return (
    <SuperShell>
      <AuditContent />
    </SuperShell>
  );
}

function AuditContent() {
  const [actorType, setActorType] = useState<
    "" | "user" | "access" | "system" | "super_admin"
  >("");
  const [actionPrefix, setActionPrefix] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actions, setActions] = useState<
    Array<{ action: string; count: number }>
  >([]);

  // Bei jedem Filter-Change: komplett neu laden, alte Liste verwerfen
  // (Cursor wird ungueltig wenn Filter sich aendert).
  useEffect(() => {
    setRows([]);
    setCursor(null);
    void loadMore(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorType, actionPrefix, tenantId, from, to]);

  // Distinct-Actions einmalig fuer das Dropdown
  useEffect(() => {
    api
      .superAuditDistinctActions()
      .then((r) => setActions(r.actions))
      .catch(() => setActions([]));
  }, []);

  async function loadMore(replace = false) {
    setLoading(true);
    setError(null);
    try {
      const params: Parameters<typeof api.superAuditLog>[0] = {
        limit: 50,
        cursor: replace ? undefined : cursor ?? undefined,
      };
      if (actorType) params.actorType = actorType;
      if (actionPrefix) params.actionPrefix = actionPrefix;
      if (tenantId) params.tenantId = tenantId;
      if (from) params.from = new Date(from).toISOString();
      if (to) params.to = new Date(to).toISOString();

      const res = await api.superAuditLog(params);
      setRows((prev) => (replace ? res.events : [...prev, ...res.events]));
      setCursor(res.nextCursor);
      setHasMore(res.nextCursor !== null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }

  // Actions-Liste nach Prefix-Haeufigkeit gruppieren fuer das Dropdown
  // (Top-Level: "share.", "super.", "tenant." etc.)
  const actionPrefixes = useMemo(() => {
    const set = new Set<string>();
    for (const a of actions) {
      const dot = a.action.indexOf(".");
      if (dot > 0) set.add(a.action.slice(0, dot + 1));
    }
    return Array.from(set).sort();
  }, [actions]);

  return (
    <div className="px-4 sm:px-8 py-6 max-w-6xl">
      <h1 className="text-2xl font-semibold mb-1">Audit-Log</h1>
      <p className="text-ui-sm text-ink-tertiary mb-6">
        Vollständige Aktions-Historie über alle Tenants und den Super-Admin.
      </p>

      <div className="bg-surface-raised border border-line-subtle rounded-md p-4 mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div>
          <label className="text-xs text-ink-tertiary block mb-1">
            Actor-Type
          </label>
          <select
            value={actorType}
            onChange={(e) => setActorType(e.target.value as typeof actorType)}
            className="w-full rounded border border-line-subtle px-2 py-1.5 text-sm bg-surface-base"
          >
            <option value="">Alle</option>
            <option value="user">user</option>
            <option value="access">access</option>
            <option value="system">system</option>
            <option value="super_admin">super_admin</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-ink-tertiary block mb-1">
            Action-Bereich
          </label>
          <select
            value={actionPrefix}
            onChange={(e) => setActionPrefix(e.target.value)}
            className="w-full rounded border border-line-subtle px-2 py-1.5 text-sm bg-surface-base"
          >
            <option value="">Alle</option>
            {actionPrefixes.map((p) => (
              <option key={p} value={p}>
                {p}*
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-ink-tertiary block mb-1">
            Tenant-ID
          </label>
          <input
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder="UUID"
            className="w-full rounded border border-line-subtle px-2 py-1.5 text-sm bg-surface-base font-mono"
          />
        </div>
        <div>
          <label className="text-xs text-ink-tertiary block mb-1">Von</label>
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-full rounded border border-line-subtle px-2 py-1.5 text-sm bg-surface-base"
          />
        </div>
        <div>
          <label className="text-xs text-ink-tertiary block mb-1">Bis</label>
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-full rounded border border-line-subtle px-2 py-1.5 text-sm bg-surface-base"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-semantic-danger bg-semantic-danger/10 text-semantic-danger text-sm p-3 mb-4">
          {error}
        </div>
      )}

      <div className="border border-line-subtle rounded-md bg-surface-raised overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="border-b border-line-subtle text-xs uppercase tracking-wider text-ink-tertiary text-left">
              <th className="px-3 py-2 font-medium">Zeit</th>
              <th className="px-3 py-2 font-medium">Tenant</th>
              <th className="px-3 py-2 font-medium">Actor</th>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">Target</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-8 text-center text-ink-tertiary"
                >
                  Keine Einträge mit diesen Filtern.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <AuditRowItem key={row.id} row={row} />
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center">
        {hasMore ? (
          <button
            onClick={() => loadMore(false)}
            disabled={loading}
            className="text-sm px-4 py-2 rounded border border-line-subtle hover:bg-surface-sunken disabled:opacity-50"
          >
            {loading ? "Lädt…" : "Mehr laden"}
          </button>
        ) : rows.length > 0 ? (
          <span className="text-xs text-ink-tertiary">Ende der Liste</span>
        ) : null}
      </div>
    </div>
  );
}

function AuditRowItem({ row }: { row: AuditRow }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails =
    !!row.payload || !!row.targetId || !!row.actorId || !!row.ipAddress;

  const dateStr = new Date(row.createdAt).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <>
      <tr
        className={
          "border-b border-line-subtle " +
          (hasDetails
            ? "cursor-pointer hover:bg-surface-sunken/40"
            : "")
        }
        onClick={() => hasDetails && setExpanded((e) => !e)}
      >
        <td className="px-3 py-2 text-xs font-mono text-ink-secondary whitespace-nowrap">
          {dateStr}
        </td>
        <td className="px-3 py-2 text-sm">
          {row.tenantId ? (
            <Link
              href={`/super/tenants/${row.tenantId}`}
              className="hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {row.tenantName ?? row.tenantSlug ?? row.tenantId.slice(0, 8)}
            </Link>
          ) : (
            <span className="text-ink-tertiary">—</span>
          )}
        </td>
        <td className="px-3 py-2 text-xs">
          <span className="inline-block px-1.5 py-0.5 rounded bg-surface-sunken text-ink-secondary font-mono">
            {row.actorType}
          </span>
        </td>
        <td className="px-3 py-2 text-sm font-mono">{row.action}</td>
        <td className="px-3 py-2 text-xs text-ink-tertiary">
          {row.targetType}
          {row.targetId && (
            <span className="ml-1 font-mono">
              {row.targetId.slice(0, 8)}…
            </span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-line-subtle bg-surface-sunken/30">
          <td colSpan={5} className="px-3 py-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <DetailField label="Actor-ID" value={row.actorId} mono />
              <DetailField label="Target-ID" value={row.targetId} mono />
              <DetailField label="IP-Adresse" value={row.ipAddress} mono />
              <DetailField
                label="Event-ID"
                value={row.id}
                mono
              />
            </div>
            {row.payload !== null && row.payload !== undefined && (
              <div className="mt-3">
                <div className="text-xs text-ink-tertiary mb-1">Payload</div>
                <pre className="text-xs font-mono bg-surface-base border border-line-subtle rounded p-2 overflow-x-auto">
                  {JSON.stringify(row.payload, null, 2)}
                </pre>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function DetailField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-ink-tertiary">{label}</div>
      <div className={mono ? "font-mono break-all" : ""}>
        {value ?? <span className="text-ink-tertiary">—</span>}
      </div>
    </div>
  );
}
