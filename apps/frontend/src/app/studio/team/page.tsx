"use client";

/**
 * Lumio Studio — Team-Management
 *
 * Liste aller User des Tenants. Owner können einladen, Rollen ändern,
 * deaktivieren, löschen. Andere User (admin/member) sehen die Liste
 * read-only.
 *
 * Sicherheits-UX:
 *   - Letzten aktiven Owner kann man NICHT downgraden/disablen/löschen
 *     (Backend lehnt mit 409 ab). Wir blenden die Buttons im UI passend
 *     aus, um Fehlklicks zu vermeiden.
 *   - Selbst-Löschen + Selbst-Disable verboten (auch Backend-Check).
 *   - Galerien-Ownership: wenn der User Galerien besitzt, blockiert das
 *     Backend den Delete mit klarer Meldung. UI zeigt das inline.
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { PageHeader } from "@/components/studio/PageHeader";
import { Button } from "@/components/ui";

interface TeamUser {
  id: string;
  email: string;
  name: string | null;
  role: "owner" | "admin" | "member";
  status: "active" | "invited" | "disabled";
  lastLoginAt: string | null;
  createdAt: string;
  totpEnabled: boolean;
}

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Aktiv",
  invited: "Eingeladen",
  disabled: "Deaktiviert",
};

export default function TeamPage() {
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [me, setMe] = useState<{
    id: string;
    role: "owner" | "admin" | "member";
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog-States
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editUser, setEditUser] = useState<TeamUser | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TeamUser | null>(null);
  const [inviteResult, setInviteResult] = useState<{
    setupUrl: string;
    email: string;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const [teamRes, meRes] = await Promise.all([
        api.listTeam(),
        api.me(),
      ]);
      setUsers(teamRes.users);
      setMe({ id: meRes.user.id, role: meRes.user.role });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const isOwner = me?.role === "owner";
  const isAdmin = me?.role === "admin";
  // Owner und Admin koennen das Team verwalten — Member sehen die
  // Seite gar nicht erst (Backend 403 + Sidebar versteckt sie).
  const canManage = isOwner || isAdmin;
  const activeOwnerCount = users.filter(
    (u) => u.role === "owner" && u.status === "active"
  ).length;

  return (
    <>
      <PageHeader
        title="Team"
        description={
          isOwner
            ? "User dieses Studios. Du kannst andere Mitglieder einladen und Rollen verwalten."
            : "User dieses Studios. Als Admin kannst du Mitglieder einladen und verwalten — Owner-Rollen bleiben dem Owner vorbehalten."
        }
        actions={
          canManage && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setInviteOpen(true)}
            >
              User einladen
            </Button>
          )
        }
      />
      <div className="px-6 sm:px-8 lg:px-12 py-6 max-w-5xl">

      {error && (
        <div className="mb-4 rounded-md border border-semantic-danger/30 bg-semantic-danger/8 px-4 py-3 text-ui-sm text-semantic-danger">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-ui-sm text-ink-tertiary py-8 text-center">
          Wird geladen…
        </div>
      ) : (
        <section className="rounded-md border border-line-subtle bg-surface-raised divide-y divide-line-subtle">
          {users.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              isMe={me?.id === u.id}
              actorRole={me?.role ?? null}
              activeOwnerCount={activeOwnerCount}
              onEdit={() => setEditUser(u)}
              onDelete={() => setConfirmDelete(u)}
              onResend={async () => {
                try {
                  const res = await api.resendTeamInvite(u.id);
                  if (!res.mailSent && res.setupUrl) {
                    setInviteResult({ setupUrl: res.setupUrl, email: u.email });
                  }
                  await load();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Fehler");
                }
              }}
            />
          ))}
        </section>
      )}

      {inviteOpen && (
        <InviteDialog
          actorRole={me?.role ?? null}
          onClose={() => setInviteOpen(false)}
          onInvited={async (result) => {
            setInviteOpen(false);
            if (result) setInviteResult(result);
            await load();
          }}
        />
      )}

      {editUser && (
        <EditDialog
          user={editUser}
          isMe={me?.id === editUser.id}
          actorRole={me?.role ?? null}
          activeOwnerCount={activeOwnerCount}
          onClose={() => setEditUser(null)}
          onSaved={async () => {
            setEditUser(null);
            await load();
          }}
        />
      )}

      {confirmDelete && (
        <DeleteDialog
          user={confirmDelete}
          onClose={() => setConfirmDelete(null)}
          onDeleted={async () => {
            setConfirmDelete(null);
            await load();
          }}
        />
      )}

      {/* Wird gezeigt wenn die Mail nicht versendet werden konnte und
          wir den Setup-Link manuell weitergeben muessen. */}
      {inviteResult && (
        <FallbackLinkDialog
          email={inviteResult.email}
          setupUrl={inviteResult.setupUrl}
          onClose={() => setInviteResult(null)}
        />
      )}
      </div>
    </>
  );
}

