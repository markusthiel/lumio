"use client";

import { useEffect, useState } from "react";
import {
  startRegistration,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser";
import { api, type WebauthnCredential } from "@/lib/api";

/**
 * Studio-Settings-Sektion zum Verwalten von Passkeys.
 *
 * Lifecycle:
 *   1. Liste der vorhandenen Credentials laden
 *   2. "Passkey hinzufügen" → Server schickt Challenge → Browser-API
 *      lockt Touch-ID/Windows-Hello/USB-Key → Server verifiziert →
 *      Credential ist gespeichert
 *   3. Entfernen-Button pro Eintrag löscht die Credential
 *
 * Wir blockieren nicht den TOTP-Pfad — User können beide haben. WebAuthn
 * ist eine zusätzliche, nicht alternative 2FA-Methode. Wer aber Passkeys
 * konfiguriert hat, kann auch ohne TOTP-App ein 2FA-Login machen.
 */
export function PasskeysSection() {
  const [credentials, setCredentials] = useState<WebauthnCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    // browserSupportsWebAuthn ist sync, aber wir wollen es nicht beim SSR
    // aufrufen
    setSupported(browserSupportsWebAuthn());
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await api.listWebauthnCredentials();
      setCredentials(res.credentials);
    } catch (err) {
      console.error("listWebauthnCredentials failed:", err);
    } finally {
      setLoading(false);
    }
  }

  async function addPasskey() {
    setError(null);
    const label = window.prompt(
      'Bezeichnung für diesen Passkey (z.B. "MacBook" oder "YubiKey #1"):'
    );
    if (!label || !label.trim()) return;

    setAdding(true);
    try {
      const start = await api.webauthnRegisterStart();
      // @simplewebauthn/browser sprich direkt mit der Plattform-API
      // (Touch-ID / Windows Hello / FIDO2 Key) und gibt die Antwort
      // im Server-erwarteten Format zurück.
      const response = await startRegistration({
        // Cast, weil unsere API.ts den exakten Typ als unknown rausgibt
        // (wir wollen die SimpleWebAuthn-Internals nicht an die Client-
        // Surface anbinden, damit später andere Lib-Versionen ohne
        // Breaking-Change reinpassen).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        optionsJSON: start.options as any,
      });
      await api.webauthnRegisterFinish(response, label.trim());
      await load();
    } catch (err) {
      // Häufigste Fehler: User hat Abbrechen geklickt, Browser meldet
      // NotAllowedError. Den behandeln wir leise.
      if (err instanceof Error && err.name === "NotAllowedError") {
        // user cancelled
      } else {
        console.error("addPasskey failed:", err);
        setError(
          err instanceof Error
            ? err.message
            : "Passkey konnte nicht hinzugefügt werden."
        );
      }
    } finally {
      setAdding(false);
    }
  }

  async function removePasskey(id: string, label: string) {
    if (
      !window.confirm(`Passkey "${label}" wirklich entfernen?`)
    )
      return;
    try {
      await api.deleteWebauthnCredential(id);
      await load();
    } catch (err) {
      console.error("removePasskey failed:", err);
    }
  }

  if (!supported) {
    return (
      <section className="rounded-lg border border-line-subtle bg-surface-raised p-5">
        <h2 className="text-sm font-medium">Passkeys</h2>
        <p className="text-xs text-ink-tertiary mt-1">
          Dieser Browser unterstützt keine WebAuthn-/Passkey-Anmeldung. Auf
          einem aktuellen Chrome, Safari oder Firefox sollte es funktionieren.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-line-subtle bg-surface-raised p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium">Passkeys</h2>
          <p className="text-xs text-ink-tertiary mt-0.5">
            Anmeldung per Touch-ID, Windows Hello oder Security-Key. Eine
            Alternative oder Ergänzung zu TOTP.
          </p>
        </div>
        <button
          type="button"
          onClick={addPasskey}
          disabled={adding}
          className="text-sm px-3 py-1.5 rounded-md bg-accent text-accent-contrast hover:bg-accent-hover disabled:opacity-50 whitespace-nowrap"
        >
          {adding ? "Lädt…" : "Passkey hinzufügen"}
        </button>
      </div>

      {error && (
        <div className="text-xs text-semantic-danger bg-rose-50 border border-rose-200 rounded p-2">
          {error}
        </div>
      )}

      {!loading && credentials.length === 0 && (
        <p className="text-xs text-ink-tertiary italic">
          Noch keine Passkeys registriert.
        </p>
      )}

      {credentials.length > 0 && (
        <ul className="divide-y divide-line-subtle border border-line-subtle rounded-md">
          {credentials.map((c) => (
            <li
              key={c.id}
              className="p-3 flex items-center justify-between gap-3 text-sm"
            >
              <div>
                <div className="font-medium">{c.label}</div>
                <div className="text-xs text-ink-tertiary mt-0.5">
                  Hinzugefügt {formatDate(c.createdAt)}
                  {c.lastUsedAt && ` · zuletzt verwendet ${formatDate(c.lastUsedAt)}`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => removePasskey(c.id, c.label)}
                className="text-xs text-semantic-danger hover:underline"
              >
                Entfernen
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
