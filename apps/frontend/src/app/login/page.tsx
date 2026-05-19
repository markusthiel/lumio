"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startAuthentication } from "@simplewebauthn/browser";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";

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
    <main className="min-h-screen flex items-center justify-center p-8 bg-slate-50">
      {stage.kind === "credentials" ? (
        <form
          onSubmit={submitCredentials}
          className="w-full max-w-sm space-y-5 bg-white border border-slate-200 rounded-lg p-8 shadow-sm"
        >
          <header className="space-y-1">
            <div className="text-xs font-medium text-brand-accent uppercase tracking-wider">
              Lumio
            </div>
            <h1 className="text-2xl font-semibold">{t("login.title")}</h1>
          </header>

          <div className="space-y-1">
            <label htmlFor="email" className="text-sm font-medium">
              {t("login.email")}
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent focus:border-transparent"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="password" className="text-sm font-medium">
              {t("login.password")}
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent focus:border-transparent"
            />
          </div>

          {error && (
            <div
              role="alert"
              className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full bg-slate-900 text-white text-sm font-medium rounded-md py-2.5 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {pending ? t("common.signingIn") : t("common.signIn")}
          </button>

          <p className="text-xs text-slate-500 text-center pt-2">
            {t("login.cliHint")}{" "}
            <code className="bg-slate-100 px-1 py-0.5 rounded">
              npm run create-admin
            </code>
          </p>
        </form>
      ) : (
        <div className="w-full max-w-sm space-y-5 bg-white border border-slate-200 rounded-lg p-8 shadow-sm">
          <header className="space-y-1">
            <div className="text-xs font-medium text-brand-accent uppercase tracking-wider">
              Lumio
            </div>
            <h1 className="text-2xl font-semibold">
              {stage.hasWebauthn && !stage.hasTotp
                ? "Mit Passkey anmelden"
                : t("login.totp.title")}
            </h1>
            <p className="text-sm text-slate-500">
              {stage.hasWebauthn && !stage.hasTotp
                ? "Bestätige die Anmeldung mit deinem Gerät."
                : t("login.totp.description")}
            </p>
          </header>

          {/* Passkey-Anmeldung wenn verfügbar — als primärer CTA */}
          {stage.hasWebauthn && (
            <button
              type="button"
              onClick={loginWithPasskey}
              disabled={pending}
              className="w-full bg-slate-900 text-white text-sm font-medium rounded-md py-2.5 hover:bg-slate-800 disabled:opacity-50 transition"
            >
              {pending ? "Wartet auf Gerät…" : "Mit Passkey anmelden"}
            </button>
          )}

          {/* Trenner wenn beide Methoden aktiv sind */}
          {stage.hasWebauthn && stage.hasTotp && (
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-white px-2 text-slate-500">oder</span>
              </div>
            </div>
          )}

          {/* TOTP-Formular */}
          {stage.hasTotp && (
            <form onSubmit={submitTotp} className="space-y-4">
              <div className="space-y-1">
                <label htmlFor="code" className="text-sm font-medium">
                  {t("login.totp.code")}
                </label>
                <input
                  id="code"
                  autoFocus={!stage.hasWebauthn}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-brand-accent focus:border-transparent"
                />
                <p className="text-xs text-slate-500 mt-1">
                  {t("login.totp.backupHint")}
                </p>
              </div>

              <button
                type="submit"
                disabled={pending}
                className={`w-full text-sm font-medium rounded-md py-2.5 disabled:opacity-50 transition ${
                  stage.hasWebauthn
                    ? "border border-slate-300 hover:bg-slate-100"
                    : "bg-slate-900 text-white hover:bg-slate-800"
                }`}
              >
                {pending ? t("common.verifying") : t("common.verify")}
              </button>
            </form>
          )}

          {error && (
            <div
              role="alert"
              className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2"
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
            className="text-xs text-slate-500 hover:text-slate-900 w-full text-center"
          >
            ← Andere Zugangsdaten verwenden
          </button>
        </div>
      )}
    </main>
  );
}
