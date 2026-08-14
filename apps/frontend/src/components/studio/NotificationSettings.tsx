"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";

interface NotificationEvent {
  key: string;
  label: string;
  description: string;
}

/**
 * Studio-Einstellungen: E-Mail-Benachrichtigungen an/aus pro Event.
 * Enthält auch den Marketing-E-Mail-Toggle (Trial-Reminder, Winback).
 * Lädt und speichert eigenständig; speichert direkt beim Umschalten.
 */
export function NotificationSettings({ canEdit }: { canEdit: boolean }) {
  const t = useT();
  const [events, setEvents] = useState<NotificationEvent[]>([]);
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  // null = kein Billing aktiviert / keine Subscription → Toggle nicht zeigen
  const [marketingEnabled, setMarketingEnabled] = useState<boolean | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [marketingSaving, setMarketingSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const r = await api.getStudioNotifications();
        setEvents(r.events);
        setPrefs(r.prefs);
        if (typeof r.marketingEmailsEnabled === "boolean") {
          setMarketingEnabled(r.marketingEmailsEnabled);
        }
      } catch {
        setError(t("notifications.loadError"));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function toggle(key: string) {
    if (!canEdit) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setSavingKey(key);
    setError(null);
    try {
      const r = await api.updateStudioNotifications(next);
      setPrefs(r.prefs);
    } catch {
      setPrefs((p) => ({ ...p, [key]: !p[key] }));
      setError(t("notifications.saveFailed"));
    } finally {
      setSavingKey(null);
    }
  }

  async function toggleMarketing() {
    if (!canEdit || marketingEnabled === null) return;
    const next = !marketingEnabled;
    setMarketingEnabled(next);
    setMarketingSaving(true);
    try {
      const r = await api.setMarketingEmailsEnabled(next);
      setMarketingEnabled(r.marketingEmailsEnabled);
    } catch {
      setMarketingEnabled(!next);
      setError(t("notifications.saveFailed"));
    } finally {
      setMarketingSaving(false);
    }
  }

  return (
    <section className="rounded-lg border border-line-subtle bg-surface-raised p-5 space-y-6">
      {/* Transaktionale Benachrichtigungen */}
      <div>
        <h2 className="text-lg font-semibold">{t("notifications.heading")}</h2>
        <p className="text-ui-sm text-ink-tertiary mt-0.5 mb-4">
          {t("notifications.desc")}
        </p>

        {loading ? (
          <div className="text-ui-sm text-ink-tertiary">{t("common.loading")}</div>
        ) : (
          <div className="divide-y divide-line-subtle">
            {events.map((e) => {
              const on = prefs[e.key] ?? true;
              return (
                <div
                  key={e.key}
                  className="flex items-start justify-between gap-4 py-3 first:pt-0"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-ink-primary">{e.label}</div>
                    <div className="text-ui-sm text-ink-tertiary">
                      {e.description}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    disabled={!canEdit || savingKey === e.key}
                    onClick={() => void toggle(e.key)}
                    className={
                      "relative inline-flex shrink-0 mt-0.5 h-6 w-11 items-center rounded-full px-0.5 transition-colors disabled:opacity-50 " +
                      (on ? "bg-accent" : "bg-line-strong")
                    }
                    title={
                      canEdit
                        ? on
                          ? t("notifications.enabledTitle")
                          : t("notifications.disabledTitle")
                        : t("notifications.onlyOwnerAdminTitle")
                    }
                  >
                    <span
                      className={
                        "inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform " +
                        (on ? "translate-x-5" : "translate-x-0")
                      }
                    />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Marketing-Mails (nur wenn Billing aktiv) */}
      {!loading && marketingEnabled !== null && (
        <div className="border-t border-line-subtle pt-5">
          <h3 className="font-semibold text-ink-primary">{t("notifications.productMailsHeading")}</h3>
          <p className="text-ui-sm text-ink-tertiary mt-0.5 mb-4">
            {t("notifications.productMailsDesc")}
          </p>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-medium text-ink-primary">
                {t("notifications.productLifecycleLabel")}
              </div>
              <div className="text-ui-sm text-ink-tertiary">
                {t("notifications.productLifecycleDesc")}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={marketingEnabled}
              disabled={!canEdit || marketingSaving}
              onClick={() => void toggleMarketing()}
              className={
                "relative inline-flex shrink-0 mt-0.5 h-6 w-11 items-center rounded-full px-0.5 transition-colors disabled:opacity-50 " +
                (marketingEnabled ? "bg-accent" : "bg-line-strong")
              }
              title={
                canEdit
                  ? marketingEnabled
                    ? t("notifications.enabledTitle")
                    : t("notifications.disabledTitle")
                  : t("notifications.onlyOwnerAdminTitle")
              }
            >
              <span
                className={
                  "inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform " +
                  (marketingEnabled ? "translate-x-5" : "translate-x-0")
                }
              />
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="text-ui-sm text-semantic-danger">{error}</div>
      )}
      {!canEdit && !loading && (
        <p className="text-ui-xs text-ink-tertiary">
          {t("notifications.onlyOwnerAdminChange")}
        </p>
      )}
    </section>
  );
}
