"use client";

/**
 * Lumio Studio — Print-Shop-Einstellungen
 *
 * Tenant-weite Konfiguration:
 *   - Master-Schalter 'enabled'
 *   - Studio-Anzeigename + Support-Mail (fuer Endkunden-Mails)
 *   - MwSt-Modus (inclusive/exclusive) + Default-Satz
 *   - Waehrung
 *   - AGB-URL + Privacy-URL (Pflicht in DE wenn Online-Verkauf)
 *   - Stripe-Connect-Setup
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Button, Input, Select } from "@/components/ui";

type Config = Awaited<ReturnType<typeof api.getPrintShopConfig>>["config"];
type Connect = Awaited<
  ReturnType<typeof api.getPrintShopConfig>
>["stripeConnect"];

// useSearchParams() (siehe Inner-Komponente) erzwingt Client-Side-
// Rendering. Ohne diese Direktive versucht Next.js die Page beim
// 'npm run build' statisch zu prerendern und scheitert mit
// 'should be wrapped in a suspense boundary'.
export const dynamic = "force-dynamic";

export default function PrintShopSettingsPage() {
  const t = useT();
  return (
    <Suspense fallback={<div className="text-sm text-ink-tertiary">{t("common.loading")}</div>}>
      <SettingsInner />
    </Suspense>
  );
}

function SettingsInner() {
  const t = useT();
  const params = useSearchParams();
  const [config, setConfig] = useState<Config | null>(null);
  const [connect, setConnect] = useState<Connect | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<
    { kind: "success" | "danger"; text: string } | null
  >(null);

  const load = useCallback(async () => {
    try {
      const r = await api.getPrintShopConfig();
      setConfig(r.config);
      setConnect(r.stripeConnect);
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

  // Wenn ?stripe_return=1 in URL: nach Stripe-Onboarding-Rueckkehr
  // automatisch syncen.
  useEffect(() => {
    if (params?.get("stripe_return") !== "1") return;
    (async () => {
      try {
        const r = await api.refreshStripeConnect();
        setConnect(r.stripeConnect);
        setMessage({
          kind: "success",
          text: r.stripeConnect.ready
            ? "Stripe-Connect ist startklar — du kannst Online-Bestellungen empfangen."
            : t("printSettings.onboardingIncomplete"),
        });
        // URL aufraeumen
        if (typeof window !== "undefined") {
          window.history.replaceState(
            {},
            "",
            "/studio/print-shop/settings"
          );
        }
      } catch (err) {
        setMessage({
          kind: "danger",
          text: err instanceof Error ? err.message : t("printSettings.syncFailed"),
        });
      }
    })();
  }, [params]);

  async function save(patch: Partial<Config>) {
    setSaving(true);
    setMessage(null);
    try {
      await api.updatePrintShopConfig(patch);
      await load();
      setMessage({ kind: "success", text: t("printSettings.saved") });
    } catch (err) {
      setMessage({
        kind: "danger",
        text: err instanceof Error ? err.message : t("printSettings.saveFailed"),
      });
    } finally {
      setSaving(false);
    }
  }

  async function startConnect() {
    setSaving(true);
    setMessage(null);
    try {
      const r = await api.startStripeConnectOnboarding();
      window.location.href = r.onboardingUrl;
    } catch (err) {
      setMessage({
        kind: "danger",
        text: err instanceof Error ? err.message : t("printSettings.onboardingError"),
      });
      setSaving(false);
    }
  }

  async function refreshConnect() {
    setSaving(true);
    try {
      const r = await api.refreshStripeConnect();
      setConnect(r.stripeConnect);
      setMessage({ kind: "success", text: t("printSettings.statusUpdated") });
    } catch (err) {
      setMessage({
        kind: "danger",
        text: err instanceof Error ? err.message : t("common.error"),
      });
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    if (
      !confirm(
        "Stripe-Connect-Account wirklich trennen? Du kannst danach keine Online-Bestellungen mehr empfangen."
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      await api.disconnectStripeConnect();
      await load();
      setMessage({ kind: "success", text: t("printSettings.disconnected") });
    } catch (err) {
      setMessage({
        kind: "danger",
        text: err instanceof Error ? err.message : t("common.error"),
      });
    } finally {
      setSaving(false);
    }
  }

  if (!config) {
    return <div className="text-sm text-ink-tertiary">{t("common.loading")}</div>;
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

      {!config.featureFlagEnabled && (
        <div className="rounded-md border border-semantic-warning/30 bg-semantic-warning/8 px-3 py-2 text-sm text-semantic-warning">
          {t("printAdmin.featureNotEnabled")}
        </div>
      )}

      {/* Master-Schalter */}
      <Section title={t("printSettings.activationTitle")}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">{t("printSettings.shopActive")}</div>
            <div className="text-xs text-ink-tertiary mt-0.5">
              {t("printSettings.shopActiveHint")}
            </div>
          </div>
          <Toggle
            checked={config.enabled}
            disabled={saving || !config.featureFlagEnabled}
            onChange={(v) => save({ enabled: v })}
          />
        </div>
      </Section>

      {/* Stripe-Connect */}
      <Section
        title={t("printSettings.stripeTitle")}
        description={t("printSettings.stripeDesc")}
      >
        {!connect ? null : !connect.configured ? (
          <div>
            <div className="text-sm text-ink-secondary mb-3">
              {t("printSettings.notConfigured")}
            </div>
            <Button onClick={startConnect} disabled={saving}>{t("printSettings.setupConnect")}</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm">
              {t("printSettings.statusLabel")}{" "}
              {connect.ready ? (
                <span className="text-semantic-success">{t("printSettings.statusReady")}</span>
              ) : connect.detailsSubmitted ? (
                <span className="text-semantic-warning">{t("printSettings.statusSubmitted")}</span>
              ) : (
                <span className="text-semantic-warning">{t("printSettings.statusIncomplete")}</span>
              )}
            </div>
            <div className="text-xs text-ink-tertiary space-y-0.5">
              <div>
                {t("printSettings.accountId")}{" "}
                <code className="font-mono">{connect.stripeConnectedAccountId}</code>
              </div>
              <div>
                {t("printSettings.chargesLabel")}{" "}
                {connect.chargesEnabled ? "✓" : t("printSettings.notYet")}
              </div>
              <div>
                {t("printSettings.payoutsLabel")} {connect.payoutsEnabled ? "✓" : t("printSettings.notYet")}
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              {!connect.ready && (
                <Button onClick={startConnect} disabled={saving}>{t("printSettings.continueOnboarding")}</Button>
              )}
              <Button
                variant="secondary"
                onClick={refreshConnect}
                disabled={saving}
              >{t("printSettings.refreshStatus")}</Button>
              <Button
                variant="secondary"
                onClick={disconnect}
                disabled={saving}
              >{t("printSettings.disconnect")}</Button>
            </div>
          </div>
        )}
      </Section>

      {/* Studio-Daten */}
      <Section
        title={t("printSettings.studioDataTitle")}
        description={t("printSettings.studioDataDesc")}
      >
        <SaveForm
          fields={[
            {
              key: "studioDisplayName",
              label: t("printSettings.studioName"),
              type: "text",
              value: config.studioDisplayName ?? "",
              placeholder: t("printSettings.studioNamePlaceholder"),
            },
            {
              key: "supportEmail",
              label: t("printSettings.supportEmail"),
              type: "email",
              value: config.supportEmail ?? "",
              placeholder: t("printSettings.supportEmailPlaceholder"),
            },
          ]}
          onSave={(values) =>
            save({
              studioDisplayName: values.studioDisplayName?.trim() || null,
              supportEmail: values.supportEmail?.trim() || null,
            })
          }
          saving={saving}
        />
      </Section>

      {/* MwSt + Währung */}
      <Section
        title={t("printSettings.vatTitle")}
        description={t("printSettings.vatDesc")}
      >
        <SaveForm
          fields={[
            {
              key: "vatHandling",
              label: t("printSettings.priceDisplay"),
              type: "select",
              value: config.vatHandling,
              options: [
                { value: "inclusive", label: t("printSettings.vatInclusive") },
                { value: "exclusive", label: t("printSettings.vatExclusive") },
              ],
            },
            {
              key: "defaultVatBps",
              label: t("printSettings.defaultVat"),
              type: "number",
              value: String(config.defaultVatBps / 100),
              suffix: "%",
            },
            {
              key: "currency",
              label: t("printSettings.currency"),
              type: "select",
              value: config.currency,
              options: [
                { value: "EUR", label: "EUR (€)" },
                { value: "USD", label: "USD ($)" },
                { value: "GBP", label: "GBP (£)" },
                { value: "CHF", label: "CHF (Fr.)" },
              ],
            },
          ]}
          onSave={(values) =>
            save({
              vatHandling: values.vatHandling as "inclusive" | "exclusive",
              defaultVatBps: Math.round(parseFloat(values.defaultVatBps ?? "19") * 100),
              currency: values.currency,
            })
          }
          saving={saving}
        />
      </Section>

      {/* AGB / Privacy */}
      <Section
        title={t("printSettings.termsTitle")}
        description={t("printSettings.termsDesc")}
      >
        <SaveForm
          fields={[
            {
              key: "termsUrl",
              label: t("printSettings.termsUrl"),
              type: "url",
              value: config.termsUrl ?? "",
              placeholder: "https://studio-mueller.de/agb",
            },
            {
              key: "privacyUrl",
              label: t("printSettings.privacyUrl"),
              type: "url",
              value: config.privacyUrl ?? "",
              placeholder: "https://studio-mueller.de/datenschutz",
            },
          ]}
          onSave={(values) =>
            save({
              termsUrl: values.termsUrl?.trim() || null,
              privacyUrl: values.privacyUrl?.trim() || null,
            })
          }
          saving={saving}
        />
      </Section>
    </div>
  );
}

