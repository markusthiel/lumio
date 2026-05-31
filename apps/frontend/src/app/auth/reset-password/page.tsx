"use client";

/**
 * Lumio — Neues Passwort setzen (Reset-Flow)
 *
 * User klickt den Link aus der "Passwort vergessen"-Mail. Wir validieren
 * den Token sofort beim Mount und zeigen die passende Maske:
 *
 *  - Valid:    Form mit neuem Passwort + Bestaetigung
 *  - Invalid:  Erklaerung + Link zum Forgot-Flow
 *  - Done:     Bestaetigung + "zum Login"
 *
 * Nach erfolgreichem Reset werden ALLE Sessions des Users im Backend
 * invalidiert. User loggt sich neu ein.
 *
 * Next.js 16 verlangt einen <Suspense>-Boundary um useSearchParams() —
 * sonst kann die Page nicht prerendert werden und der Build wirft
 * 'should be wrapped in a suspense boundary'. Outer-Page rendert den
 * Loader, die echte Logik laeuft in ResetPasswordInner.
 */
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

import { api } from "@/lib/api";
import { Button, Input } from "@/components/ui";
import { useT } from "@/lib/i18n";

type State =
  | { kind: "loading" }
  | { kind: "invalid"; reason: string }
  | {
      kind: "ready";
      email: string;
      tenantName: string;
      expiresAt: string;
    }
  | { kind: "done" };

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-surface-canvas">
          <div className="text-ui text-ink-tertiary">Lädt…</div>
        </div>
      }
    >
      <ResetPasswordInner />
    </Suspense>
  );
}

function ResetPasswordInner() {
  const t = useT();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [state, setState] = useState<State>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState({ kind: "invalid", reason: t("resetPw.noToken") });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await api.checkResetToken(token);
        if (cancelled) return;
        setState({
          kind: "ready",
          email: r.email,
          tenantName: r.tenantName,
          expiresAt: r.expiresAt,
        });
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : t("resetPw.invalidToken");
        setState({ kind: "invalid", reason: msg });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (password.length < 12) {
      setSubmitError(t("resetPw.minLength"));
      return;
    }
    if (password !== confirm) {
      setSubmitError(t("resetPw.mismatch"));
      return;
    }
    setPending(true);
    try {
      await api.resetPassword(token, password);
      setState({ kind: "done" });
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : t("resetPw.failed")
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

        {state.kind === "loading" && (
          <div className="text-center text-ui-sm text-ink-tertiary">{t("resetPw.checkingToken")}</div>
        )}

        {state.kind === "invalid" && (
          <div className="bg-surface-raised border border-line-subtle rounded-md p-7 shadow-elev-2 space-y-4">
            <h1 className="text-display-sm text-ink-primary font-medium">{t("resetPw.invalidTitle")}</h1>
            <p className="text-ui-sm text-ink-secondary leading-relaxed">
              {t("resetPw.invalidDesc")}
            </p>
            <p className="text-ui-sm text-ink-tertiary">{t("resetPw.requestNewIntro")}</p>
            <Link
              href="/auth/forgot-password"
              className="inline-block text-ui-sm text-accent hover:underline"
            >{t("resetPw.requestNewLink")}</Link>
          </div>
        )}

        {state.kind === "ready" && (
          <form
            onSubmit={submit}
            className="space-y-5 bg-surface-raised border border-line-subtle rounded-md p-7 shadow-elev-2"
          >
            <header className="space-y-1.5">
              <h1 className="text-display-sm text-ink-primary font-medium">{t("resetPw.setNewTitle")}</h1>
              <p className="text-ui-sm text-ink-tertiary">
                {t("resetPw.forStudio", { email: state.email, tenant: state.tenantName })}
              </p>
            </header>

            <div className="space-y-1.5">
              <label
                htmlFor="password"
                className="text-ui-sm font-medium text-ink-primary block"
              >{t("resetPw.newPassword")}</label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("resetPw.minPlaceholder")}
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="confirm"
                className="text-ui-sm font-medium text-ink-primary block"
              >{t("resetPw.confirmPassword")}</label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>

            {submitError && (
              <div
                role="alert"
                className="text-ui-sm text-semantic-danger bg-semantic-danger/10 border border-semantic-danger/30 rounded-sm px-3 py-2"
              >
                {submitError}
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={pending || !password || !confirm}
              className="w-full"
            >
              {pending ? t("resetPw.setting") : t("resetPw.setPassword")}
            </Button>
          </form>
        )}

        {state.kind === "done" && (
          <div className="bg-surface-raised border border-line-subtle rounded-md p-7 shadow-elev-2 space-y-4">
            <h1 className="text-display-sm text-ink-primary font-medium">{t("resetPw.doneTitle")}</h1>
            <p className="text-ui-sm text-ink-secondary leading-relaxed">
              {t("resetPw.doneDesc")}
            </p>
            <Link
              href="/login"
              className="inline-block text-ui-sm text-accent hover:underline"
            >{t("resetPw.toLogin")}</Link>
          </div>
        )}
      </div>
    </main>
  );
}
