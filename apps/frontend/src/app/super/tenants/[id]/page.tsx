"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  api,
  type SuperTenantDetail,
  type SuperTenantSubscription,
} from "@/lib/api";
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

  // Export-Confirm + Status-Anzeige. Trigger des Tenant-Exports mit
  // Mail an alle Owner (bei archived Tenants).
  const [exportConfirm, setExportConfirm] = useState(false);
  const [exportResult, setExportResult] = useState<{
    exportId: string;
    itemCount: number;
    mailsSent: number;
    tokenIssued: boolean;
  } | null>(null);
  const [exportPending, setExportPending] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Schedule-Archive-Dialog: Date-Picker mit Default heute+30Tage.
  // Triggert /super/tenants/:id/schedule-archive.
  const [scheduleDialog, setScheduleDialog] = useState(false);
  const [schedulePending, setSchedulePending] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  // Vor-formatiertes Default-Datum (heute + 30 Tage, YYYY-MM-DD für
  // das <input type=date>) — useState mit Lazy-Init damit es bei
  // Re-Renders nicht jedes Mal neu berechnet wird.
  const [scheduleDate, setScheduleDate] = useState<string>(() => {
    const d = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  });
  const [scheduleResult, setScheduleResult] = useState<{
    mailsSent: number;
    ownersTotal: number;
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

  async function triggerExport() {
    if (!tenant) return;
    setExportPending(true);
    setExportError(null);
    try {
      const res = await api.superExportTenant(tenant.id);
      setExportResult(res);
      setExportConfirm(false);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setExportPending(false);
    }
  }

  async function performSchedule() {
    if (!tenant) return;
    setSchedulePending(true);
    setScheduleError(null);
    try {
      // <input type=date> liefert "YYYY-MM-DD" — wir setzen die Uhrzeit
      // auf 00:00:00 UTC für planbaren Vergleich. Wenn der Super-Admin
      // eine spezifische Uhrzeit will, braucht's einen DateTime-Picker
      // — aktuell zu viel UX-Aufwand für selten genutztes Feature.
      const scheduledAt = new Date(`${scheduleDate}T00:00:00.000Z`).toISOString();
      const res = await api.superScheduleArchive(tenant.id, { scheduledAt });
      setScheduleResult({
        mailsSent: res.mailsSent,
        ownersTotal: res.ownersTotal,
      });
      setScheduleDialog(false);
      await load();
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setSchedulePending(false);
    }
  }

  async function cancelSchedule() {
    if (!tenant) return;
    if (!confirm(`Geplante Archivierung für "${tenant.name}" zurückziehen?\n\nDer Tenant erhält keine automatische Benachrichtigung. Falls du ihn informieren willst, schreibe ihm direkt.`)) return;
    setActionBusy(true);
    try {
      await api.superCancelScheduledArchive(tenant.id);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Fehler");
    } finally {
      setActionBusy(false);
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
          {tenant.status === "active" && !tenant.archiveScheduledAt && (
            <ActionButton
              onClick={() => setScheduleDialog(true)}
              disabled={actionBusy}
              variant="warning"
            >
              Archive vorplanen
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

      {/* Schedule-Archive-Banner: zeigt sich bei aktiven Tenants mit
          archiveScheduledAt. Wenn Stichtag noch in der Zukunft → blau.
          Wenn Stichtag erreicht → rot mit "jetzt archivieren"-Hinweis. */}
      {tenant.status === "active" && tenant.archiveScheduledAt && (
        <ScheduledArchiveBanner
          scheduledAt={tenant.archiveScheduledAt}
          onCancel={cancelSchedule}
          onArchiveNow={archive}
          busy={actionBusy}
        />
      )}

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
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="text-ui-sm text-ink-secondary min-w-0 flex-1">
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
                    . Du kannst dem Tenant einen Datenexport-Link per Mail
                    zukommen lassen (Button rechts). Hard-Delete entfernt
                    danach alle Daten + S3-Objekte irreversibel.
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
            <div className="flex-shrink-0">
              <ActionButton
                onClick={() => setExportConfirm(true)}
                disabled={actionBusy}
                variant="ghost"
              >
                Datenexport anstoßen
              </ActionButton>
            </div>
          </div>
        </div>
      )}

      {/* Pending-Deletion-Banner: Tenant ist in der 60-Tage-Karenz fuer
          Self-Service-Loeschung. Hinweis + (verlinkter) Cancel im Dashboard. */}
      {tenant.status === "pending_deletion" &&
        tenant.selfDeletionScheduledFor && (
          <div className="rounded-md border border-semantic-warning/30 bg-semantic-warning/8 px-4 py-3 mb-6">
            <div className="text-ui-sm">
              <span className="font-medium text-ink-primary">
                Self-Service-Löschung läuft — Hard-Delete am{" "}
                {new Date(tenant.selfDeletionScheduledFor).toLocaleDateString(
                  "de-DE",
                  { day: "2-digit", month: "long", year: "numeric" }
                )}
              </span>
              <div className="text-ui-xs text-ink-tertiary mt-1">
                Owner kann sich bis dahin selbst zurücknehmen. Falls nicht,
                kannst du im Dashboard manuell canceln.
              </div>
            </div>
          </div>
        )}

      {tenant.subscription && (
        <Section title="Billing">
          <BillingBlock subscription={tenant.subscription} />
        </Section>
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
                {u.status === "active" && (
                  <PasswordResetButton tenantId={tenant.id} userId={u.id} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <NotesSection tenantId={tenant.id} />

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

      {/* Export-Confirm: bestaetigt den Aufruf. Bei archived Tenants
          weist der Text auf den Mail-Versand hin. */}
      {/* Schedule-Archive-Dialog. Datepicker + Erklärungstext. Default
          ist heute+30 Tage (im State-Init schon vorgefüllt). */}
      {scheduleDialog && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !schedulePending && setScheduleDialog(false)}
        >
          <div
            className="bg-surface-base rounded-lg border border-line-subtle shadow-2xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-medium text-ink-primary">
              Archivierung vorplanen
            </h2>
            <p className="text-ui-sm text-ink-secondary mt-3">
              Setzt einen Stichtag, an dem du den Tenant manuell archivieren
              wirst. Studio zeigt dem Tenant einen Countdown-Banner mit Link
              zum Datenexport. Wir schicken jetzt eine Initial-Mail und 7 Tage
              vor Stichtag eine Erinnerung an alle aktiven Owner.
            </p>
            <div className="mt-4">
              <label className="text-ui-xs text-ink-secondary block mb-1.5">
                Stichtag
              </label>
              <input
                type="date"
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
                disabled={schedulePending}
                className="w-full h-9 px-2.5 rounded bg-surface-sunken border border-line-subtle focus:border-accent text-ui text-ink-primary focus:outline-none transition-colors duration-motion disabled:opacity-50"
              />
            </div>
            {scheduleError && (
              <p className="text-ui-sm text-semantic-danger mt-3">
                {scheduleError}
              </p>
            )}
            <div className="flex gap-2 justify-end mt-5">
              <ActionButton
                onClick={() => setScheduleDialog(false)}
                disabled={schedulePending}
                variant="ghost"
              >
                Abbrechen
              </ActionButton>
              <ActionButton
                onClick={performSchedule}
                disabled={schedulePending || !scheduleDate}
                variant="warning"
              >
                {schedulePending ? "Plane…" : "Vorplanen + Mail senden"}
              </ActionButton>
            </div>
          </div>
        </div>
      )}

      {/* Schedule-Result: Bestätigung mit Mail-Status. */}
      {scheduleResult && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setScheduleResult(null)}
        >
          <div
            className="bg-surface-base rounded-lg border border-line-subtle shadow-2xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-medium text-ink-primary">
              Archivierung vorgeplant
            </h2>
            <p className="text-ui-sm text-ink-secondary mt-3">
              Initial-Benachrichtigung wurde an {scheduleResult.mailsSent} von{" "}
              {scheduleResult.ownersTotal} aktiven Owner verschickt. Eine
              Erinnerung folgt 7 Tage vor Stichtag.
            </p>
            <div className="flex gap-2 justify-end mt-5">
              <ActionButton
                onClick={() => setScheduleResult(null)}
                variant="ghost"
              >
                Schließen
              </ActionButton>
            </div>
          </div>
        </div>
      )}

      {exportConfirm && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !exportPending && setExportConfirm(false)}
        >
          <div
            className="bg-surface-base rounded-lg border border-line-subtle shadow-2xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-medium text-ink-primary">
              Datenexport anstoßen?
            </h2>
            <p className="text-ui-sm text-ink-secondary mt-3">
              Für alle {tenant.galleryCount} Galerien dieses Tenants wird je
              ein ZIP mit Originaldateien + Metadaten erstellt.
            </p>
            {tenant.status === "archived" && (
              <p className="text-ui-sm text-ink-secondary mt-2">
                Da der Tenant archiviert ist, wird ein Token-Link generiert
                und per Mail an alle aktiven Owner geschickt. Der Tenant kann
                ohne Login darauf zugreifen (30 Tage gültig).
              </p>
            )}
            {exportError && (
              <p className="text-ui-sm text-semantic-danger mt-3">
                {exportError}
              </p>
            )}
            <div className="flex gap-2 justify-end mt-5">
              <ActionButton
                onClick={() => setExportConfirm(false)}
                disabled={exportPending}
                variant="ghost"
              >
                Abbrechen
              </ActionButton>
              <ActionButton
                onClick={triggerExport}
                disabled={exportPending}
                variant="success"
              >
                {exportPending ? "Stoße an…" : "Export starten"}
              </ActionButton>
            </div>
          </div>
        </div>
      )}

      {/* Export-Result: nach erfolgreichem Trigger sieht der Admin
          eine Bestaetigung mit Detail-Link und ggf. Mail-Status. */}
      {exportResult && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setExportResult(null)}
        >
          <div
            className="bg-surface-base rounded-lg border border-line-subtle shadow-2xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-medium text-ink-primary">
              Export wurde gestartet
            </h2>
            <p className="text-ui-sm text-ink-secondary mt-3">
              {exportResult.itemCount}{" "}
              {exportResult.itemCount === 1 ? "ZIP wird" : "ZIPs werden"} im
              Hintergrund erstellt.
            </p>
            {exportResult.tokenIssued && (
              <p className="text-ui-sm text-ink-secondary mt-2">
                {exportResult.mailsSent > 0 ? (
                  <>
                    Mail mit Download-Link wurde an {exportResult.mailsSent}{" "}
                    Owner verschickt.
                  </>
                ) : (
                  <>
                    Token wurde erzeugt, aber keine aktiven Owner zum
                    Mailen vorhanden. Du findest den Link in den Audit-
                    Logs.
                  </>
                )}
              </p>
            )}
            <div className="flex gap-2 justify-end mt-5">
              <ActionButton
                onClick={() => setExportResult(null)}
                variant="ghost"
              >
                Schließen
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

// -----------------------------------------------------------------------------
// Schedule-Archive-Banner: zwei Modi je nachdem ob der Stichtag schon
// erreicht ist oder noch in der Zukunft liegt.
function ScheduledArchiveBanner({
  scheduledAt,
  onCancel,
  onArchiveNow,
  busy,
}: {
  scheduledAt: string;
  onCancel: () => void;
  onArchiveNow: () => void;
  busy: boolean;
}) {
  const date = new Date(scheduledAt);
  const remainingMs = date.getTime() - Date.now();
  const reached = remainingMs <= 0;
  const daysLeft = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
  return (
    <div
      className={`rounded-md border px-4 py-3 mb-6 ${
        reached
          ? "border-semantic-danger/30 bg-semantic-danger/8"
          : "border-semantic-warning/30 bg-semantic-warning/8"
      }`}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="text-ui-sm text-ink-secondary min-w-0 flex-1">
          <span className="font-medium text-ink-primary">
            {reached
              ? `Stichtag erreicht — Archivierung steht aus`
              : `Archivierung geplant für ${date.toLocaleDateString("de-DE")} (in ${daysLeft} Tag${daysLeft === 1 ? "" : "en"})`}
          </span>
          <div className="text-ui-xs text-ink-tertiary mt-1">
            {reached ? (
              <>
                Der geplante Termin ist verstrichen. Klicke „Jetzt archivieren",
                um die Archivierung manuell auszulösen (Stripe-Cancel + 30 Tage
                Karenz starten). Solange du nichts tust, kann der Tenant
                weiter arbeiten.
              </>
            ) : (
              <>
                Tenant hat eine Initial-Mail erhalten. 7 Tage vor Stichtag folgt
                automatisch eine Erinnerung. Im Studio sieht der Tenant einen
                Countdown-Banner mit Link zum Datenexport.
              </>
            )}
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {reached && (
            <button
              type="button"
              onClick={onArchiveNow}
              disabled={busy}
              className="h-8 px-3 rounded border text-ui-sm disabled:opacity-50 transition-colors duration-motion border-semantic-danger/40 text-semantic-danger hover:bg-semantic-danger/10"
            >
              Jetzt archivieren
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-8 px-3 rounded border text-ui-sm disabled:opacity-50 transition-colors duration-motion border-line-subtle text-ink-secondary hover:bg-surface-sunken"
          >
            Plan zurückziehen
          </button>
        </div>
      </div>
    </div>
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
  const [displayName, setDisplayName] = useState(tenant.displayName ?? "");
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
        displayName: displayName.trim() || null,
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
        <span className="text-ui-sm text-ink-secondary">Name (intern)</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full h-9 px-2.5 rounded bg-surface-sunken border border-line-subtle text-ui text-ink-primary focus:border-accent focus:outline-none"
        />
      </label>
      <label className="block">
        <span className="text-ui-sm text-ink-secondary">
          Öffentlicher Anzeigename
        </span>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={120}
          placeholder={`Leer = ${name || tenant.name}`}
          className="mt-1 w-full h-9 px-2.5 rounded bg-surface-sunken border border-line-subtle text-ui text-ink-primary focus:border-accent focus:outline-none"
        />
        <span className="block mt-1 text-ui-xs text-ink-tertiary">
          Sichtbar im Login, in E-Mails an Kunden. Owner kann das auch
          selbst im Studio ändern.
        </span>
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

// ---------------------------------------------------------------------------
// Billing-Block
// ---------------------------------------------------------------------------
// Stripe-Subscription-Uebersicht im Tenant-Detail. Ziel: typische
// Support-Fragen ohne Tab-Wechsel zu Stripe beantworten koennen.
//
// Gezeigt:
//  - Plan + monatlicher/jaehrlicher Preis
//  - Status (mit Farbcoding bei past_due/unpaid)
//  - Trial-Ende, sofern noch im Trial
//  - Aktuelle Periode + cancelAtPeriodEnd-Hinweis
//  - Storage-Auslastung mit Progress-Bar gegen Plan-Limit
//  - Galerie-Zaehlung
//  - Read-Only-Flag falls eskaliert
//  - Deep-Links zum Stripe-Dashboard (Customer + Subscription)
function BillingBlock({
  subscription,
}: {
  subscription: SuperTenantSubscription;
}) {
  const plan = subscription.plan;

  const price = (() => {
    if (subscription.billingInterval === "yearly" && plan.priceYearlyCents !== null) {
      return formatPrice(plan.priceYearlyCents, plan.currency) + " / Jahr";
    }
    if (plan.priceMonthlyCents !== null) {
      return formatPrice(plan.priceMonthlyCents, plan.currency) + " / Monat";
    }
    return null;
  })();

  const storageGib = subscription.storageBytesUsed / (1024 ** 3);
  const totalStorageGib =
    plan.storageGib !== null
      ? plan.storageGib + subscription.storageAddonGib
      : null;
  const storagePct =
    totalStorageGib && totalStorageGib > 0
      ? Math.min(100, (storageGib / totalStorageGib) * 100)
      : null;

  // Stripe-Dashboard-Links. Wir koennen nicht zwischen Live/Test
  // unterscheiden ohne extra Config, also default auf Live — der
  // Super-Admin sieht im Stripe-Dashboard selbst ob er im richtigen
  // Mode ist. Acceptance-Test reicht.
  const stripeCustomerUrl = subscription.stripeCustomerId
    ? `https://dashboard.stripe.com/customers/${subscription.stripeCustomerId}`
    : null;
  const stripeSubUrl = subscription.stripeSubscriptionId
    ? `https://dashboard.stripe.com/subscriptions/${subscription.stripeSubscriptionId}`
    : null;

  return (
    <div className="space-y-4">
      {/* Status-Warnungen prominent oben */}
      {(subscription.status === "past_due" ||
        subscription.status === "unpaid" ||
        subscription.status === "incomplete" ||
        subscription.status === "incomplete_expired") && (
        <div className="rounded-md border border-semantic-danger/30 bg-semantic-danger/8 px-3 py-2 text-ui-sm">
          <span className="font-medium text-semantic-danger">
            Zahlungsproblem: {subscription.status}
          </span>
          {subscription.readOnlySince && (
            <span className="text-ink-tertiary">
              {" "}
              · Read-Only seit{" "}
              {new Date(subscription.readOnlySince).toLocaleDateString(
                "de-DE"
              )}
            </span>
          )}
        </div>
      )}

      {subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd && (
        <div className="rounded-md border border-semantic-warning/30 bg-semantic-warning/8 px-3 py-2 text-ui-sm">
          <span className="font-medium">Gekündigt zum </span>
          {new Date(subscription.currentPeriodEnd).toLocaleDateString("de-DE")}{" "}
          — danach automatisch beendet.
        </div>
      )}

      <dl className="text-ui-sm grid grid-cols-[140px_1fr] gap-y-1.5">
        <Label>Plan</Label>
        <span>
          {plan.name} <span className="text-ink-tertiary">({plan.slug})</span>
        </span>

        <Label>Preis</Label>
        <span>{price ?? <span className="text-ink-tertiary">—</span>}</span>

        <Label>Status</Label>
        <span>
          <SubscriptionStatusBadge status={subscription.status} />
        </span>

        <Label>Billing</Label>
        <span>
          {subscription.billingInterval === "yearly" ? "Jährlich" : "Monatlich"}
        </span>

        {subscription.status === "trialing" && subscription.trialEndsAt && (
          <>
            <Label>Trial-Ende</Label>
            <span>
              {new Date(subscription.trialEndsAt).toLocaleDateString("de-DE", {
                day: "2-digit",
                month: "long",
                year: "numeric",
              })}{" "}
              <span className="text-ink-tertiary">
                ({daysUntil(subscription.trialEndsAt)})
              </span>
            </span>
          </>
        )}

        {subscription.currentPeriodStart && subscription.currentPeriodEnd && (
          <>
            <Label>Aktuelle Periode</Label>
            <span>
              {new Date(
                subscription.currentPeriodStart
              ).toLocaleDateString("de-DE")}
              {" – "}
              {new Date(
                subscription.currentPeriodEnd
              ).toLocaleDateString("de-DE")}
            </span>
          </>
        )}

        <Label>Speicher</Label>
        <span>
          {storageGib.toFixed(2)} GiB
          {totalStorageGib !== null && ` von ${totalStorageGib} GiB`}
          {subscription.storageAddonGib > 0 &&
            ` (${plan.storageGib} Plan + ${subscription.storageAddonGib} Add-On)`}
          {storagePct !== null && (
            <div className="h-1.5 bg-surface-sunken rounded mt-1 overflow-hidden">
              <div
                className={
                  "h-full " +
                  (storagePct >= 95
                    ? "bg-semantic-danger"
                    : storagePct >= 80
                      ? "bg-semantic-warning"
                      : "bg-accent")
                }
                style={{ width: `${storagePct}%` }}
              />
            </div>
          )}
        </span>

        <Label>Galerien</Label>
        <span>
          {subscription.galleriesCount}
          {plan.galleriesMax !== null && ` von ${plan.galleriesMax}`}
        </span>
      </dl>

      {(stripeCustomerUrl || stripeSubUrl) && (
        <div className="pt-3 border-t border-line-subtle flex gap-3 text-ui-sm">
          {stripeCustomerUrl && (
            <a
              href={stripeCustomerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:text-accent-hover"
            >
              ↗ Customer in Stripe
            </a>
          )}
          {stripeSubUrl && (
            <a
              href={stripeSubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:text-accent-hover"
            >
              ↗ Subscription in Stripe
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function SubscriptionStatusBadge({ status }: { status: string }) {
  const tone = (() => {
    switch (status) {
      case "active":
        return "bg-semantic-success/15 text-semantic-success";
      case "trialing":
        return "bg-accent/15 text-accent";
      case "past_due":
      case "unpaid":
      case "incomplete":
      case "incomplete_expired":
        return "bg-semantic-danger/15 text-semantic-danger";
      case "canceled":
        return "bg-surface-sunken text-ink-tertiary";
      default:
        return "bg-surface-sunken text-ink-secondary";
    }
  })();
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-ui-xs font-medium ${tone}`}
    >
      {status}
    </span>
  );
}

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function daysUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
  if (days < 0) return "abgelaufen";
  if (days === 0) return "heute";
  if (days === 1) return "morgen";
  return `in ${days} Tagen`;
}

// ---------------------------------------------------------------------------
// Notes-Section
// ---------------------------------------------------------------------------
// Interne Stichpunkte des Super-Admin pro Tenant. NIEMALS im Studio
// sichtbar. Append-only Timeline plus Delete-per-Entry. Bewusst keine
// Edits — eine Note ist ein Zeitpunkts-Snapshot ("hat heute angerufen").
// Wenn der User nachjustieren will, schreibt er eine neue Note.
function NotesSection({ tenantId }: { tenantId: string }) {
  type Note = Awaited<
    ReturnType<typeof api.superListTenantNotes>
  >["notes"][number];

  const [notes, setNotes] = useState<Note[] | null>(null);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .superListTenantNotes(tenantId)
      .then((r) => setNotes(r.notes))
      .catch(() => setNotes([]));
  }, [tenantId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.superCreateTenantNote(tenantId, body.trim());
      setNotes((curr) => [res.note, ...(curr ?? [])]);
      setBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteNote(noteId: string) {
    if (confirmingDeleteId !== noteId) {
      setConfirmingDeleteId(noteId);
      setTimeout(
        () =>
          setConfirmingDeleteId((curr) => (curr === noteId ? null : curr)),
        4000
      );
      return;
    }
    setConfirmingDeleteId(null);
    try {
      await api.superDeleteTenantNote(tenantId, noteId);
      setNotes((curr) => (curr ?? []).filter((n) => n.id !== noteId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Löschen");
    }
  }

  return (
    <Section title="Interne Notizen">
      <form onSubmit={submit} className="mb-4">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="z.B. Hat am 28.5. wegen Trial-Verlängerung angerufen — 7 Tage zusätzlich verprochen."
          className="w-full rounded-md border border-line-subtle px-3 py-2 text-ui-sm bg-surface-base"
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-ui-xs text-ink-tertiary">
            Nur für dich sichtbar. Tenant sieht das nie.
          </span>
          <button
            type="submit"
            disabled={!body.trim() || submitting}
            className="h-8 px-3 rounded bg-accent text-accent-contrast text-ui-sm disabled:opacity-50"
          >
            {submitting ? "Speichert…" : "Notiz hinzufügen"}
          </button>
        </div>
        {error && (
          <div className="mt-2 text-ui-xs text-semantic-danger">{error}</div>
        )}
      </form>

      {notes === null ? (
        <div className="text-ui-sm text-ink-tertiary">Lädt…</div>
      ) : notes.length === 0 ? (
        <div className="text-ui-sm text-ink-tertiary italic">
          Noch keine Notizen.
        </div>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li
              key={n.id}
              className="rounded-md border border-line-subtle bg-surface-base px-3 py-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-ui-sm whitespace-pre-wrap min-w-0">
                  {n.body}
                </div>
                <button
                  onClick={() => deleteNote(n.id)}
                  className={
                    confirmingDeleteId === n.id
                      ? "text-ui-xs text-semantic-danger font-medium shrink-0"
                      : "text-ui-xs text-ink-tertiary hover:text-semantic-danger shrink-0"
                  }
                >
                  {confirmingDeleteId === n.id ? "Sicher?" : "Löschen"}
                </button>
              </div>
              <div className="text-ui-xs text-ink-tertiary mt-1">
                {n.authorName ?? n.authorEmail} ·{" "}
                {new Date(n.createdAt).toLocaleString("de-DE", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Password-Reset-Button (pro User in der User-Liste)
// ---------------------------------------------------------------------------
// Zwei-Klick-Confirm. Nach erfolgreichem Trigger wird der Reset-Link
// kurz angezeigt mit Copy-Button, damit der Support ihn notfalls am
// Telefon durchgeben kann.
function PasswordResetButton({
  tenantId,
  userId,
}: {
  tenantId: string;
  userId: string;
}) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "confirming" }
    | { kind: "submitting" }
    | { kind: "done"; resetUrl: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [copied, setCopied] = useState(false);

  async function onClick() {
    if (state.kind === "idle") {
      setState({ kind: "confirming" });
      setTimeout(() => {
        setState((curr) =>
          curr.kind === "confirming" ? { kind: "idle" } : curr
        );
      }, 4000);
      return;
    }
    if (state.kind !== "confirming") return;

    setState({ kind: "submitting" });
    try {
      const res = await api.superTriggerPasswordReset(tenantId, userId);
      setState({ kind: "done", resetUrl: res.resetUrl });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Fehler",
      });
    }
  }

  async function copy() {
    if (state.kind !== "done") return;
    try {
      await navigator.clipboard.writeText(state.resetUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Wenn clipboard fehlschlaegt: User sieht den Link ohnehin und
      // kann ihn manuell markieren+kopieren.
    }
  }

  if (state.kind === "done") {
    return (
      <div className="flex flex-col items-end gap-1 max-w-[260px]">
        <div className="text-ui-xs text-semantic-success">
          Reset-Mail verschickt
        </div>
        <div className="text-ui-xs text-ink-tertiary truncate w-full text-right font-mono">
          {state.resetUrl}
        </div>
        <button
          type="button"
          onClick={copy}
          className="text-ui-xs text-accent hover:underline"
        >
          {copied ? "Kopiert ✓" : "Link kopieren"}
        </button>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="text-ui-xs text-semantic-danger max-w-[200px] text-right">
        {state.message}
        <button
          type="button"
          onClick={() => setState({ kind: "idle" })}
          className="block ml-auto text-ui-xs text-ink-tertiary hover:underline mt-0.5"
        >
          Erneut versuchen
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state.kind === "submitting"}
      className={
        state.kind === "confirming"
          ? "text-ui-xs px-2 py-1 rounded border border-semantic-warning text-semantic-warning font-medium whitespace-nowrap"
          : "text-ui-xs px-2 py-1 rounded border border-line-subtle hover:bg-surface-sunken whitespace-nowrap"
      }
    >
      {state.kind === "submitting"
        ? "Sendet…"
        : state.kind === "confirming"
          ? "Sicher? Nochmal klicken"
          : "Passwort-Reset"}
    </button>
  );
}
