"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface NotificationEvent {
  key: string;
  label: string;
  description: string;
}

/**
 * Studio-Einstellungen: E-Mail-Benachrichtigungen an/aus pro Event.
 * Lädt und speichert eigenständig; speichert direkt beim Umschalten.
 */
export function NotificationSettings({ canEdit }: { canEdit: boolean }) {
  const [events, setEvents] = useState<NotificationEvent[]>([]);
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const r = await api.getStudioNotifications();
        setEvents(r.events);
        setPrefs(r.prefs);
      } catch {
        setError("Einstellungen konnten nicht geladen werden.");
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
      // Zurückrollen bei Fehler
      setPrefs((p) => ({ ...p, [key]: !p[key] }));
      setError("Speichern fehlgeschlagen.");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <section className="rounded-lg border border-line-subtle bg-surface-raised p-5">
      <h2 className="text-lg font-semibold">E-Mail-Benachrichtigungen</h2>
      <p className="text-ui-sm text-ink-tertiary mt-0.5 mb-4">
        Wähle, worüber dich Lumio per E-Mail informiert. Mails gehen an den
        Studio-Owner.
      </p>

      {loading ? (
        <div className="text-ui-sm text-ink-tertiary">Lädt…</div>
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
                    "relative shrink-0 mt-0.5 h-6 w-11 rounded-full transition-colors disabled:opacity-50 " +
                    (on ? "bg-accent" : "bg-line-strong")
                  }
                  title={
                    canEdit
                      ? on
                        ? "Aktiviert"
                        : "Deaktiviert"
                      : "Nur Owner/Admin können das ändern"
                  }
                >
                  <span
                    className={
                      "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform " +
                      (on ? "translate-x-5" : "translate-x-0.5")
                    }
                  />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {error && <div className="text-ui-sm text-semantic-danger mt-3">{error}</div>}
      {!canEdit && !loading && (
        <p className="text-ui-xs text-ink-tertiary mt-3">
          Nur Owner und Admins können Benachrichtigungen ändern.
        </p>
      )}
    </section>
  );
}
