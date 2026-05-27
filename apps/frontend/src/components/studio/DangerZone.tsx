"use client";

/**
 * Lumio Studio — Self-Service Tenant-Loeschung
 *
 * Zwei Komponenten in einer Datei:
 *
 *   1. <DangerZone /> — Card mit "Studio loeschen"-Aktion, sichtbar
 *      nur fuer Owner. Klick oeffnet einen Modal mit doppelter
 *      Bestaetigung (Passwort + Studio-Name-Echo).
 *
 *   2. <PendingDeletionBanner /> — globaler Banner der angezeigt
 *      wird, solange das Studio in der Karenzphase ist. Countdown
 *      bis Hard-Delete + Reaktivierungs-Button.
 *
 * Beide nutzen useDeletionStatus() um den aktuellen Stand zu pollen.
 *
 * UX-Entscheidungen:
 *  - Studio-Name-Echo ist case-insensitive (UX), Backend macht das
 *    nochmal defensiv.
 *  - Modal hat einen 5-Sekunden-Countdown bevor der Loeschen-Button
 *    aktiv wird — schuetzt vor Klick-Reflex.
 *  - Banner zeigt verbleibende Tage in Wochen/Tagen ("noch 6 Wochen"),
 *    nicht in Stunden — wir verkaufen nicht Panik, sondern Klarheit.
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { Button } from "@/components/ui";

interface DeletionStatus {
  isPendingDeletion: boolean;
  requestedAt: string | null;
  scheduledFor: string | null;
}

/** Polling-Hook: laedt den Status einmal beim Mount + after-mutations
 *  reload-aufrufbar. Wir pollen nicht periodisch — die Werte aendern
 *  sich nur durch User-Aktion. */
export function useDeletionStatus(): {
  status: DeletionStatus | null;
  loading: boolean;
  reload: () => Promise<void>;
} {
  const [status, setStatus] = useState<DeletionStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const data = await api.getDeletionStatus();
      setStatus(data);
    } catch {
      // Wenn der Endpoint nicht erreichbar ist (Session abgelaufen
      // etc.), tun wir so als ob kein Pending — der Banner zeigt
      // nichts an. Login-Page redirect kommt vom Auth-Plugin.
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { status, loading, reload };
}

// =============================================================================
// DangerZone
// =============================================================================

