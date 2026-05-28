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
  return (
    <Suspense fallback={<div className="text-sm text-ink-tertiary">Lädt…</div>}>
      <SettingsInner />
    </Suspense>
  );
}

function SettingsInner() {
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
        text: err instanceof Error ? err.message : "Fehler",
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
            : "Stripe-Onboarding ist noch unvollständig. Klicke nochmal auf 'Einrichten'.",
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
          text: err instanceof Error ? err.message : "Sync fehlgeschlagen",
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
      setMessage({ kind: "success", text: "Gespeichert." });
    } catch (err) {
      setMessage({
        kind: "danger",
        text: err instanceof Error ? err.message : "Speichern fehlgeschlagen",
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
        text: err instanceof Error ? err.message : "Onboarding-Fehler",
      });
      setSaving(false);
    }
  }

  async function refreshConnect() {
    setSaving(true);
    try {
      const r = await api.refreshStripeConnect();
      setConnect(r.stripeConnect);
      setMessage({ kind: "success", text: "Status aktualisiert." });
    } catch (err) {
      setMessage({
        kind: "danger",
        text: err instanceof Error ? err.message : "Fehler",
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
      setMessage({ kind: "success", text: "Stripe-Connect getrennt." });
    } catch (err) {
      setMessage({
        kind: "danger",
        text: err instanceof Error ? err.message : "Fehler",
      });
    } finally {
      setSaving(false);
    }
  }

  if (!config) {
    return <div className="text-sm text-ink-tertiary">Lädt…</div>;
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
          Das Print-Shop-Feature ist für dein Studio noch nicht freigeschaltet.
          Bitte kontaktiere den Support, falls du das nutzen möchtest.
        </div>
      )}

      {/* Master-Schalter */}
      <Section title="Aktivierung">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">Print-Shop aktiv</div>
            <div className="text-xs text-ink-tertiary mt-0.5">
              Wenn aus: keine Bestell-Buttons in Galerien, keine
              Endkunden-Sicht.
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
        title="Online-Bezahlung (Stripe Connect)"
        description="Endkunden bezahlen Bestellungen direkt online. Geld geht an dein Stripe-Konto, nicht an Lumio. Alternativ kannst du im Offline-Modus arbeiten (Rechnung selbst stellen) — dann brauchst du Stripe nicht."
      >
        {!connect ? null : !connect.configured ? (
          <div>
            <div className="text-sm text-ink-secondary mb-3">
              Noch nicht eingerichtet. Klicke unten, um zu Stripe zu wechseln
              und dein Konto in wenigen Minuten einzurichten.
            </div>
            <Button onClick={startConnect} disabled={saving}>
              Stripe-Connect einrichten
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm">
              Status:{" "}
              {connect.ready ? (
                <span className="text-semantic-success">
                  ✓ Online-Bestellungen aktivierbar
                </span>
              ) : connect.detailsSubmitted ? (
                <span className="text-semantic-warning">
                  Onboarding abgeschickt — Stripe verifiziert noch
                </span>
              ) : (
                <span className="text-semantic-warning">
                  Onboarding unvollständig
                </span>
              )}
            </div>
            <div className="text-xs text-ink-tertiary space-y-0.5">
              <div>
                Account-ID:{" "}
                <code className="font-mono">{connect.stripeConnectedAccountId}</code>
              </div>
              <div>
                Zahlungen einnehmen:{" "}
                {connect.chargesEnabled ? "✓" : "noch nicht"}
              </div>
              <div>
                Auszahlungen: {connect.payoutsEnabled ? "✓" : "noch nicht"}
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              {!connect.ready && (
                <Button onClick={startConnect} disabled={saving}>
                  Onboarding fortsetzen
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={refreshConnect}
                disabled={saving}
              >
                Status aktualisieren
              </Button>
              <Button
                variant="secondary"
                onClick={disconnect}
                disabled={saving}
              >
                Trennen
              </Button>
            </div>
          </div>
        )}
      </Section>

      {/* Studio-Daten */}
      <Section
        title="Studio-Daten"
        description="Wie heißt dein Studio in Endkunden-Mails? An welche Adresse sollen Endkunden-Rückfragen gehen?"
      >
        <SaveForm
          fields={[
            {
              key: "studioDisplayName",
              label: "Studio-Name in Mails",
              type: "text",
              value: config.studioDisplayName ?? "",
              placeholder: "z.B. „Studio Müller Hochzeitsfotografie“",
            },
            {
              key: "supportEmail",
              label: "Support-E-Mail",
              type: "email",
              value: config.supportEmail ?? "",
              placeholder: "support@dein-studio.de",
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
        title="Mehrwertsteuer & Währung"
        description="In Deutschland sind Endkunden-Preise inklusive MwSt. üblich. Standard-Satz ist 19% — Photobooks fallen oft unter 7%, das kannst du dann pro Produkt überschreiben."
      >
        <SaveForm
          fields={[
            {
              key: "vatHandling",
              label: "Preisangabe",
              type: "select",
              value: config.vatHandling,
              options: [
                { value: "inclusive", label: "Inklusive (Brutto)" },
                { value: "exclusive", label: "Exklusive (Netto)" },
              ],
            },
            {
              key: "defaultVatBps",
              label: "Standard-MwSt (in Prozent)",
              type: "number",
              value: String(config.defaultVatBps / 100),
              suffix: "%",
            },
            {
              key: "currency",
              label: "Währung",
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
        title="AGB & Datenschutz"
        description="Pflicht in DE — Endkunden müssen im Checkout zustimmen. Die Links sollten auf deine eigene Studio-Website zeigen."
      >
        <SaveForm
          fields={[
            {
              key: "termsUrl",
              label: "AGB-URL",
              type: "url",
              value: config.termsUrl ?? "",
              placeholder: "https://studio-mueller.de/agb",
            },
            {
              key: "privacyUrl",
              label: "Datenschutz-URL",
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
      aria-label={checked ? "Deaktivieren" : "Aktivieren"}
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
        <Button type="submit" disabled={!dirty || saving} size="sm">
          Speichern
        </Button>
      </div>
    </form>
  );
}
