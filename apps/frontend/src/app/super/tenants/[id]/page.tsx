"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, type SuperTenantDetail } from "@/lib/api";
import { SuperShell } from "@/components/super/SuperShell";
import { InviteOwnerDialog } from "@/components/super/InviteOwnerDialog";

export default function SuperTenantDetailPage() {
  return (
    <SuperShell>
      <TenantDetail />
    </SuperShell>
  );
}

function TenantDetail() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [tenant, setTenant] = useState<SuperTenantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [editingMeta, setEditingMeta] = useState(false);

  // Hard-Delete-Dialog: zeigt Slug-Confirm-Input. Wird nur ueber
  // den "Endgültig löschen"-Button geoeffnet, der wiederum nur
  // erscheint wenn Karenz vorbei ist.
  const [deleteDialog, setDeleteDialog] = useState<{
    typedSlug: string;
    error: string | null;
    pending: boolean;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.superGetTenant(id);
      setTenant(r.tenant);
    } catch {
      router.push("/super/tenants");
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function suspend() {
    if (!tenant) return;
    if (!confirm(`Tenant „${tenant.name}" suspendieren? Login + Customer-View werden blockiert.`)) return;
    setActionBusy(true);
    try {
      await api.superSuspendTenant(tenant.id);
      await load();
    } finally {
      setActionBusy(false);
    }
  }
  async function unsuspend() {
    if (!tenant) return;
    setActionBusy(true);
    try {
      await api.superUnsuspendTenant(tenant.id);
      await load();
    } finally {
      setActionBusy(false);
    }
  }
  async function archive() {
    if (!tenant) return;
    if (
      !confirm(
        `Tenant „${tenant.name}" archivieren?\n\n• Login + Customer-Sicht werden blockiert\n• Stripe-Subscription wird sofort gekündigt\n• 30-Tage-Karenzfrist läuft an — danach Hard-Delete möglich\n• Bis dahin kann der Tenant seine Daten über separaten Export-Flow herunterladen`
      )
    )
      return;
    setActionBusy(true);
    try {
      await api.superArchiveTenant(tenant.id);
      await load();
    } finally {
      setActionBusy(false);
    }
  }

  async function performHardDelete() {
    if (!tenant || !deleteDialog) return;
    setDeleteDialog({ ...deleteDialog, pending: true, error: null });
    try {
      await api.superDeleteTenant(tenant.id, {
        confirmSlug: deleteDialog.typedSlug,
      });
      // Erfolg → zurück zur Tenant-Liste
      router.push("/super/tenants");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Fehler beim Löschen";
      setDeleteDialog({
        ...deleteDialog,
        pending: false,
        error: msg,
      });
    }
  }

  if (loading || !tenant) {
    return <div className="px-8 py-6 text-ink-tertiary">Lädt…</div>;
  }

  return (
    <div className="px-8 py-6 max-w-4xl">
      <div className="text-ui-xs text-ink-tertiary mb-1">
        <button
          type="button"
          onClick={() => router.push("/super/tenants")}
          className="hover:text-ink-secondary"
        >
          Tenants
        </button>{" "}
        /
      </div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-3">
            {tenant.name}
            <StatusBadge status={tenant.status} />
          </h1>
          <div className="text-ui-sm text-ink-tertiary mt-1 font-mono">
            {tenant.slug}
            {tenant.customDomain && ` · ${tenant.customDomain}`}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          {tenant.status === "active" && (
            <ActionButton
              onClick={suspend}
              disabled={actionBusy}
              variant="warning"
            >
              Suspendieren
            </ActionButton>
          )}
          {tenant.status === "suspended" && (
            <ActionButton
              onClick={unsuspend}
              disabled={actionBusy}
              variant="success"
            >
              Reaktivieren
            </ActionButton>
          )}
          {tenant.status !== "archived" && (
            <ActionButton
              onClick={archive}
              disabled={actionBusy}
              variant="danger"
            >
              Archivieren
            </ActionButton>
          )}
          {/* Hard-Delete erst nach Karenz. Button nur sichtbar wenn:
              - Tenant ist archiviert
              - Karenz ist vorbei (karenz.active === false)
              UI zeigt sonst einen Banner mit Restzeit (siehe unten). */}
          {tenant.status === "archived" &&
            tenant.karenz &&
            !tenant.karenz.active && (
              <ActionButton
                onClick={() =>
                  setDeleteDialog({
                    typedSlug: "",
                    error: null,
                    pending: false,
                  })
                }
                disabled={actionBusy}
                variant="danger"
              >
                Endgültig löschen
              </ActionButton>
            )}
        </div>
      </div>

      {/* Karenz-Banner: zeigt sich nur bei archivierten Tenants. Wenn
          die 30 Tage noch laufen → "noch X Tage". Wenn vorbei →
          "Hard-Delete jetzt möglich". Macht klar in welchem Zustand
          der Tenant ist und was als naechstes passieren kann. */}
      {tenant.status === "archived" && tenant.karenz && (
        <div
          className={`rounded-md border px-4 py-3 mb-6 ${
            tenant.karenz.active
              ? "border-semantic-warning/30 bg-semantic-warning/8"
              : "border-semantic-danger/30 bg-semantic-danger/8"
          }`}
        >
          <div className="text-ui-sm text-ink-secondary">
            <span className="font-medium text-ink-primary">
              {tenant.karenz.active
                ? `Karenzfrist läuft — Hard-Delete in ${tenant.karenz.remainingDays} Tag${tenant.karenz.remainingDays === 1 ? "" : "en"} möglich`
                : "Karenzfrist abgelaufen — Hard-Delete jetzt möglich"}
            </span>
            <div className="text-ui-xs text-ink-tertiary mt-1">
              {tenant.karenz.active ? (
                <>
                  Archiviert am{" "}
                  {tenant.archivedAt
                    ? new Date(tenant.archivedAt).toLocaleDateString()
                    : "—"}
                  . Tenant kann während dieser Zeit seine Daten exportieren
                  (über das separate Export-Feature, sobald verfügbar). Hard-
                  Delete entfernt alle Daten + S3-Objekte irreversibel.
                </>
              ) : (
                <>
                  Du kannst den Tenant jetzt endgültig löschen. Alle Daten,
                  Galerien, Files und S3-Objekte werden entfernt — das ist
                  irreversibel.
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <Section title="Metadaten">
        {editingMeta ? (
          <EditMetaForm
            tenant={tenant}
            onSaved={async () => {
              setEditingMeta(false);
              await load();
            }}
            onCancel={() => setEditingMeta(false)}
          />
        ) : (
          <dl className="text-ui-sm grid grid-cols-[140px_1fr] gap-y-1.5">
            <Label>Slug</Label>
            <span className="font-mono">{tenant.slug}</span>
            <Label>Custom-Domain</Label>
            <span className="font-mono">{tenant.customDomain ?? "—"}</span>
            <Label>Galerien</Label>
            <span>{tenant.galleryCount}</span>
            <Label>Angelegt</Label>
            <span>{new Date(tenant.createdAt).toLocaleString("de-DE")}</span>
            <Label>Letztes Update</Label>
            <span>{new Date(tenant.updatedAt).toLocaleString("de-DE")}</span>
            {tenant.archivedAt && (
              <>
                <Label>Archiviert am</Label>
                <span>
                  {new Date(tenant.archivedAt).toLocaleString("de-DE")}
                </span>
              </>
            )}
          </dl>
        )}
        {!editingMeta && tenant.status !== "archived" && (
          <button
            type="button"
            onClick={() => setEditingMeta(true)}
            className="mt-3 text-ui-sm text-accent hover:text-accent-hover"
          >
            Bearbeiten
          </button>
        )}
      </Section>

      <Section
        title="User"
        action={
          tenant.status === "active" && (
            <button
              type="button"
              onClick={() => setInviting(true)}
              className="text-ui-sm text-accent hover:text-accent-hover"
            >
              + Owner einladen
            </button>
          )
        }
      >
        {tenant.users.length === 0 ? (
          <p className="text-ui-sm text-ink-tertiary">Keine User.</p>
        ) : (
          <ul className="divide-y divide-line-subtle">
            {tenant.users.map((u) => (
              <li key={u.id} className="py-2 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-ui text-ink-primary truncate">
                    {u.name ?? u.email}
                  </div>
                  <div className="text-ui-xs text-ink-tertiary truncate">
                    {u.email}
                  </div>
                </div>
                <div className="flex flex-col items-end text-ui-xs">
                  <span className="font-mono uppercase tracking-wide text-ink-tertiary">
                    {u.role}
                  </span>
                  <span
                    className={
                      u.status === "active"
                        ? "text-semantic-success"
                        : u.status === "invited"
                        ? "text-semantic-warning"
                        : "text-ink-tertiary"
                    }
                  >
                    {u.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {inviting && (
        <InviteOwnerDialog
          tenantId={tenant.id}
          tenantName={tenant.name}
          onClose={() => setInviting(false)}
          onInvited={async () => {
            setInviting(false);
            await load();
          }}
        />
      )}

      {/* Hard-Delete-Dialog: Slug muss exakt eingetippt werden bevor
          der Button aktiv wird. Schutz gegen "ich hab nicht aufgepasst,
          versehentlich auf Löschen geklickt". */}
      {deleteDialog && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !deleteDialog.pending && setDeleteDialog(null)}
        >
          <div
            className="bg-surface-base rounded-lg border border-line-subtle shadow-2xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-medium text-ink-primary">
              Tenant endgültig löschen?
            </h2>
            <div className="text-ui-sm text-ink-secondary mt-3 space-y-2">
              <p>
                Folgendes wird <span className="font-medium">irreversibel</span>{" "}
                entfernt:
              </p>
              <ul className="list-disc pl-5 space-y-0.5 text-ui-xs">
                <li>
                  Alle Galerien, Files und Renditions ({tenant.galleryCount}{" "}
                  Galerien)
                </li>
                <li>Alle User-Accounts dieses Tenants</li>
                <li>Alle S3-Objekte unter t/{tenant.id.slice(0, 8)}…/</li>
                <li>Branding, Templates, Webhooks, Tags</li>
                <li>Billing-Subscription (lokal — Stripe-Customer bleibt)</li>
              </ul>
              <p className="pt-2">
                Audit-Logs bleiben erhalten. Stripe-Customer bleibt im Stripe-
                Dashboard für die Buchhaltung.
              </p>
            </div>
            <div className="mt-4">
              <label className="text-ui-xs text-ink-secondary block mb-1.5">
                Tippe den Tenant-Slug{" "}
                <span className="font-mono text-ink-primary">{tenant.slug}</span>{" "}
                ein, um zu bestätigen:
              </label>
              <input
                type="text"
                value={deleteDialog.typedSlug}
                onChange={(e) =>
                  setDeleteDialog({
                    ...deleteDialog,
                    typedSlug: e.target.value,
                    error: null,
                  })
                }
                disabled={deleteDialog.pending}
                placeholder={tenant.slug}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className="w-full h-9 px-2.5 rounded bg-surface-sunken border border-line-subtle focus:border-accent text-ui font-mono text-ink-primary placeholder:text-ink-tertiary focus:outline-none transition-colors duration-motion disabled:opacity-50"
              />
            </div>
            {deleteDialog.error && (
              <p className="text-ui-sm text-semantic-danger mt-3">
                {deleteDialog.error}
              </p>
            )}
            <div className="flex gap-2 justify-end mt-5">
              <ActionButton
                onClick={() => setDeleteDialog(null)}
                disabled={deleteDialog.pending}
                variant="ghost"
              >
                Abbrechen
              </ActionButton>
              <ActionButton
                onClick={performHardDelete}
                disabled={
                  deleteDialog.pending ||
                  deleteDialog.typedSlug !== tenant.slug
                }
                variant="danger"
              >
                {deleteDialog.pending
                  ? "Lösche…"
                  : "Endgültig löschen"}
              </ActionButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
function StatusBadge({ status }: { status: SuperTenantDetail["status"] }) {
  const cls =
    status === "active"
      ? "bg-semantic-success/20 text-semantic-success border-semantic-success/40"
      : status === "suspended"
      ? "bg-semantic-warning/20 text-semantic-warning border-semantic-warning/40"
      : "bg-ink-tertiary/20 text-ink-tertiary border-ink-tertiary/40";
  const label =
    status === "active"
      ? "AKTIV"
      : status === "suspended"
      ? "SUSPENDIERT"
      : "ARCHIVIERT";
  return (
    <span
      className={`inline-block text-ui-xs uppercase tracking-wide px-2 py-0.5 rounded border ${cls}`}
    >
      {label}
    </span>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  variant,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant: "success" | "warning" | "danger" | "ghost";
}) {
  const cls =
    variant === "success"
      ? "border-semantic-success/40 text-semantic-success hover:bg-semantic-success/10"
      : variant === "warning"
      ? "border-semantic-warning/40 text-semantic-warning hover:bg-semantic-warning/10"
      : variant === "ghost"
      ? "border-line-subtle text-ink-secondary hover:bg-surface-sunken"
      : "border-semantic-danger/40 text-semantic-danger hover:bg-semantic-danger/10";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`h-8 px-3 rounded border text-ui-sm disabled:opacity-50 transition-colors duration-motion ${cls}`}
    >
      {children}
    </button>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6 rounded-md border border-line-subtle bg-surface-raised p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-ui-md font-medium text-ink-primary">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <dt className="text-ui-xs uppercase tracking-[0.12em] text-ink-tertiary self-center">
      {children}
    </dt>
  );
}

function EditMetaForm({
  tenant,
  onSaved,
  onCancel,
}: {
  tenant: SuperTenantDetail;
  onSaved: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const [slug, setSlug] = useState(tenant.slug);
  const [name, setName] = useState(tenant.name);
  const [customDomain, setCustomDomain] = useState(tenant.customDomain ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slugChanged = slug !== tenant.slug;

  async function save() {
    // Slug-Wechsel: explizite Bestätigung. Wenn der Operator OK drückt,
    // wissen wir, dass er die Konsequenzen für Subdomains/URLs kennt.
    if (slugChanged) {
      const ok = confirm(
        `Slug ändern von "${tenant.slug}" auf "${slug}"?\n\n` +
          `Das ändert die Subdomain-URL (z.B. https://${slug}.lumio-cloud.de) ` +
          `und alle Header-basierten API-Zugriffe für diesen Tenant. ` +
          `Bestehende Bookmarks unter dem alten Slug funktionieren NICHT mehr.\n\n` +
          `Galerie-Share-Links sind nicht betroffen — die nutzen den ` +
          `Galerie-Slug, nicht den Tenant-Slug.`
      );
      if (!ok) return;
    }

    setBusy(true);
    setError(null);
    try {
      await api.superUpdateTenant(tenant.id, {
        slug: slug.trim().toLowerCase(),
        name: name.trim(),
        customDomain: customDomain.trim() || null,
      });
      await onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Fehler";
      setError(
        msg.includes("slug_taken")
          ? "Dieser Slug ist schon vergeben."
          : msg.includes("domain_taken")
          ? "Custom-Domain belegt."
          : msg
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-ui-sm text-ink-secondary">Slug</span>
        <input
          type="text"
          value={slug}
          onChange={(e) =>
            setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
          }
          minLength={2}
          maxLength={40}
          className="mt-1 w-full h-9 px-2.5 rounded bg-surface-sunken border border-line-subtle text-ui text-ink-primary font-mono focus:border-accent focus:outline-none"
        />
        <span className="block mt-1 text-ui-xs text-ink-tertiary">
          Wird zur Subdomain. Kleinbuchstaben, Ziffern, Bindestriche.
          {slugChanged && (
            <span className="block mt-0.5 text-semantic-warning">
              ⚠ Ändern bricht bestehende Subdomain-URLs.
            </span>
          )}
        </span>
      </label>
      <label className="block">
        <span className="text-ui-sm text-ink-secondary">Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full h-9 px-2.5 rounded bg-surface-sunken border border-line-subtle text-ui text-ink-primary focus:border-accent focus:outline-none"
        />
      </label>
      <label className="block">
        <span className="text-ui-sm text-ink-secondary">Custom-Domain</span>
        <input
          type="text"
          value={customDomain}
          onChange={(e) => setCustomDomain(e.target.value.toLowerCase())}
          className="mt-1 w-full h-9 px-2.5 rounded bg-surface-sunken border border-line-subtle text-ui text-ink-primary font-mono focus:border-accent focus:outline-none"
        />
      </label>
      {error && <div className="text-ui-sm text-semantic-danger">{error}</div>}
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="h-8 px-3 rounded border border-line-strong text-ui-sm text-ink-secondary"
        >
          Abbrechen
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy || !name.trim() || slug.length < 2}
          className="h-8 px-3 rounded bg-accent text-accent-contrast text-ui-sm disabled:opacity-50"
        >
          {busy ? "Speichert…" : "Speichern"}
        </button>
      </div>
    </div>
  );
}
