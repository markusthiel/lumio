"use client";

/**
 * Lumio Studio — Print-Anbieter-Verwaltung
 *
 * Liste zweigeteilt:
 *   1. AKTIVIERTE Anbieter (vom Tenant aktiv genutzt): mit Credentials,
 *      Default-Toggle, Loeschen.
 *   2. VERFÜGBARE Anbieter (Super-Admin-aktiv, vom Tenant noch nicht
 *      eingerichtet): mit 'Anbinden'-Button der ein Credentials-Dialog
 *      oeffnet.
 *
 * Self-Print ist immer in der 'verfuegbar'-Liste — kein Credentials-
 * Dialog, einfacher Aktivierungs-Button.
 *
 * Credentials werden NICHT clientseitig zwischengespeichert oder
 * angezeigt. hasCredentials ist nur ein Boolean-Flag im UI.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Input } from "@/components/ui";
import { useT } from "@/lib/i18n";

type Available = Awaited<
  ReturnType<typeof api.listAvailablePrintProviders>
>["providers"][number];
type Mine = Awaited<
  ReturnType<typeof api.listTenantPrintProviders>
>["providers"][number];

export default function PrintProvidersPage() {
  const t = useT();
  const [available, setAvailable] = useState<Available[] | null>(null);
  const [mine, setMine] = useState<Mine[] | null>(null);
  const [message, setMessage] = useState<
    { kind: "success" | "danger"; text: string } | null
  >(null);
  const [setupProvider, setSetupProvider] = useState<Available | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [av, my] = await Promise.all([
        api.listAvailablePrintProviders(),
        api.listTenantPrintProviders(),
      ]);
      setAvailable(av.providers);
      setMine(my.providers);
    } catch (err) {
      setMessage({
        kind: "danger",
        text: err instanceof Error ? err.message : t("common.error"),
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!available || !mine) {
    return <div className="text-sm text-ink-tertiary">Lädt…</div>;
  }

  const mineKeys = new Set(mine.map((p) => p.providerKey));
  const availableNotInUse = available.filter((p) => !mineKeys.has(p.key));

  async function setDefault(key: string) {
    setBusy(true);
    try {
      await api.setTenantPrintProvider(key, { isDefault: true });
      await load();
      setMessage({ kind: "success", text: t("providers.defaultSet") });
    } catch (err) {
      setMessage({
        kind: "danger",
        text: err instanceof Error ? err.message : t("common.error"),
      });
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(p: Mine) {
    setBusy(true);
    try {
      await api.setTenantPrintProvider(p.providerKey, { enabled: !p.enabled });
      await load();
    } catch (err) {
      setMessage({
        kind: "danger",
        text: err instanceof Error ? err.message : t("common.error"),
      });
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Mine) {
    if (
      !confirm(
        t("providers.confirmRemove", { name: p.providerLabel })
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await api.deleteTenantPrintProvider(p.providerKey);
      await load();
      setMessage({ kind: "success", text: t("providers.removed") });
    } catch (err) {
      setMessage({
        kind: "danger",
        text: err instanceof Error ? err.message : t("common.error"),
      });
    } finally {
      setBusy(false);
    }
  }

  async function activateSelfPrint() {
    setBusy(true);
    try {
      await api.setTenantPrintProvider("manual_self_print", {
        enabled: true,
      });
      await load();
      setMessage({
        kind: "success",
        text: t("providers.selfPrintEnabled"),
      });
    } catch (err) {
      setMessage({
        kind: "danger",
        text: err instanceof Error ? err.message : t("common.error"),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {message && (
        <div
          className={
            message.kind === "success"
              ? "rounded-md border border-semantic-success/30 bg-semantic-success/8 px-3 py-2 text-sm text-semantic-success"
              : "rounded-md border border-semantic-danger/30 bg-semantic-danger/8 px-3 py-2 text-sm text-semantic-danger"
          }
        >
          {message.text}
        </div>
      )}

      {/* Aktivierte */}
      <section>
        <h2 className="text-base font-semibold mb-2">{t("providers.myProviders")}</h2>
        {mine.length === 0 ? (
          <div className="rounded-md border border-line-subtle bg-surface-raised px-4 py-6 text-sm text-ink-tertiary text-center">{t("providers.noneActive")}</div>
        ) : (
          <ul className="space-y-2">
            {mine.map((p) => (
              <li
                key={p.id}
                className="rounded-md border border-line-subtle bg-surface-raised p-3 flex items-start gap-3 flex-wrap"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <strong className="text-sm">{p.providerLabel}</strong>
                    {p.isDefault && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-accent/15 text-accent">{t("providers.defaultBadge")}</span>
                    )}
                    {!p.enabled && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-surface-sunken text-ink-tertiary">{t("providers.inactive")}</span>
                    )}
                  </div>
                  {p.displayName && (
                    <div className="text-xs text-ink-secondary">
                      {p.displayName}
                    </div>
                  )}
                  <div className="text-xs text-ink-tertiary mt-0.5">
                    {p.hasCredentials
                      ? t("providers.credsSet")
                      : p.providerKey === "manual_self_print"
                        ? t("providers.selfPrintNoCreds")
                        : t("providers.noCreds")}
                  </div>
                </div>
                <div className="flex gap-1 flex-wrap">
                  {!p.isDefault && p.enabled && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setDefault(p.providerKey)}
                      disabled={busy}
                    >{t("providers.makeDefault")}</Button>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => toggleEnabled(p)}
                    disabled={busy}
                  >
                    {p.enabled ? t("providers.disable") : t("providers.enable")}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => remove(p)}
                    disabled={busy}
                  >{t("providers.removeBtn")}</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Verfügbare */}
      {availableNotInUse.length > 0 && (
        <section>
          <h2 className="text-base font-semibold mb-2">{t("providers.availableProviders")}</h2>
          <ul className="space-y-2">
            {availableNotInUse.map((p) => (
              <li
                key={p.key}
                className="rounded-md border border-line-subtle bg-surface-raised p-3 flex items-start gap-3 flex-wrap"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <strong className="text-sm">{p.label}</strong>
                    <StageBadge stage={p.stage} />
                    <span className="text-xs text-ink-tertiary">
                      {p.market}
                    </span>
                  </div>
                  <div className="text-xs text-ink-secondary mb-1">
                    {p.tagline}
                  </div>
                  {p.websiteUrl && (
                    <div className="text-xs text-ink-tertiary">
                      <a
                        href={p.websiteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline"
                      >{t("providers.website")}</a>
                      {p.apiKeyHelpUrl && (
                        <>
                          {" · "}
                          <a
                            href={p.apiKeyHelpUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent hover:underline"
                          >{t("providers.apiSetup")}</a>
                        </>
                      )}
                    </div>
                  )}
                </div>
                {p.key === "manual_self_print" ? (
                  <Button
                    size="sm"
                    onClick={activateSelfPrint}
                    disabled={busy}
                  >{t("providers.enable")}</Button>
                ) : p.credentialFields.length === 0 ? (
                  <Button
                    size="sm"
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api.setTenantPrintProvider(p.key, {
                          enabled: true,
                        });
                        await load();
                      } finally {
                        setBusy(false);
                      }
                    }}
                    disabled={busy}
                  >{t("providers.enable")}</Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => setSetupProvider(p)}
                    disabled={busy}
                  >{t("providers.connect")}</Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Credentials-Dialog */}
      {setupProvider && (
        <CredentialsDialog
          provider={setupProvider}
          onClose={() => setSetupProvider(null)}
          onSaved={async () => {
            setSetupProvider(null);
            await load();
            setMessage({
              kind: "success",
              text: t("providers.connected"),
            });
          }}
        />
      )}
    </div>
  );
}

function StageBadge({
  stage,
}: {
  stage: Available["stage"];
}) {
  const t = useT();
  if (stage === "production") {
    return (
      <span className="text-xs px-1.5 py-0.5 rounded bg-semantic-success/15 text-semantic-success">{t("providers.stageProduction")}</span>
    );
  }
  if (stage === "beta") {
    return (
      <span className="text-xs px-1.5 py-0.5 rounded bg-accent/15 text-accent">{t("providers.stageBeta")}</span>
    );
  }
  if (stage === "planned") {
    return (
      <span className="text-xs px-1.5 py-0.5 rounded bg-semantic-warning/15 text-semantic-warning">{t("providers.stagePlanned")}</span>
    );
  }
  return null;
}

function CredentialsDialog({
  provider,
  onClose,
  onSaved,
}: {
  provider: Available;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [values, setValues] = useState<Record<string, string>>({});
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // Required-Check clientseitig (Backend prueft nochmal)
      for (const f of provider.credentialFields) {
        if (f.required && !values[f.key]?.trim()) {
          setError(t("providers.fieldRequired", { field: f.label }));
          setSaving(false);
          return;
        }
      }
      await api.setTenantPrintProvider(provider.key, {
        enabled: true,
        displayName: displayName.trim() || null,
        credentials: values,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-surface-raised rounded-md border border-line-subtle p-5 max-w-md w-full max-h-[85vh] overflow-y-auto">
        <h3 className="text-lg font-semibold mb-1">
          {t("providers.connectTitle", { name: provider.label })}
        </h3>
        <p className="text-xs text-ink-tertiary mb-4">
          {provider.tagline}
        </p>

        {provider.stage === "planned" && (
          <div className="rounded border border-semantic-warning/30 bg-semantic-warning/8 px-2 py-1.5 mb-3 text-xs text-semantic-warning">
            {t("providers.plannedWarning")}
          </div>
        )}

        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="block text-xs text-ink-tertiary mb-1">{t("providers.displayName")}</span>
            <Input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t("providers.displayNamePlaceholder", { name: provider.label })}
            />
          </label>

          {provider.credentialFields.map((f) => (
            <label key={f.key} className="block">
              <span className="block text-xs text-ink-tertiary mb-1">
                {f.label} {f.required && <span className="text-semantic-danger">*</span>}
              </span>
              <Input
                type={f.kind === "password" ? "password" : "text"}
                value={values[f.key] ?? ""}
                onChange={(e) =>
                  setValues({ ...values, [f.key]: e.target.value })
                }
                required={f.required}
                autoComplete="off"
              />
              {f.helpText && (
                <span className="block text-xs text-ink-tertiary mt-0.5">
                  {f.helpText}
                </span>
              )}
            </label>
          ))}

          {error && (
            <div className="rounded border border-semantic-danger/30 bg-semantic-danger/8 px-2 py-1.5 text-xs text-semantic-danger">
              {error}
            </div>
          )}

          <div className="flex gap-2 justify-end pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={saving}
            >{t("common.cancel")}</Button>
            <Button type="submit" disabled={saving}>{t("providers.connect")}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