// =============================================================================
// Sub-Components
// =============================================================================

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-line-subtle bg-surface-raised p-4">
      <h2 className="text-base font-semibold mb-1">{title}</h2>
      {description && (
        <p className="text-xs text-ink-tertiary mb-3">{description}</p>
      )}
      <div className={description ? "" : "mt-2"}>{children}</div>
    </section>
  );
}

function Toggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={
        checked
          ? "shrink-0 inline-flex items-center h-6 w-11 rounded-full bg-semantic-success transition-colors disabled:opacity-50"
          : "shrink-0 inline-flex items-center h-6 w-11 rounded-full bg-surface-sunken transition-colors disabled:opacity-50"
      }
      aria-label={checked ? t("printSettings.deactivate") : t("printSettings.activate")}
    >
      <span
        className={
          checked
            ? "inline-block h-5 w-5 rounded-full bg-white shadow translate-x-5 transition-transform"
            : "inline-block h-5 w-5 rounded-full bg-white shadow translate-x-0.5 transition-transform"
        }
      />
    </button>
  );
}

type FieldDef =
  | {
      key: string;
      label: string;
      type: "text" | "email" | "url" | "number";
      value: string;
      placeholder?: string;
      suffix?: string;
    }
  | {
      key: string;
      label: string;
      type: "select";
      value: string;
      options: Array<{ value: string; label: string }>;
    };

