"use client";

/**
 * /auth/setup-password?token=...
 *
 * Landing-Page für neue Tenant-Owner, die via Einladungs-Mail kommen.
 * Drei Zustände:
 *
 *   - Token wird geprüft → Spinner
 *   - Token ungültig/abgelaufen → klare Fehlermeldung mit Kontakt-Hinweis
 *   - Token OK → Formular zum Setzen des Passworts; bei Submit
 *     direkt eingeloggt nach /studio springen
 *
 * Bewusst minimal — kein Branding, kein i18n, kein 2FA-Setup hier. Der
 * Onboarding-Flow ist "Passwort wählen, fertig". Spätere
 * Sicherheits-Setups (TOTP, Webauthn) macht der Owner aus dem Studio
 * heraus.
 */
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";

type CheckResult =
  | { state: "checking" }
  | {
      state: "ok";
      email: string;
      name: string | null;
      tenantName: string;
      expiresAt: string;
    }
  | { state: "invalid" }
  | { state: "tenant_inactive" }
  | { state: "no_token" };

// Next.js 16 verlangt einen <Suspense>-Boundary um useSearchParams() —
// sonst kann die Page nicht prerendert werden. Wir rendern den Loader
// extrem schlicht (ein dezentes "Lädt…"), weil die echte Page sowieso
// einen eigenen "checking"-State zeigt.
export default function SetupPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-surface-canvas">
          <div className="text-ui text-ink-tertiary">Lädt…</div>
        </div>
      }
    >
      <SetupPasswordInner />
    </Suspense>
  );
}

function SetupPasswordInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [check, setCheck] = useState<CheckResult>({ state: "checking" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setCheck({ state: "no_token" });
      return;
    }
    (async () => {
      try {
        const r = await api.checkSetupToken(token);
        setCheck({
          state: "ok",
          email: r.email,
          name: r.name,
          tenantName: r.tenantName,
          expiresAt: r.expiresAt,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        setCheck({
          state: msg.includes("tenant_inactive")
            ? "tenant_inactive"
            : "invalid",
        });
      }
    })();
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setSubmitError("Die beiden Passwörter stimmen nicht überein.");
      return;
    }
    if (password.length < 12) {
      setSubmitError("Mindestens 12 Zeichen.");
      return;
    }
    setBusy(true);
    setSubmitError(null);
    try {
      await api.setupPassword(token, password);
      router.replace("/studio");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Fehler";
      setSubmitError(
        msg.includes("invalid_or_expired")
          ? "Der Setup-Link ist abgelaufen oder wurde schon verwendet."
          : msg
      );
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-canvas px-4">
      <div className="w-full max-w-md">
        {check.state === "checking" && (
          <div className="text-center text-ui text-ink-tertiary">
            Setup-Link wird geprüft…
          </div>
        )}

        {check.state === "no_token" && (
          <Notice
            title="Kein Setup-Link"
            body="Diese Seite öffnet sich über den Link in deiner Einladungs-Mail."
          />
        )}

        {check.state === "invalid" && (
          <Notice
            title="Link ungültig oder abgelaufen"
            body="Der Setup-Link funktioniert nicht mehr. Bitte den Administrator um einen neuen Link."
          />
        )}

        {check.state === "tenant_inactive" && (
          <Notice
            title="Konto nicht verfügbar"
            body="Dein Studio ist momentan deaktiviert. Bitte wende dich an den Administrator."
          />
        )}

        {check.state === "ok" && (
          <form
            onSubmit={submit}
            className="rounded-md border border-line-strong bg-surface-raised p-6 space-y-4"
          >
            <div>
              <h1 className="text-ui-lg font-semibold text-ink-primary">
                Willkommen{check.name ? `, ${check.name}` : ""}
              </h1>
              <p className="text-ui-sm text-ink-tertiary mt-1">
                Setze dein Passwort, um dein Studio{" "}
                <span className="text-ink-secondary">„{check.tenantName}"</span>{" "}
                zu öffnen.
              </p>
              <p className="text-ui-xs text-ink-tertiary mt-2">
                Konto: {check.email}
              </p>
            </div>

            <label className="block">
              <span className="text-ui-sm text-ink-secondary">
                Neues Passwort
              </span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={12}
                autoComplete="new-password"
                autoFocus
                className="mt-1 w-full h-10 px-3 rounded bg-surface-sunken border border-line-subtle text-ui text-ink-primary focus:border-accent focus:outline-none"
              />
              <span className="block mt-1 text-ui-xs text-ink-tertiary">
                Mindestens 12 Zeichen.
              </span>
            </label>

            <label className="block">
              <span className="text-ui-sm text-ink-secondary">Bestätigen</span>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
                className="mt-1 w-full h-10 px-3 rounded bg-surface-sunken border border-line-subtle text-ui text-ink-primary focus:border-accent focus:outline-none"
              />
            </label>

            {submitError && (
              <div className="text-ui-sm text-semantic-danger">
                {submitError}
              </div>
            )}

            <button
              type="submit"
              disabled={busy || !password || !confirm}
              className="w-full h-10 rounded bg-accent text-accent-contrast font-medium hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-motion"
            >
              {busy ? "Wird gesetzt…" : "Passwort setzen & loslegen"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-line-strong bg-surface-raised p-6 text-center">
      <h1 className="text-ui-lg font-semibold text-ink-primary mb-2">
        {title}
      </h1>
      <p className="text-ui-sm text-ink-tertiary">{body}</p>
    </div>
  );
}