export function DangerZone({
  studioName,
  userRole,
  onMutated,
}: {
  studioName: string;
  userRole: "owner" | "admin" | "member";
  onMutated?: () => void;
}) {
  const [showModal, setShowModal] = useState(false);
  const { status, reload } = useDeletionStatus();
  const [cancelling, setCancelling] = useState(false);

  // Team-Member und Admins sehen die Danger-Zone gar nicht — nur Owner.
  if (userRole !== "owner") {
    return null;
  }

  // Bei aktiver Loeschungs-Anfrage: Status-Anzeige statt Delete-Button.
  if (status?.isPendingDeletion && status.scheduledFor) {
    const scheduledDate = new Date(status.scheduledFor);
    const requestedDate = status.requestedAt
      ? new Date(status.requestedAt)
      : null;
    const daysLeft = Math.max(
      0,
      Math.ceil(
        (scheduledDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
      )
    );

    async function onCancelClick() {
      if (
        !confirm(
          "Loeschung wirklich zuruecknehmen? Dein Studio wird wieder aktiv. Die Stripe-Subscription muss separat neu gestartet werden."
        )
      )
        return;
      setCancelling(true);
      try {
        await api.cancelStudioDeletion();
        await reload();
        onMutated?.();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Fehler");
      } finally {
        setCancelling(false);
      }
    }

    return (
      <section className="rounded-md border border-red-300 bg-red-50/40 p-5 space-y-3">
        <h2 className="text-ui font-medium text-red-700">
          Studio-Löschung läuft
        </h2>
        <dl className="grid grid-cols-[200px_1fr] gap-y-2 gap-x-3 text-ui-sm">
          <dt className="text-ink-secondary">Status</dt>
          <dd className="text-ink-primary font-medium">
            Pending Deletion (Karenzphase)
          </dd>
          {requestedDate && (
            <>
              <dt className="text-ink-secondary">Angefordert am</dt>
              <dd className="text-ink-primary">
                {requestedDate.toLocaleString("de-DE", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </dd>
            </>
          )}
          <dt className="text-ink-secondary">Endgültige Löschung</dt>
          <dd className="text-ink-primary font-medium">
            {scheduledDate.toLocaleDateString("de-DE", {
              day: "2-digit",
              month: "long",
              year: "numeric",
            })}{" "}
            <span className="text-ink-tertiary">
              ({daysLeft} {daysLeft === 1 ? "Tag" : "Tage"})
            </span>
          </dd>
          <dt className="text-ink-secondary">Stripe-Subscription</dt>
          <dd className="text-ink-primary">
            Gekündigt — bei Reaktivierung manuell neu starten.
          </dd>
        </dl>
        <Button
          variant="secondary"
          onClick={onCancelClick}
          disabled={cancelling}
          className="mt-2"
        >
          {cancelling ? "Wird zurückgenommen…" : "Löschung zurücknehmen"}
        </Button>
      </section>
    );
  }

  // Normaler Zustand: Delete-Button
  return (
    <>
      <section className="rounded-md border border-red-200 bg-red-50/30 p-5 space-y-3">
        <h2 className="text-ui font-medium text-red-700">Studio löschen</h2>
        <p className="text-ui-sm text-ink-secondary leading-relaxed">
          Dies markiert dein Studio zur endgültigen Löschung. Du hast eine
          60-tägige Karenzphase, in der du die Löschung jederzeit
          zurücknehmen kannst. Nach Ablauf werden alle Bilder, Galerien
          und Account-Daten unwiderruflich entfernt.
        </p>
        <p className="text-ui-sm text-ink-secondary leading-relaxed">
          Deine Stripe-Subscription wird sofort gekündigt — keine weitere
          Abrechnung.
        </p>
        <Button
          variant="danger"
          onClick={() => setShowModal(true)}
          className="mt-2"
        >
          Studio löschen…
        </Button>
      </section>

      {showModal && (
        <DeletionModal
          studioName={studioName}
          onClose={() => setShowModal(false)}
          onDone={() => {
            setShowModal(false);
            void reload();
            onMutated?.();
          }}
        />
      )}
    </>
  );
}

function DeletionModal({
  studioName,
  onClose,
  onDone,
}: {
  studioName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 5-Sekunden-Timer bevor der Submit-Button aktiv wird — Schutz gegen
  // Klick-Reflex. Reset bei jedem Modal-Open.
  const [secondsLeft, setSecondsLeft] = useState(5);
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  const nameMatches =
    confirmName.trim().toLowerCase() === studioName.trim().toLowerCase();
  const canSubmit =
    !pending && secondsLeft === 0 && password.length > 0 && nameMatches;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api.requestStudioDeletion({
        password,
        confirmStudioName: confirmName,
      });
      onDone();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Fehler";
      // Backend-Fehler in lesbare Strings uebersetzen
      if (msg.includes("password_wrong")) {
        setError("Passwort ist nicht korrekt.");
      } else if (msg.includes("studio_name_mismatch")) {
        setError("Der eingegebene Studio-Name stimmt nicht.");
      } else if (msg.includes("owner_required")) {
        setError("Nur der Studio-Owner kann das Studio löschen.");
      } else {
        setError(msg);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[100]"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
        className="w-full max-w-lg bg-surface-raised border border-line-subtle shadow-2xl rounded-lg p-6 space-y-4"
      >
        <div>
          <h2 className="text-lg font-semibold text-red-700">
            Studio „{studioName}" löschen
          </h2>
          <p className="text-ui-sm text-ink-secondary mt-2 leading-relaxed">
            Bitte bestätige mit deinem Passwort und durch erneutes Eintippen
            des Studio-Namens. Die Löschung wird mit 60-tägiger Karenzphase
            geplant — du kannst sie jederzeit zurücknehmen, bis der Stichtag
            erreicht ist.
          </p>
        </div>

        <div className="space-y-1">
          <label htmlFor="del-password" className="text-ui-sm font-medium">
            Aktuelles Passwort
          </label>
          <input
            id="del-password"
            type="password"
            required
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-line-subtle px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="del-name" className="text-ui-sm font-medium">
            Studio-Name zur Bestätigung
          </label>
          <input
            id="del-name"
            required
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={studioName}
            className="w-full rounded-md border border-line-subtle px-3 py-2 text-sm font-mono"
          />
          <p className="text-xs text-ink-tertiary">
            Tippe „{studioName}" exakt ein.
          </p>
        </div>

        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-line-subtle">
          <Button type="button" variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" variant="danger" disabled={!canSubmit}>
            {pending
              ? "Wird angelegt…"
              : secondsLeft > 0
                ? `In ${secondsLeft}s freischaltbar`
                : "Endgültig löschen anfordern"}
          </Button>
        </div>
      </form>
    </div>
  );
}

// =============================================================================
// PendingDeletionBanner
// =============================================================================

export function PendingDeletionBanner({
  status,
  onCancelled,
}: {
  status: DeletionStatus | null;
  onCancelled?: () => void;
}) {
  const [pending, setPending] = useState(false);

  if (!status?.isPendingDeletion || !status.scheduledFor) return null;

  const scheduledDate = new Date(status.scheduledFor);
  const daysLeft = Math.max(
    0,
    Math.ceil((scheduledDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  );

  async function onCancelClick() {
    setPending(true);
    try {
      await api.cancelStudioDeletion();
      onCancelled?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Fehler beim Zuruecknehmen");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="bg-red-50 border-b border-red-200 px-4 py-3">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
        <div className="text-ui-sm text-red-700">
          <strong>Dein Studio wird gelöscht.</strong>{" "}
          {daysLeft > 0 ? (
            <>
              Endgültige Löschung in {daysLeft}{" "}
              {daysLeft === 1 ? "Tag" : "Tagen"} (
              {scheduledDate.toLocaleDateString("de-DE", {
                day: "2-digit",
                month: "long",
                year: "numeric",
              })}
              ).
            </>
          ) : (
            <>Endgültige Löschung wird gerade ausgeführt.</>
          )}
        </div>
        <button
          onClick={onCancelClick}
          disabled={pending || daysLeft === 0}
          className="text-ui-sm font-medium text-red-700 underline hover:text-red-900 disabled:opacity-50"
        >
          {pending ? "Wird zurückgenommen…" : "Löschung zurücknehmen"}
        </button>
      </div>
    </div>
  );
}
