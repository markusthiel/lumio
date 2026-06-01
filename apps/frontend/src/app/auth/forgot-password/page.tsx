"use client";

/**
 * Lumio — Passwort vergessen (Public)
 *
 * User gibt seine E-Mail-Adresse ein, Backend schickt einen Reset-Link.
 * Aus Sicherheitsgruenden zeigt die Seite IMMER dieselbe Erfolgsmeldung,
 * unabhaengig davon ob die E-Mail existiert (kein User-Enumeration).
 *
 * Tenant wird per Subdomain / Custom-Domain aufgeloest. Auf der Apex-
 * Domain im Multi-Mode landet der User hier zwar, aber der Backend-
 * Endpoint kann ohne Tenant keine Mail rausschicken — Resultat ist
 * dieselbe Erfolgsmeldung, das Verhalten ist also robust und kein
 * Sonderfall im UI.
 */
import { useState } from "react";
import Link from "next/link";

import { api } from "@/lib/api";
import { Button, Input } from "@/components/ui";
import { useT } from "@/lib/i18n";

export default function ForgotPasswordPage() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api.forgotPassword(email.trim().toLowerCase());
      setSubmitted(true);
    } catch (err) {
      // Rate-Limit-Fehler oder Netzfehler — wir zeigen die Meldung,
      // aber kein Submit-Sperrung; vielleicht nach 60s erneut probieren.
      setError(
        err instanceof Error
          ? err.message
          : t("forgotPassword.error")
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-surface-canvas">
      <div
        aria-hidden
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, rgba(245,158,11,0.06) 0%, transparent 70%)",
        }}
      />
      <div className="relative w-full max-w-sm animate-fade-in">
        <div className="text-center mb-8">
          <div className="text-display text-accent font-semibold tracking-tight">
            Lumio
          </div>
        </div>

        {submitted ? (
          <div className="bg-surface-raised border border-line-subtle rounded-md p-7 shadow-elev-2 space-y-4">
            <h1 className="text-display-sm text-ink-primary font-medium">
              {t("forgotPassword.sentTitle")}
            </h1>
            <p className="text-ui-sm text-ink-secondary leading-relaxed">
              {t("forgotPassword.sentBody")}
            </p>
            <p className="text-ui-sm text-ink-tertiary leading-relaxed">
              {t("forgotPassword.sentHint")}
            </p>
            <div className="pt-2">
              <Link
                href="/login"
                className="text-ui-sm text-accent hover:underline"
              >
                {t("forgotPassword.backToLogin")}
              </Link>
            </div>
          </div>
        ) : (
          <form
            onSubmit={submit}
            className="space-y-5 bg-surface-raised border border-line-subtle rounded-md p-7 shadow-elev-2"
          >
            <header className="space-y-1.5">
              <h1 className="text-display-sm text-ink-primary font-medium">
                {t("forgotPassword.title")}
              </h1>
              <p className="text-ui-sm text-ink-tertiary">
                {t("forgotPassword.subtitle")}
              </p>
            </header>

            <div className="space-y-1.5">
              <label
                htmlFor="email"
                className="text-ui-sm font-medium text-ink-primary block"
              >
                {t("forgotPassword.emailLabel")}
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            {error && (
              <div
                role="alert"
                className="text-ui-sm text-semantic-danger bg-semantic-danger/10 border border-semantic-danger/30 rounded-sm px-3 py-2"
              >
                {error}
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={pending || !email.trim()}
              className="w-full"
            >
              {pending ? t("forgotPassword.sending") : t("forgotPassword.submit")}
            </Button>

            <div className="text-center pt-1">
              <Link
                href="/login"
                className="text-ui-xs text-ink-tertiary hover:text-ink-primary"
              >
                {t("forgotPassword.backToLogin")}
              </Link>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
