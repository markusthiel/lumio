"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startAuthentication } from "@simplewebauthn/browser";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Button, Input } from "@/components/ui";

type Stage =
  | { kind: "credentials" }
  | {
      kind: "2fa";
      challenge: string;
      hasTotp: boolean;
      hasWebauthn: boolean;
    };

export default function LoginPage() {
  const router = useRouter();
  const t = useT();
  const [stage, setStage] = useState<Stage>({ kind: "credentials" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submitCredentials(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await api.login(email, password);
      if ("requiresTotp" in res) {
        setStage({
          kind: "2fa",
          challenge: res.challenge,
          hasTotp: res.requiresTotp,
          hasWebauthn: res.requiresWebauthn,
        });
      } else {
        router.push("/studio");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("login.error.generic"));
    } finally {
      setPending(false);
    }
  }

  async function submitTotp(e: React.FormEvent) {
    e.preventDefault();
    if (stage.kind !== "2fa") return;
    setError(null);
    setPending(true);
    try {
      await api.loginTotp(stage.challenge, code.trim());
      router.push("/studio");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setError(
        msg.includes("invalid_challenge")
          ? t("login.error.challengeExpired")
          : msg.includes("invalid_token")
          ? t("login.error.invalidTotp")
          : t("login.error.generic")
      );
    } finally {
      setPending(false);
    }
  }

  async function loginWithPasskey() {
    if (stage.kind !== "2fa") return;
    setError(null);
    setPending(true);
    try {
      const start = await api.webauthnLoginStart(stage.challenge);
      const response = await startAuthentication({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        optionsJSON: start.options as any,
      });
      await api.webauthnLoginFinish(stage.challenge, start.challengeId, response);
      router.push("/studio");
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        // User-Cancel ist kein Fehler
      } else {
        const msg = err instanceof Error ? err.message : "";
        setError(
          msg.includes("invalid_challenge")
            ? t("login.error.challengeExpired")
            : "Passkey-Anmeldung fehlgeschlagen."
        );
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-surface-canvas">
      {/* Dezenter Hintergrund-Gradient — gibt der zentrierten Box etwas
          Atmosphäre, ohne abzulenken. Subtle by design. */}
      <div
        aria-hidden
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, rgba(245,158,11,0.06) 0%, transparent 70%)",
        }}
      />

      <div className="relative w-full max-w-sm animate-fade-in">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="text-display text-accent font-semibold tracking-tight">
            Lumio
          </div>
        </div>

        {stage.kind === "credentials" ? (
          <form
            onSubmit={submitCredentials}
            className="space-y-5 bg-surface-raised border border-line-subtle rounded-md p-7 shadow-elev-2"
          >
            <h1 className="text-display-sm text-ink-primary font-medium">
              {t("login.title")}
            </h1>

            <div className="space-y-1.5">
              <label htmlFor="email" className="text-ui-sm font-medium text-ink-primary block">
                {t("login.email")}
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

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-ui-sm font-medium text-ink-primary block">
                {t("login.password")}
              </label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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
              disabled={pending}
              className="w-full"
            >
              {pending ? t("common.signingIn") : t("common.signIn")}
            </Button>

            <p className="text-ui-xs text-ink-tertiary text-center pt-2">
              {t("login.cliHint")}{" "}
              <code className="font-mono bg-surface-sunken px-1 py-0.5 rounded-xs">
                npm run create-admin
              </code>
            </p>
          </form>
        ) : (
          <div className="space-y-5 bg-surface-raised border border-line-subtle rounded-md p-7 shadow-elev-2">
            <header className="space-y-1.5">
              <h1 className="text-display-sm text-ink-primary font-medium">
                {stage.hasWebauthn && !stage.hasTotp
                  ? "Mit Passkey anmelden"
                  : t("login.totp.title")}
              </h1>
              <p className="text-ui-sm text-ink-tertiary">
                {stage.hasWebauthn && !stage.hasTotp
                  ? "Bestätige die Anmeldung mit deinem Gerät."
                  : t("login.totp.description")}
              </p>
            </header>

            {/* Passkey-Anmeldung — primärer CTA, wenn verfügbar */}
            {stage.hasWebauthn && (
              <Button
                type="button"
                variant="primary"
                size="lg"
                onClick={loginWithPasskey}
                disabled={pending}
                className="w-full"
              >
                {pending ? "Wartet auf Gerät…" : "Mit Passkey anmelden"}
              </Button>
            )}

            {/* Trenner wenn beide Methoden aktiv sind */}
            {stage.hasWebauthn && stage.hasTotp && (
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-line-subtle" />
                </div>
                <div className="relative flex justify-center text-ui-xs">
                  <span className="bg-surface-raised px-2 text-ink-tertiary">
                    oder
                  </span>
                </div>
              </div>
            )}

            {/* TOTP-Formular */}
            {stage.hasTotp && (
              <form onSubmit={submitTotp} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="code" className="text-ui-sm font-medium text-ink-primary block">
                    {t("login.totp.code")}
                  </label>
                  <Input
                    id="code"
                    autoFocus={!stage.hasWebauthn}
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="123456"
                    className="font-mono tracking-[0.4em] text-center"
                  />
                  <p className="text-ui-xs text-ink-tertiary mt-1">
                    {t("login.totp.backupHint")}
                  </p>
                </div>

                <Button
                  type="submit"
                  variant={stage.hasWebauthn ? "secondary" : "primary"}
                  size="lg"
                  disabled={pending}
                  className="w-full"
                >
                  {pending ? t("common.verifying") : t("common.verify")}
                </Button>
              </form>
            )}

            {error && (
              <div
                role="alert"
                className="text-ui-sm text-semantic-danger bg-semantic-danger/10 border border-semantic-danger/30 rounded-sm px-3 py-2"
              >
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setStage({ kind: "credentials" });
                setCode("");
                setError(null);
              }}
              className="text-ui-xs text-ink-tertiary hover:text-ink-primary w-full text-center transition-colors duration-motion"
            >
              ← Andere Zugangsdaten verwenden
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
