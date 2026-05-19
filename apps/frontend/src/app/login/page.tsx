"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";

type Stage =
  | { kind: "credentials" }
  | { kind: "totp"; challenge: string };

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
      if ("requiresTotp" in res && res.requiresTotp) {
        setStage({ kind: "totp", challenge: res.challenge });
      } else {
        router.push("/studio");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("login.error.generic")
      );
    } finally {
      setPending(false);
    }
  }

  async function submitTotp(e: React.FormEvent) {
    e.preventDefault();
    if (stage.kind !== "totp") return;
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
        <form
          onSubmit={submitTotp}
          className="w-full max-w-sm space-y-5 bg-white border border-slate-200 rounded-lg p-8 shadow-sm"
        >
          <header className="space-y-1">
            <div className="text-xs font-medium text-brand-accent uppercase tracking-wider">
              Lumio
            </div>
            <h1 className="text-2xl font-semibold">{t("login.totp.title")}</h1>
            <p className="text-sm text-slate-500">
              {t("login.totp.description")}
            </p>
          </header>

          <div className="space-y-1">
            <label htmlFor="code" className="text-sm font-medium">
              {t("login.totp.code")}
            </label>
            <input
              id="code"
              autoFocus
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

          {error && (
            <div
              role="alert"
              className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2"
            >
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setStage({ kind: "credentials" });
                setCode("");
                setError(null);
              }}
              className="text-sm px-3 py-2 rounded-md border border-slate-300 hover:bg-slate-100"
            >
              ←
            </button>
            <button
              type="submit"
              disabled={pending}
              className="flex-1 bg-slate-900 text-white text-sm font-medium rounded-md py-2.5 hover:bg-slate-800 disabled:opacity-50"
            >
              {pending ? t("common.verifying") : t("common.verify")}
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