function UserRow({
  user,
  isMe,
  actorRole,
  activeOwnerCount,
  onEdit,
  onDelete,
  onResend,
}: {
  user: TeamUser;
  isMe: boolean;
  actorRole: "owner" | "admin" | "member" | null;
  activeOwnerCount: number;
  onEdit: () => void;
  onDelete: () => void;
  onResend: () => void;
}) {
  // Schutz vor letztem Owner — keine Aktionen die das ändern wuerden.
  const isLastOwner =
    user.role === "owner" &&
    user.status === "active" &&
    activeOwnerCount <= 1;

  // Permission-Logik gespiegelt aus dem Backend (Variante 3):
  // - Member: keine Schreibaktionen
  // - Admin: darf Admins/Members verwalten, aber nicht Owner anfassen
  // - Owner: darf alles (modulo isLastOwner)
  const canManageThisUser =
    actorRole === "owner" || (actorRole === "admin" && user.role !== "owner");

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-ui text-ink-primary truncate">
            {user.name ?? user.email}
            {isMe && (
              <span className="text-ui-xs text-ink-tertiary ml-1">(du)</span>
            )}
          </span>
          <RoleBadge role={user.role} />
          <StatusBadge status={user.status} />
          {user.totpEnabled && (
            <span className="text-ui-xs text-ink-tertiary border border-line-subtle rounded-xs px-1.5">
              2FA
            </span>
          )}
        </div>
        <div className="text-ui-xs text-ink-tertiary mt-0.5 truncate">
          {user.email}
          {user.lastLoginAt && (
            <span className="ml-2">
              · zuletzt aktiv{" "}
              {new Date(user.lastLoginAt).toLocaleDateString("de-DE")}
            </span>
          )}
        </div>
      </div>
      {canManageThisUser && (
        <div className="flex gap-1 flex-shrink-0">
          {user.status === "invited" && (
            <Button variant="ghost" size="sm" onClick={onResend}>
              Mail erneut
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Bearbeiten
          </Button>
          {!isMe && !isLastOwner && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              title="Löschen"
            >
              Löschen
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function RoleBadge({ role }: { role: TeamUser["role"] }) {
  const cls =
    role === "owner"
      ? "bg-accent/15 text-accent border-accent/30"
      : role === "admin"
      ? "bg-semantic-info/15 text-semantic-info border-semantic-info/30"
      : "bg-surface-sunken text-ink-tertiary border-line-subtle";
  return (
    <span
      className={`text-ui-xs px-1.5 py-0.5 rounded-xs border ${cls}`}
    >
      {ROLE_LABEL[role]}
    </span>
  );
}

function StatusBadge({ status }: { status: TeamUser["status"] }) {
  if (status === "active") return null;
  const cls =
    status === "invited"
      ? "bg-semantic-warning/15 text-semantic-warning border-semantic-warning/30"
      : "bg-semantic-danger/15 text-semantic-danger border-semantic-danger/30";
  return (
    <span
      className={`text-ui-xs px-1.5 py-0.5 rounded-xs border ${cls}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function InviteDialog({
  actorRole,
  onClose,
  onInvited,
}: {
  actorRole: "owner" | "admin" | "member" | null;
  onClose: () => void;
  onInvited: (
    fallback: { setupUrl: string; email: string } | null
  ) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"owner" | "admin" | "member">("admin");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Admin darf keinen Owner einladen. Wir blenden die Option komplett
  // aus statt nur zu disablen — saubereres UX (was nicht da ist, kann
  // nicht versehentlich gewaehlt werden).
  const canInviteOwner = actorRole === "owner";

  async function submit() {
    if (!email.trim() || !name.trim()) return;
    setPending(true);
    setError(null);
    try {
      const res = await api.inviteTeamMember({
        email: email.trim(),
        name: name.trim(),
        role,
      });
      if (!res.mailSent && res.setupUrl) {
        await onInvited({ setupUrl: res.setupUrl, email: email.trim() });
      } else {
        await onInvited(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Einladen");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal onClose={pending ? () => {} : onClose}>
      <h2 className="text-lg font-medium text-ink-primary">User einladen</h2>
      <p className="text-ui-sm text-ink-secondary mt-2">
        Der eingeladene User erhält eine E-Mail mit einem Setup-Link (gültig 72
        Stunden) und kann sich danach mit eigenem Passwort einloggen.
      </p>
      <div className="space-y-3 mt-4">
        <Field label="Name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={pending}
            className={inputCls}
            placeholder="Anna Musterfrau"
          />
        </Field>
        <Field label="E-Mail">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={pending}
            className={inputCls}
            placeholder="anna@example.com"
            autoComplete="off"
          />
        </Field>
        <Field label="Rolle">
          <select
            value={role}
            onChange={(e) =>
              setRole(e.target.value as "owner" | "admin" | "member")
            }
            disabled={pending}
            className={inputCls}
          >
            <option value="admin">
              Admin — kann Galerien und Team verwalten
            </option>
            {canInviteOwner && (
              <option value="owner">
                Owner — kann zusätzlich Owner-Rollen vergeben
              </option>
            )}
            <option value="member">
              Member — eingeschränkter Zugriff
            </option>
          </select>
        </Field>
      </div>
      {error && (
        <p className="text-ui-sm text-semantic-danger mt-3">{error}</p>
      )}
      <DialogActions>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
          Abbrechen
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={submit}
          disabled={pending || !email.trim() || !name.trim()}
        >
          {pending ? "Einladung wird gesendet…" : "Einladen"}
        </Button>
      </DialogActions>
    </Modal>
  );
}

function EditDialog({
  user,
  isMe,
  actorRole,
  activeOwnerCount,
  onClose,
  onSaved,
}: {
  user: TeamUser;
  isMe: boolean;
  actorRole: "owner" | "admin" | "member" | null;
  activeOwnerCount: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(user.name ?? "");
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Admin darf keine Owner-Rolle vergeben — UI verriegelt das hier.
  // Wenn der target schon Owner ist, ist der Dialog fuer Admin gar
  // nicht erst aufrufbar (UserRow blendet die Aktionen aus).
  const canSetOwnerRole = actorRole === "owner";

  // Letzter Owner darf nicht demoted/disabled werden.
  const isLastOwner =
    user.role === "owner" &&
    user.status === "active" &&
    activeOwnerCount <= 1;
  const roleLocked = isLastOwner;
  const statusLocked = isLastOwner || isMe; // self-disable verboten

  async function save() {
    setPending(true);
    setError(null);
    try {
      const patch: {
        name?: string;
        role?: "owner" | "admin" | "member";
        status?: "active" | "disabled";
      } = {};
      if (name.trim() !== (user.name ?? "")) patch.name = name.trim();
      if (role !== user.role) patch.role = role;
      if (status !== user.status && status !== "invited") {
        patch.status = status as "active" | "disabled";
      }
      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }
      await api.updateTeamMember(user.id, patch);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Speichern");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal onClose={pending ? () => {} : onClose}>
      <h2 className="text-lg font-medium text-ink-primary">
        {user.name ?? user.email}
      </h2>
      <p className="text-ui-xs text-ink-tertiary mt-1 font-mono">
        {user.email}
      </p>
      <div className="space-y-3 mt-4">
        <Field label="Name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={pending}
            className={inputCls}
          />
        </Field>
        <Field
          label="Rolle"
          hint={
            roleLocked
              ? "Letzter aktiver Owner kann nicht herabgestuft werden."
              : undefined
          }
        >
          <select
            value={role}
            onChange={(e) =>
              setRole(e.target.value as "owner" | "admin" | "member")
            }
            disabled={pending || roleLocked}
            className={inputCls}
          >
            {canSetOwnerRole && <option value="owner">Owner</option>}
            <option value="admin">Admin</option>
            <option value="member">Member</option>
          </select>
        </Field>
        {user.status !== "invited" && (
          <Field
            label="Status"
            hint={
              isMe
                ? "Du kannst dich nicht selbst deaktivieren."
                : isLastOwner
                ? "Letzter aktiver Owner kann nicht deaktiviert werden."
                : undefined
            }
          >
            <select
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as "active" | "disabled")
              }
              disabled={pending || statusLocked}
              className={inputCls}
            >
              <option value="active">Aktiv</option>
              <option value="disabled">Deaktiviert</option>
            </select>
          </Field>
        )}
      </div>
      {error && (
        <p className="text-ui-sm text-semantic-danger mt-3">{error}</p>
      )}
      <DialogActions>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
          Abbrechen
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={save}
          disabled={pending}
        >
          {pending ? "Speichere…" : "Speichern"}
        </Button>
      </DialogActions>
    </Modal>
  );
}

function DeleteDialog({
  user,
  onClose,
  onDeleted,
}: {
  user: TeamUser;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [galleryHint, setGalleryHint] = useState<string | null>(null);

  async function performDelete() {
    setPending(true);
    setError(null);
    setGalleryHint(null);
    try {
      await api.deleteTeamMember(user.id);
      await onDeleted();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Fehler beim Löschen";
      // Backend liefert bei owns_galleries eine konkrete Meldung —
      // wir lassen sie als-is durch, sie ist schon Owner-freundlich.
      if (msg.toLowerCase().includes("galerie")) {
        setGalleryHint(msg);
      } else {
        setError(msg);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal onClose={pending ? () => {} : onClose}>
      <h2 className="text-lg font-medium text-ink-primary">
        {user.name ?? user.email} löschen?
      </h2>
      <p className="text-ui-sm text-ink-secondary mt-2">
        Der User-Account wird komplett entfernt. Sessions, API-Tokens und 2FA-
        Geräte gehen mit verloren. Falls dieser User noch Galerien besitzt,
        musst du die zuerst übergeben oder löschen.
      </p>
      <p className="text-ui-sm text-ink-secondary mt-2">
        Soft-Alternative: <span className="font-medium">Deaktivieren</span>{" "}
        statt löschen — der User kann sich nicht mehr einloggen, seine Galerien
        bleiben unter seinem Namen.
      </p>
      {galleryHint && (
        <p className="text-ui-sm text-semantic-warning mt-3">{galleryHint}</p>
      )}
      {error && (
        <p className="text-ui-sm text-semantic-danger mt-3">{error}</p>
      )}
      <DialogActions>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
          Abbrechen
        </Button>
        <Button
          variant="danger"
          size="sm"
          onClick={performDelete}
          disabled={pending}
        >
          {pending ? "Lösche…" : "Löschen"}
        </Button>
      </DialogActions>
    </Modal>
  );
}

function FallbackLinkDialog({
  email,
  setupUrl,
  onClose,
}: {
  email: string;
  setupUrl: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(setupUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="text-lg font-medium text-ink-primary">
        Mail konnte nicht versendet werden
      </h2>
      <p className="text-ui-sm text-ink-secondary mt-2">
        Die Einladung an <span className="font-mono">{email}</span> wurde
        erstellt, aber der automatische Mailversand hat nicht geklappt. Schick
        diesem User den folgenden Setup-Link manuell — er ist 72 Stunden gültig:
      </p>
      <div className="mt-3 rounded bg-surface-sunken border border-line-subtle px-3 py-2 font-mono text-ui-xs text-ink-primary break-all">
        {setupUrl}
      </div>
      <DialogActions>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Schließen
        </Button>
        <Button variant="primary" size="sm" onClick={copy}>
          {copied ? "Kopiert!" : "Link kopieren"}
        </Button>
      </DialogActions>
    </Modal>
  );
}

// -- Shared UI helpers ----------------------------------------------------

const inputCls =
  "w-full h-9 px-2.5 rounded bg-surface-sunken border border-line-subtle hover:border-line-strong focus:border-accent text-ui text-ink-primary focus:outline-none transition-colors duration-motion disabled:opacity-50";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-ui-xs text-ink-secondary block">{label}</label>
      {children}
      {hint && <p className="text-ui-xs text-ink-tertiary mt-1">{hint}</p>}
    </div>
  );
}

function Modal({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface-base rounded-lg border border-line-subtle shadow-2xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function DialogActions({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-2 justify-end mt-5">{children}</div>;
}
