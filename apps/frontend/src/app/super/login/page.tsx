"use client";

/**
 * /super/login — Login-Seite für Plattform-Operatoren.
 *
 * Eigener Login getrennt vom Studio-Login: anderer Cookie, andere
 * Identität. Die Page nutzt absichtlich keine i18n-Strings — der
 * Super-Admin-Bereich ist intern, einsprachig (Deutsch), und braucht
 * keine Branding-Anpassung.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function SuperLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Wenn bereits eingeloggt — direkt weiterleiten. Spart einen
  // unnötigen Klick bei Browser-Reload.
  useEffect(() => {
    (async () => {
      try {
        await api.superMe();
        router.replace("/super");
      } catch {
        // nicht eingeloggt — Page rendern
      }
    })();
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.superLogin(email, password);
      router.replace("/super");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Login fehlgeschlagen"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-canvas">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-md border border-line-strong bg-surface-raised p-6 space-y-4"
      >
        <div>
          <h1 className="text-ui-lg font-semibold text-ink-primary">
            Lumio Super-Admin
          </h1>
          <p className="text-ui-sm text-ink-tertiary mt-1">
            Plattform-Verwaltung. Kein Kunden-Zugang.
          </p>
        </div>

        <label className="block">
          <span className="text-ui-sm text-ink-secondary">E-Mail</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            autoComplete="username"
            className="mt-1 w-full h-10 px-3 rounded bg-surface-sunken border border-line-subtle text-ui text-ink-primary focus:border-accent focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-ui-sm text-ink-secondary">Passwort</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="mt-1 w-full h-10 px-3 rounded bg-surface-sunken border border-line-subtle text-ui text-ink-primary focus:border-accent focus:outline-none"
          />
        </label>

        {error && (
          <div className="text-ui-sm text-semantic-danger">{error}</div>
        )}

        <button
          type="submit"
          disabled={busy || !email || !password}
          className="w-full h-10 rounded bg-accent text-accent-contrast font-medium hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-motion"
        >
          {busy ? "Wird angemeldet…" : "Anmelden"}
        </button>
      </form>
    </div>
  );
}