function SaveForm({
  fields,
  onSave,
  saving,
}: {
  fields: FieldDef[];
  onSave: (values: Record<string, string>) => void | Promise<void>;
  saving: boolean;
}) {
  const t = useT();
  const initial: Record<string, string> = {};
  for (const f of fields) initial[f.key] = f.value;
  const [values, setValues] = useState<Record<string, string>>(initial);
  // Wenn die externen Defaults sich aendern (Load nach Save), setzen wir
  // den State neu — sonst zeigt das Formular alte Werte.
  useEffect(() => {
    setValues(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields.map((f) => f.value).join("|")]);

  const dirty = fields.some((f) => values[f.key] !== f.value);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(values);
      }}
      className="space-y-3"
    >
      <div className="grid sm:grid-cols-2 gap-3">
        {fields.map((f) => (
          <label key={f.key} className="block">
            <span className="block text-xs text-ink-tertiary mb-1">
              {f.label}
            </span>
            {f.type === "select" ? (
              <Select
                value={values[f.key] ?? ""}
                onChange={(e) =>
                  setValues({ ...values, [f.key]: e.target.value })
                }
              >
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                type={f.type}
                value={values[f.key] ?? ""}
                placeholder={f.placeholder}
                onChange={(e) =>
                  setValues({ ...values, [f.key]: e.target.value })
                }
              />
            )}
          </label>
        ))}
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={!dirty || saving} size="sm">{t("common.save")}</Button>
      </div>
    </form>
  );
}
