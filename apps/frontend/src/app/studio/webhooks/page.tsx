"use client";

/**
 * Studio /studio/webhooks
 *
 * Übersicht aller Outbound-Webhooks dieses Tenants. Liste oben, darunter
 * ein Detail-Drawer für den gewählten Webhook (Edit + Delivery-Log +
 * Test-Button). Anlegen via Inline-Dialog — Secret wird einmalig
 * angezeigt und muss vom User notiert werden.
 *
 * Bewusst eine eigene Page, nicht im Settings-Panel — Webhooks haben
 * sicherheitskritische Aspekte (Secrets, externe URLs), die einen
 * separaten Raum verdienen. Außerdem braucht es Platz fürs Delivery-
 * Log, der unter den existierenden Settings nicht gut passt.
 */
import { useCallback, useEffect, useState } from "react";
import { api, type WebhookSummary, type WebhookDelivery } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { PageHeader } from "@/components/studio/PageHeader";
import { Button } from "@/components/ui";

export default function WebhooksPage() {
  const t = useT();
  const [webhooks, setWebhooks] = useState<WebhookSummary[]>([]);
  const [supportedEvents, setSupportedEvents] = useState<readonly string[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listWebhooks();
      setWebhooks(res.webhooks);
      setSupportedEvents(res.supportedEvents);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = webhooks.find((w) => w.id === selectedId) ?? null;

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "Studio", href: "/studio" },
          { label: t("studio.webhooksTitle") },
        ]}
        title={t("studio.webhooksTitle")}
        description={t("studio.webhooksDescription")}
        actions={
          <Button onClick={() => setCreating(true)}>
            {t("studio.webhookCreate")}
          </Button>
        }
      />

      <div className="px-6 sm:px-8 lg:px-12 py-6 max-w-5xl space-y-6">
        {loading ? (
          <div className="text-ui text-ink-tertiary">{t("common.loading")}</div>
        ) : webhooks.length === 0 ? (
          <div className="rounded-md border border-line-subtle bg-surface-raised p-8 text-center">
            <div className="text-ui text-ink-secondary mb-1">
              {t("studio.webhooksEmpty")}
            </div>
            <div className="text-ui-sm text-ink-tertiary">
              {t("studio.webhooksEmptyHint")}
            </div>
          </div>
        ) : (
          <ul className="space-y-2">
            {webhooks.map((w) => (
              <WebhookRow
                key={w.id}
                webhook={w}
                onSelect={() => setSelectedId(w.id)}
              />
            ))}
          </ul>
        )}

        {selected && (
          <WebhookDetail
            webhook={selected}
            supportedEvents={supportedEvents}
            onClose={() => setSelectedId(null)}
            onChanged={load}
          />
        )}

        {creating && (
          <CreateWebhookDialog
            supportedEvents={supportedEvents}
            onClose={() => setCreating(false)}
            onCreated={load}
          />
        )}
      </div>
    </>
  );
}

// -----------------------------------------------------------------------------
function WebhookRow({
  webhook,
  onSelect,
}: {
  webhook: WebhookSummary;
  onSelect: () => void;
}) {
  const t = useT();
  return (
    <li>
      <button
        onClick={onSelect}
        className="w-full text-left rounded-md border border-line-subtle bg-surface-raised hover:bg-surface-overlay transition-colors duration-motion p-4 flex items-center justify-between gap-4"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`block w-2 h-2 rounded-full flex-shrink-0 ${
                !webhook.active
                  ? "bg-ink-tertiary"
                  : webhook.lastDeliveryOk === false
                  ? "bg-semantic-danger"
                  : webhook.lastDeliveryOk === true
                  ? "bg-semantic-success"
                  : "bg-ink-tertiary"
              }`}
              aria-hidden
            />
            <span className="text-ui font-medium text-ink-primary truncate">
              {webhook.label}
            </span>
            {!webhook.active && (
              <span className="text-ui-xs uppercase tracking-wider px-1.5 py-0.5 rounded-xs bg-ink-tertiary/15 text-ink-tertiary">
                {t("studio.webhookInactive")}
              </span>
            )}
          </div>
          <div className="text-ui-xs text-ink-tertiary font-mono mt-1 truncate">
            {webhook.url}
          </div>
          <div className="text-ui-xs text-ink-tertiary mt-1">
            {webhook.events.join(" · ")}
          </div>
        </div>
        <div className="text-ui-xs text-ink-tertiary text-right flex-shrink-0">
          {webhook.lastDeliveryAt
            ? new Date(webhook.lastDeliveryAt).toLocaleString()
            : t("studio.webhookNeverDelivered")}
        </div>
      </button>
    </li>
  );
}

