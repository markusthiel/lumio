"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  api,
  type SuperUserListItem,
  type SuperTenantSummary,
} from "@/lib/api";
import { SuperShell } from "@/components/super/SuperShell";

export default function SuperUsersPage() {
  return (
    <SuperShell>
      <UsersList />
    </SuperShell>
  );
}

type RoleFilter = "" | "owner" | "admin" | "member";
type StatusFilter = "" | "active" | "invited" | "disabled";

const PAGE_SIZE = 50;

function UsersList() {
  const [users, setUsers] = useState<SuperUserListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [role, setRole] = useState<RoleFilter>("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [tenantId, setTenantId] = useState("");
  const [tenants, setTenants] = useState<SuperTenantSummary[]>([]);
  const [editing, setEditing] = useState<SuperUserListItem | null>(null);
  const [creating, setCreating] = useState(false);

  // Tenant-Liste einmal laden — für das Filter-Dropdown.
  useEffect(() => {
    void (async () => {
      try {
        const r = await api.superListTenants();
        setTenants(r.tenants);
      } catch {
        // Filter bleibt dann ohne Tenant-Optionen — kein harter Fehler.
      }
    })();
  }, []);

  // Debounce-Timer für die Suche, damit nicht jeder Tastendruck feuert.
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPage = useCallback(
    async (offset: number, replace: boolean) => {
      setLoading(true);
      try {
        const r = await api.superListUsers({
          q: q.trim() || undefined,
          role: role || undefined,
          status: status || undefined,
          tenantId: tenantId || undefined,
          limit: PAGE_SIZE,
          offset,
        });
        setTotal(r.total);
        setUsers((prev) => (replace ? r.users : [...prev, ...r.users]));
      } finally {
        setLoading(false);
      }
    },
    [q, role, status, tenantId]
  );

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void fetchPage(0, true), 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [fetchPage]);

  const reload = () => void fetchPage(0, true);

  return (
    <div className="px-4 sm:px-8 py-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Users</h1>
          <p className="text-ui-sm text-ink-tertiary mt-0.5">
            Alle User über alle Tenants. Gleiche E-Mail kann in mehreren
            Tenants vorkommen — der Tenant steht jeweils dahinter.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="h-9 px-4 rounded bg-accent text-accent-contrast font-medium text-ui-sm hover:bg-accent-hover transition-colors"
        >
          + Neuer User
        </button>
      </div>

      {/* Filterzeile */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Suche E-Mail, Name oder Tenant…"
          className="flex-1 min-w-48 h-9 px-3 rounded-md border border-line-subtle bg-surface-raised text-ui-sm"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as RoleFilter)}
          className="h-9 px-2 rounded-md border border-line-subtle bg-surface-raised text-ui-sm"
        >
          <option value="">Alle Rollen</option>
          <option value="owner">Owner</option>
          <option value="admin">Admin</option>
          <option value="member">Member</option>
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          className="h-9 px-2 rounded-md border border-line-subtle bg-surface-raised text-ui-sm"
        >
          <option value="">Alle Status</option>
          <option value="active">active</option>
          <option value="invited">invited</option>
          <option value="disabled">disabled</option>
        </select>
        <select
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          className="h-9 px-2 rounded-md border border-line-subtle bg-surface-raised text-ui-sm max-w-56"
        >
          <option value="">Alle Tenants</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.displayName ?? t.name} ({t.slug})
            </option>
          ))}
        </select>
      </div>

      {users.length === 0 && !loading ? (
        <div className="rounded-md border border-dashed border-line-subtle bg-surface-sunken p-12 text-center">
          <p className="text-ui text-ink-tertiary">Keine User gefunden.</p>
        </div>
      ) : (
        <div className="border border-line-subtle rounded-md bg-surface-raised overflow-hidden">
          <table className="w-full text-ui-sm">
            <thead className="text-ink-tertiary text-ui-xs uppercase tracking-wide">
              <tr className="border-b border-line-subtle">
                <th className="text-left font-medium px-3 py-2">User</th>
                <th className="text-left font-medium px-3 py-2">Tenant</th>
                <th className="text-left font-medium px-3 py-2">Rolle</th>
                <th className="text-left font-medium px-3 py-2">Status</th>
                <th className="text-right font-medium px-3 py-2">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  className="border-b border-line-subtle last:border-0 hover:bg-surface-sunken/50"
                >
                  <td className="px-3 py-2">
                    <div className="font-medium text-ink-primary">
                      {u.name ?? "—"}
                    </div>
                    <div className="text-ink-tertiary text-ui-xs">{u.email}</div>
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/super/tenants/${u.tenant.id}`}
                      className="text-accent hover:underline"
                    >
                      {u.tenant.name}
                    </Link>
                    <div className="text-ink-tertiary text-ui-xs">
                      {u.tenant.slug}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <RoleBadge role={u.role} />
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={u.status} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setEditing(u)}
                      className="text-ui-xs text-accent hover:underline"
                    >
                      Bearbeiten
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between text-ui-xs text-ink-tertiary">
        <span>
          {users.length} von {total}
        </span>
        {users.length < total && (
          <button
            type="button"
            disabled={loading}
            onClick={() => void fetchPage(users.length, false)}
            className="text-ui-sm px-3 py-1.5 rounded-md border border-line-subtle hover:bg-surface-sunken disabled:opacity-50"
          >
            {loading ? "Lädt…" : "Mehr laden"}
          </button>
        )}
      </div>

      {editing && (
        <EditUserDialog
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {creating && (
        <CreateUserDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const cls =
    role === "owner"
      ? "bg-accent/15 text-accent"
      : role === "admin"
        ? "bg-semantic-success/15 text-semantic-success"
        : "bg-ink-tertiary/15 text-ink-secondary";
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-ui-xs ${cls}`}>
      {role}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "active"
      ? "bg-semantic-success/15 text-semantic-success"
      : status === "invited"
        ? "bg-accent/15 text-accent"
        : "bg-semantic-danger/15 text-semantic-danger";
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-ui-xs ${cls}`}>
      {status}
    </span>
  );
}

function EditUserDialog({
  user,
  onClose,
  onSaved,
}: {
  user: SuperUserListItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(user.name ?? "");
  const [role, setRole] = useState<"owner" | "admin" | "member">(
    (user.role as "owner" | "admin" | "member") ?? "member"
  );
  // 'invited' bleibt 'invited' bis Setup; hier nur active/disabled umschaltbar.
  const [status, setStatus] = useState<"active" | "disabled">(
    user.status === "disabled" ? "disabled" : "active"
  );
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.superUpdateUser(user.id, {
        name: name.trim() || null,
        role,
        // invited nie als Update senden — der Status kommt erst durch Setup.
        ...(user.status === "invited" ? {} : { status }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    setError(null);
    setBusy(true);
    try {
      const r = await api.superResetUserPassword(user.id);
      setResetUrl(r.resetUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[100]"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={save}
        className="w-full max-w-md bg-surface-raised border border-line-subtle shadow-2xl rounded-lg p-6 space-y-4"
      >
        <div>
          <h2 className="text-lg font-semibold">User bearbeiten</h2>
          <p className="text-ui-xs text-ink-tertiary mt-0.5">
            {user.email} · {user.tenant.name} ({user.tenant.slug})
          </p>
        </div>

        <div>
          <label htmlFor="u-name" className="text-sm font-medium block mb-1">
            Name
          </label>
          <input
            id="u-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            className="w-full rounded-md border border-line-subtle px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="u-role" className="text-sm font-medium block mb-1">
            Rolle
          </label>
          <select
            id="u-role"
            value={role}
            onChange={(e) =>
              setRole(e.target.value as "owner" | "admin" | "member")
            }
            className="w-full rounded-md border border-line-subtle px-3 py-2 text-sm bg-surface-raised"
          >
            <option value="owner">Owner</option>
            <option value="admin">Admin</option>
            <option value="member">Member</option>
          </select>
        </div>

        {user.status === "invited" ? (
          <div className="text-ui-xs text-ink-tertiary">
            Status: <span className="font-mono">invited</span> — wird aktiv,
            sobald der User den Setup-Link eingelöst hat.
          </div>
        ) : (
          <div>
            <label htmlFor="u-status" className="text-sm font-medium block mb-1">
              Status
            </label>
            <select
              id="u-status"
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as "active" | "disabled")
              }
              className="w-full rounded-md border border-line-subtle px-3 py-2 text-sm bg-surface-raised"
            >
              <option value="active">active</option>
              <option value="disabled">disabled (Login gesperrt)</option>
            </select>
          </div>
        )}

        {resetUrl && (
          <div className="rounded-md border border-line-subtle bg-surface-sunken p-2 text-ui-xs break-all">
            Reset-Link (auch per Mail verschickt):
            <div className="font-mono mt-1">{resetUrl}</div>
          </div>
        )}

        {error && <div className="text-sm text-semantic-danger">{error}</div>}

        <div className="flex justify-between items-center gap-2 pt-2 border-t border-line-subtle">
          <button
            type="button"
            onClick={resetPassword}
            disabled={busy || user.status !== "active"}
            title={
              user.status !== "active"
                ? "Nur für aktive User"
                : "Passwort-Reset-Link senden"
            }
            className="text-ui-sm px-3 py-2 rounded-md border border-line-subtle hover:bg-surface-sunken disabled:opacity-50"
          >
            Passwort-Reset
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-sm px-3 py-2 rounded-md border border-line-subtle hover:bg-surface-sunken"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={busy}
              className="text-sm px-3 py-2 rounded-md bg-accent text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? "Speichert…" : "Speichern"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function CreateUserDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [tenants, setTenants] = useState<SuperTenantSummary[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"owner" | "admin" | "member">("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const r = await api.superListTenants();
        // Nur aktive Tenants können neue User aufnehmen.
        const active = r.tenants.filter((t) => t.status === "active");
        setTenants(active);
        if (active[0]) setTenantId(active[0].id);
      } catch {
        // Tenant-Liste optional — Fehler unten beim Submit sichtbar.
      }
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!tenantId) {
      setError("Bitte einen Tenant wählen.");
      return;
    }
    setBusy(true);
    try {
      await api.superCreateUser(tenantId, {
        email: email.trim(),
        name: name.trim(),
        role,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Anlegen fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[100]"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-md bg-surface-raised border border-line-subtle shadow-2xl rounded-lg p-6 space-y-4"
      >
        <h2 className="text-lg font-semibold">Neuen User anlegen</h2>
        <p className="text-ui-xs text-ink-tertiary -mt-2">
          Der User wird eingeladen (Status „invited") und bekommt eine
          Setup-Mail zum Passwort setzen.
        </p>

        <div>
          <label htmlFor="c-tenant" className="text-sm font-medium block mb-1">
            Tenant
          </label>
          <select
            id="c-tenant"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            className="w-full rounded-md border border-line-subtle px-3 py-2 text-sm bg-surface-raised"
          >
            {tenants.length === 0 && <option value="">— kein aktiver Tenant —</option>}
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.displayName ?? t.name} ({t.slug})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="c-email" className="text-sm font-medium block mb-1">
            E-Mail
          </label>
          <input
            id="c-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={200}
            required
            className="w-full rounded-md border border-line-subtle px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="c-name" className="text-sm font-medium block mb-1">
            Name
          </label>
          <input
            id="c-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            required
            className="w-full rounded-md border border-line-subtle px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="c-role" className="text-sm font-medium block mb-1">
            Rolle
          </label>
          <select
            id="c-role"
            value={role}
            onChange={(e) =>
              setRole(e.target.value as "owner" | "admin" | "member")
            }
            className="w-full rounded-md border border-line-subtle px-3 py-2 text-sm bg-surface-raised"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            <option value="owner">Owner</option>
          </select>
        </div>

        {error && <div className="text-sm text-semantic-danger">{error}</div>}

        <div className="flex justify-end gap-2 pt-2 border-t border-line-subtle">
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-3 py-2 rounded-md border border-line-subtle hover:bg-surface-sunken"
          >
            Abbrechen
          </button>
          <button
            type="submit"
            disabled={busy}
            className="text-sm px-3 py-2 rounded-md bg-accent text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? "Legt an…" : "Anlegen"}
          </button>
        </div>
      </form>
    </div>
  );
}