// -----------------------------------------------------------------------------
function WebhookDetail({
  webhook,
  supportedEvents,
  onClose,
  onChanged,
}: {
  webhook: WebhookSummary;
  supportedEvents: readonly string[];
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const t = useT();
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    httpStatus?: number;
    errorMessage?: string;
  } | null>(null);
  const [testing, setTesting] = useState(false);
  const [editing, setEditing] = useState(false);

  const loadDeliveries = useCallback(async () => {
    const res = await api.listWebhookDeliveries(webhook.id);
    setDeliveries(res.deliveries);
  }, [webhook.id]);

  useEffect(() => {
    void loadDeliveries();
  }, [loadDeliveries]);

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.testWebhook(webhook.id);
      setTestResult(res);
      await onChanged(); // lastDeliveryAt/Ok hat sich geändert
      await loadDeliveries();
    } finally {
      setTesting(false);
    }
  }

  async function toggleActive() {
    await api.updateWebhook(webhook.id, { active: !webhook.active });
    await onChanged();
  }

  async function remove() {
    if (!confirm(t("studio.webhookConfirmDelete", { label: webhook.label }))) {
      return;
    }
    await api.deleteWebhook(webhook.id);
    await onChanged();
    onClose();
  }

  return (
    <section className="rounded-md border border-line-subtle bg-surface-raised">
      <header className="px-5 py-4 border-b border-line-subtle flex items-center justify-between gap-3">
        <div>
          <div className="text-ui font-medium text-ink-primary">
            {webhook.label}
          </div>
          <div className="text-ui-xs text-ink-tertiary font-mono mt-0.5">
            {webhook.url}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="secondary" onClick={runTest} disabled={testing}>
            {testing ? t("studio.webhookTesting") : t("studio.webhookTest")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing((e) => !e)}>
            {editing ? t("common.cancel") : t("common.edit")}
          </Button>
          <Button size="sm" variant="ghost" onClick={toggleActive}>
            {webhook.active ? t("studio.webhookDeactivate") : t("studio.webhookActivate")}
          </Button>
          <Button size="sm" variant="danger" onClick={remove}>
            {t("common.delete")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            ✕
          </Button>
        </div>
      </header>

      {testResult && (
        <div
          className={`px-5 py-2.5 text-ui-sm border-b border-line-subtle ${
            testResult.ok
              ? "bg-semantic-success/10 text-semantic-success"
              : "bg-semantic-danger/10 text-semantic-danger"
          }`}
        >
          {testResult.ok
            ? t("studio.webhookTestOk", { status: testResult.httpStatus ?? "?" })
            : t("studio.webhookTestFailed", {
                detail:
                  testResult.errorMessage ??
                  (testResult.httpStatus
                    ? `HTTP ${testResult.httpStatus}`
                    : "unknown"),
              })}
        </div>
      )}

      {editing && (
        <EditWebhookForm
          webhook={webhook}
          supportedEvents={supportedEvents}
          onSaved={async () => {
            setEditing(false);
            await onChanged();
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      <div className="px-5 py-4">
        <div className="text-ui-sm font-medium text-ink-primary mb-2">
          {t("studio.webhookEvents")}
        </div>
        <div className="flex flex-wrap gap-1.5 mb-4">
          {webhook.events.map((e) => (
            <span
              key={e}
              className="text-ui-xs font-mono px-2 py-1 rounded-xs bg-surface-sunken border border-line-subtle text-ink-secondary"
            >
              {e}
            </span>
          ))}
        </div>

        <div className="text-ui-sm font-medium text-ink-primary mb-2 mt-4">
          {t("studio.webhookDeliveries")}
        </div>
        {deliveries.length === 0 ? (
          <div className="text-ui-sm text-ink-tertiary">
            {t("studio.webhookDeliveriesEmpty")}
          </div>
        ) : (
          <ul className="space-y-1">
            {deliveries.map((d) => (
              <li
                key={d.id}
                className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 px-2 py-1.5 rounded text-ui-xs hover:bg-surface-sunken"
              >
                <span
                  className={`block w-1.5 h-1.5 rounded-full ${
                    d.status === "sent"
                      ? "bg-semantic-success"
                      : d.status === "dead"
                      ? "bg-semantic-danger"
                      : d.status === "pending"
                      ? "bg-semantic-warning"
                      : "bg-ink-tertiary"
                  }`}
                />
                <span className="font-mono text-ink-secondary truncate">
                  {d.eventType}
                </span>
                <span className="text-ink-tertiary font-mono">
                  {d.httpStatus ?? "—"}
                </span>
                <span className="text-ink-tertiary">
                  {new Date(d.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
function EditWebhookForm({
  webhook,
  supportedEvents,
  onSaved,
  onCancel,
}: {
  webhook: WebhookSummary;
  supportedEvents: readonly string[];
  onSaved: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const t = useT();
  const [label, setLabel] = useState(webhook.label);
  const [url, setUrl] = useState(webhook.url);
  const [events, setEvents] = useState<string[]>(webhook.events);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setPending(true);
    setError(null);
    try {
      await api.updateWebhook(webhook.id, {
        label,
        url,
        events,
      });
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="px-5 py-4 border-b border-line-subtle bg-surface-sunken space-y-3">
      <LabeledInput label={t("studio.webhookLabel")} value={label} onChange={setLabel} />
      <LabeledInput label="URL" value={url} onChange={setUrl} placeholder="https://example.com/hook" mono />
      <EventsPicker
        supportedEvents={supportedEvents}
        selected={events}
        onChange={setEvents}
      />
      {error && <div className="text-ui-sm text-semantic-danger">{error}</div>}
      <div className="flex gap-2 justify-end pt-1">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          size="sm"
          onClick={save}
          disabled={pending || events.length === 0 || !label.trim() || !url.trim()}
        >
          {pending ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
function CreateWebhookDialog({
  supportedEvents,
  onClose,
  onCreated,
}: {
  supportedEvents: readonly string[];
  onClose: () => void;
  onCreated: () => Promise<void> | void;
}) {
  const t = useT();
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  async function create() {
    setPending(true);
    setError(null);
    try {
      const res = await api.createWebhook({ label, url, events });
      setCreatedSecret(res.secret);
      await onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
      <div className="w-full max-w-lg rounded-md border border-line-strong bg-surface-raised shadow-xl">
        <header className="px-5 py-4 border-b border-line-subtle">
          <div className="text-ui-lg font-medium text-ink-primary">
            {createdSecret ? t("studio.webhookCreatedTitle") : t("studio.webhookCreate")}
          </div>
        </header>

        {createdSecret ? (
          // Secret-Reveal: einmalige Anzeige. Wir können hier kein Re-Reveal
          // anbieten — das wäre ein Sicherheits-Antipattern. Bei Verlust:
          // neuer Webhook.
          <div className="px-5 py-4 space-y-3">
            <div className="text-ui-sm text-ink-secondary">
              {t("studio.webhookSecretIntro")}
            </div>
            <div className="text-ui-sm font-medium text-semantic-warning">
              {t("studio.webhookSecretWarning")}
            </div>
            <div className="font-mono text-ui-sm bg-surface-sunken border border-line-subtle rounded p-3 break-all select-all">
              {createdSecret}
            </div>
            <div className="flex justify-end pt-2">
              <Button size="sm" onClick={onClose}>
                {t("common.done")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="px-5 py-4 space-y-3">
              <LabeledInput
                label={t("studio.webhookLabel")}
                value={label}
                onChange={setLabel}
                placeholder={t("studio.webhookLabelPlaceholder")}
              />
              <LabeledInput
                label="URL"
                value={url}
                onChange={setUrl}
                placeholder="https://example.com/hook"
                mono
              />
              <EventsPicker
                supportedEvents={supportedEvents}
                selected={events}
                onChange={setEvents}
              />
              {error && (
                <div className="text-ui-sm text-semantic-danger">{error}</div>
              )}
            </div>
            <footer className="px-5 py-4 border-t border-line-subtle flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button
                size="sm"
                onClick={create}
                disabled={
                  pending ||
                  !label.trim() ||
                  !url.trim() ||
                  !url.startsWith("https://") ||
                  events.length === 0
                }
              >
                {pending ? t("common.saving") : t("studio.webhookCreate")}
              </Button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-ui-sm font-medium text-ink-primary block mb-1">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full h-9 px-2.5 rounded bg-surface-sunken border border-line-subtle hover:border-line-strong focus:border-accent text-ui text-ink-primary placeholder:text-ink-tertiary focus:outline-none transition-colors duration-motion ${
          mono ? "font-mono text-ui-sm" : ""
        }`}
      />
    </label>
  );
}

function EventsPicker({
  supportedEvents,
  selected,
  onChange,
}: {
  supportedEvents: readonly string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const t = useT();
  function toggle(e: string) {
    onChange(
      selected.includes(e) ? selected.filter((x) => x !== e) : [...selected, e]
    );
  }
  return (
    <div>
      <span className="text-ui-sm font-medium text-ink-primary block mb-1.5">
        {t("studio.webhookEvents")}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {supportedEvents.map((e) => {
          const on = selected.includes(e);
          return (
            <button
              key={e}
              type="button"
              onClick={() => toggle(e)}
              className={`text-ui-xs font-mono h-7 px-2 rounded-xs border transition-colors duration-motion ${
                on
                  ? "bg-accent text-accent-contrast border-accent"
                  : "bg-surface-raised border-line-subtle text-ink-secondary hover:border-line-strong"
              }`}
            >
              {e}
            </button>
          );
        })}
      </div>
    </div>
  );
}
