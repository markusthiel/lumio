"use client";

/**
 * Lumio — Studio Login
 *
 * Drei Layoutmodi je nach verfügbarem Tenant-Branding:
 *
 *   1. UNBRANDED (single-Mode oder Apex ohne Tenant)
 *      Klassisches zentriertes Layout mit Lumio-Brand. Eine schlanke
 *      Form-Box auf dezentem Akzent-Gradient.
 *
 *   2. BRANDED-FORM (Tenant identifiziert, aber kein Hero-Bild)
 *      Zentrierte Form mit Tenant-Logo + Greeting darüber. Akzentfarbe
 *      ersetzt den Default-Orange für Buttons + Fokus-Ringe.
 *
 *   3. BRANDED-HERO (Tenant + loginBackgroundUrl)
 *      Split-Screen: Hero-Bild links (50% Desktop) mit Logo + Greeting
 *      als Overlay, Login-Form rechts. Mobile: gestapelt mit kompakter
 *      Hero-Sektion oben.
 *
 * Branding wird via /auth/tenant-context geladen. Während des Ladens
 * zeigen wir das unbranded Layout (kein Skelett, vermeidet Flash).
 * Sobald Branding eingetrudelt ist, wechselt das Layout sanft via
 * CSS-Transition.
 *
 * Sicherheit: Greeting-Markdown läuft durch react-markdown mit
 * skipHtml=true (kein Raw-HTML, kein XSS-Risiko). loginGreeting ist
 * ein vom Tenant kontrolliertes Feld; Tenant-Owner ist eh Operator
 * der Galerie, deswegen vertrauenswürdig — aber skipHtml ist defense
 * in depth.
 *
 * Akzentfarbe: via CSS Custom Property --accent auf das Login-Root
 * gesetzt. Button-Komponente und Input-Focus nutzen die existierende
 * Accent-Variable automatisch.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LegalFooter } from "@/components/LegalFooter";
import { startAuthentication } from "@simplewebauthn/browser";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Button, Input } from "@/components/ui";

const MODE = process.env.NEXT_PUBLIC_DEPLOYMENT_MODE ?? "single";

type Stage =
  | { kind: "credentials" }
  | {
      kind: "2fa";
      challenge: string;
      hasTotp: boolean;
      hasWebauthn: boolean;
    }
  | {
      kind: "tenant-select";
      tenants: { slug: string; name: string }[];
    };

type TenantContext = {
  name: string;
  slug: string;
  status: "active" | "suspended" | "archived" | "pending_deletion";
};

type LoginBranding = {
  logoUrl: string | null;
  logoLightUrl: string | null;
  accentColor: string;
  loginBackgroundUrl: string | null;
  loginGreeting: string | null;
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

  const [tenantContext, setTenantContext] = useState<TenantContext | null>(
    null
  );
  const [branding, setBranding] = useState<LoginBranding | null>(null);
  const [layout, setLayout] = useState<
    "minimal" | "splash" | "side_by_side" | "centered"
  >("centered");

  // Tenant + Branding einmalig beim Mount laden. Falls Multi-Mode +
  // Apex-Domain ohne Tenant: zurück zum Picker. Andere Fälle: einfach
  // Defaults zeigen.
  //
  // Plus: wenn der User schon eine gueltige Session hat (z.B. Impersonate-
  // Redeem hat gerade einen Cookie gesetzt und der Browser hat ihn
  // akzeptiert, oder normaler User landet hier nach Reload), direkt
  // zu /studio durchwinken. Vorher tat das niemand — wer mit gueltiger
  // Session zu /login navigierte, sah trotzdem das Login-Formular.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 1. Schneller Check: gibt es eine aktive Session?
      try {
        const me = await api.me();
        if (cancelled) return;
        if (me?.user) {
          router.replace("/studio");
          return;
        }
      } catch {
        // Keine Session → normaler Login-Flow
      }

      // 2. Tenant-Context / Branding
      try {
        const r = await api.getTenantContext();
        if (cancelled) return;
        if (MODE !== "single" && !r.tenant) {
          router.replace("/");
          return;
        }
        if (r.tenant) {
          setTenantContext({
            name: r.tenant.name,
            slug: r.tenant.slug,
            status: r.tenant.status,
          });
          if (r.tenant.status !== "active") {
            setError(
              r.tenant.status === "archived"
                ? `Das Studio „${r.tenant.name}" wurde archiviert. Falls du Zugriff auf deine Daten brauchst, kontaktiere den Support.`
                : `Das Studio „${r.tenant.name}" ist aktuell stillgelegt.`
            );
          }
        }
        // Login-Erscheinungsbild (tenant-weit, entkoppelt vom Galerie-
        // Branding). Ein einzelnes Login-Logo deckt alle Flächen ab —
        // die Login-Seite ist durchgehend dunkel, also passt eine helle
        // Variante überall (Hero-Overlay wie Form-Card).
        if (r.login) {
          setBranding({
            logoUrl: r.login.logoUrl,
            logoLightUrl: r.login.logoUrl,
            accentColor: r.login.accentColor ?? "#f59e0b",
            loginBackgroundUrl: r.login.backgroundUrl,
            loginGreeting: r.login.greeting,
          });
          setLayout(r.login.layout);
        } else if (r.branding) {
          // Fallback (z.B. ältere API ohne login-Objekt). Hintergrund/
          // Begrüßung gibt es am Galerie-Branding nicht mehr — die
          // wohnen jetzt tenant-weit im login-Objekt.
          setBranding({
            logoUrl: r.branding.logoUrl,
            logoLightUrl: r.branding.logoLightUrl,
            accentColor: r.branding.accentColor,
            loginBackgroundUrl: null,
            loginGreeting: null,
          });
        }
      } catch {
        // Tenant-Context-Fehler ist nicht fatal — Login funktioniert
        // mit Default-Branding weiter.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function submitCredentials(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await api.login(email, password);
      if ("requiresTenantSelection" in res) {
        setStage({ kind: "tenant-select", tenants: res.tenants });
      } else if ("requiresTotp" in res) {
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
      setError(err instanceof Error ? err.message : "Anmeldung fehlgeschlagen");
    } finally {
      setPending(false);
    }
  }

  // Tenant aus dem Picker gewählt — erneuter Login mit explizitem Slug.
  // Das kann wieder in 2FA münden (wenn der gewählte Account 2FA hat).
  async function selectTenant(slug: string) {
    setError(null);
    setPending(true);
    try {
      const res = await api.login(email, password, slug);
      if ("requiresTenantSelection" in res) {
        // sollte nicht passieren (Slug ist eindeutig), aber defensiv:
        setStage({ kind: "tenant-select", tenants: res.tenants });
      } else if ("requiresTotp" in res) {
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
      setError(err instanceof Error ? err.message : "Anmeldung fehlgeschlagen");
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
      await api.loginTotp(stage.challenge, code);
      router.push("/studio");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verifikation fehlgeschlagen");
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
        setError(err instanceof Error ? err.message : "Passkey-Anmeldung fehlgeschlagen");
      }
    } finally {
      setPending(false);
    }
  }

  // Akzentfarbe als CSS-Var. Wenn das Default-Lumio-Orange aktiv ist,
  // ueberschreiben wir gar nichts (Standard-Akzent bleibt). Sonst:
  // CSS Custom Property setzen, die das Button/Focus-Styling via
  // bestehende CSS-Cascade aufgreift.
  const accentStyle: React.CSSProperties = branding?.accentColor
    ? ({ "--accent-hex": branding.accentColor } as React.CSSProperties)
    : {};

  // FORM (gemeinsam für alle Layout-Varianten)
  //
  // Optionaler Branding-Header oben: ENTWEDER Logo ODER Tenant-Name.
  // Wenn ein Logo da ist, ist es per Definition die Wordmark/Marke des
  // Studios — den Tenant-Namen darunter doppeln wirkt redundant
  // ("Samuel & Chiara" als Logo + "Samuel Rojahn" als interner Name
  // sieht zerfasert aus). Ohne Logo faellt der Header auf den Namen
  // als Text-Fallback zurueck. Im Apex-Single-Login (kein Tenant-
  // Kontext) entfaellt der Header komplett.
  //
  // Logo-Auswahl: logoLightUrl bevorzugt — die Form-Card sitzt auf
  // dem dunklen surface-raised, also brauchen schwarze Logos die
  // helle Variante.
  const brandLogo = branding?.logoLightUrl ?? branding?.logoUrl ?? null;
  const brandHeader = tenantContext && (
    <div className="flex flex-col items-center mb-6">
      {brandLogo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={brandLogo}
          alt={tenantContext.name}
          className="max-h-12 max-w-[220px] object-contain"
        />
      ) : (
        <div className="text-ui font-medium text-ink-primary">
          {tenantContext.name}
        </div>
      )}
    </div>
  );

  // Gestapelter Header (Logo zentriert + Begrüßung) für die Layouts
  // minimal / splash / centered.
  const stackedHeader = (
    <div className="text-center mb-8">
      {brandLogo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={brandLogo}
          alt={tenantContext?.name ?? ""}
          className="max-h-14 mx-auto object-contain"
        />
      ) : (
        <div className="text-display text-accent font-semibold tracking-tight">
          {tenantContext?.name ?? "Lumio"}
        </div>
      )}
      {branding?.loginGreeting && (
        <div className="mt-4 text-ui-sm text-ink-secondary prose-tight">
          <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
            {branding.loginGreeting}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );

  const formCard = (
    <div className="w-full max-w-sm">
      {stage.kind === "credentials" ? (
        <form
          onSubmit={submitCredentials}
          className="space-y-5 bg-surface-raised border border-line-subtle rounded-md p-7 shadow-elev-2"
        >
          <h1 className="text-display-sm text-ink-primary font-medium">
            {t("login.title")}
          </h1>

          <div className="space-y-1.5">
            <label
              htmlFor="email"
              className="text-ui-sm font-medium text-ink-primary block"
            >
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
            <label
              htmlFor="password"
              className="text-ui-sm font-medium text-ink-primary block"
            >
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
            disabled={pending || tenantContext?.status === "archived"}
            className="w-full"
          >
            {pending ? t("common.signingIn") : t("common.signIn")}
          </Button>

          <div className="text-center pt-1">
            <Link
              href="/auth/forgot-password"
              className="text-ui-xs text-ink-tertiary hover:text-ink-primary transition-colors duration-motion"
            >
              Passwort vergessen?
            </Link>
          </div>

          {MODE === "single" && (
            <p className="text-ui-xs text-ink-tertiary text-center pt-2">
              {t("login.cliHint")}{" "}
              <code className="font-mono bg-surface-sunken px-1 py-0.5 rounded-xs">
                npm run create-admin
              </code>
            </p>
          )}
        </form>
      ) : stage.kind === "tenant-select" ? (
        <div className="space-y-5 bg-surface-raised border border-line-subtle rounded-md p-7 shadow-elev-2">
          <header className="space-y-1.5">
            <h1 className="text-display-sm text-ink-primary font-medium">
              Studio wählen
            </h1>
            <p className="text-ui-sm text-ink-tertiary">
              Deine E-Mail-Adresse ist mit mehreren Studios verknüpft.
              Wähle aus, in welches du dich anmelden möchtest.
            </p>
          </header>

          <div className="space-y-2">
            {stage.tenants.map((tn) => (
              <button
                key={tn.slug}
                type="button"
                onClick={() => selectTenant(tn.slug)}
                disabled={pending}
                className="w-full text-left px-4 py-3 rounded-md border border-line-subtle hover:border-accent hover:bg-surface-sunken transition-colors duration-motion disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="text-ui-sm font-medium text-ink-primary">
                  {tn.name}
                </div>
                <div className="text-ui-xs text-ink-tertiary font-mono">
                  {tn.slug}
                </div>
              </button>
            ))}
          </div>

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
              setError(null);
            }}
            className="text-ui-xs text-ink-tertiary hover:text-ink-primary transition-colors duration-motion"
          >
            ← Zurück
          </button>
        </div>
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

          {stage.hasTotp && (
            <form onSubmit={submitTotp} className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="code"
                  className="text-ui-sm font-medium text-ink-primary block"
                >
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
  );

  const hasBg = !!branding?.loginBackgroundUrl;

  // SIDE-BY-SIDE — Split-Screen: Bild auf einer Hälfte, Form auf der anderen
  if (layout === "side_by_side" && hasBg && branding) {
    return (
      <main
        className="min-h-screen flex flex-col lg:flex-row bg-surface-canvas"
        style={accentStyle}
      >
        <BrandedHero
          imageUrl={branding.loginBackgroundUrl!}
          logoUrl={branding.logoUrl}
          logoLightUrl={branding.logoLightUrl}
          tenantName={tenantContext?.name}
          greeting={branding.loginGreeting}
        />
        <section className="flex-1 flex items-center justify-center p-6 lg:p-10 min-h-[60vh] lg:min-h-screen">
          <div className="w-full max-w-sm animate-fade-in">
            {formCard}
            <LegalFooter className="mt-8" />
          </div>
        </section>
      </main>
    );
  }

  // SPLASH — Vollbild-Bild, Form-Karte mittig als Overlay
  if (layout === "splash" && hasBg && branding) {
    return (
      <main
        className="min-h-screen flex items-center justify-center p-6 bg-surface-canvas relative"
        style={accentStyle}
      >
        <div
          aria-hidden
          className="fixed inset-0 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.6)), url(${cssEscapeUrl(
              branding.loginBackgroundUrl!
            )})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div className="relative w-full max-w-sm animate-fade-in">
          {stackedHeader}
          {formCard}
          <LegalFooter className="mt-8" />
        </div>
      </main>
    );
  }

  // CENTERED — Bild als ruhiger Hintergrund, Logo + Begrüßung prominent
  // über der Form
  if (layout === "centered" && hasBg && branding) {
    return (
      <main
        className="min-h-screen flex items-center justify-center p-6 bg-surface-canvas relative"
        style={accentStyle}
      >
        <div
          aria-hidden
          className="fixed inset-0 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(rgba(0,0,0,0.74), rgba(0,0,0,0.82)), url(${cssEscapeUrl(
              branding.loginBackgroundUrl!
            )})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div className="relative w-full max-w-sm animate-fade-in">
          {stackedHeader}
          {formCard}
          <LegalFooter className="mt-8" />
        </div>
      </main>
    );
  }

  // MINIMAL (und Fallback, wenn kein Hintergrundbild gesetzt ist) —
  // schlicht zentriert auf dezentem Akzent-Gradient.
  return (
    <main
      className="min-h-screen flex items-center justify-center p-6 bg-surface-canvas"
      style={accentStyle}
    >
      <div
        aria-hidden
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, rgba(245,158,11,0.06) 0%, transparent 70%)",
        }}
      />
      <div className="relative w-full max-w-sm animate-fade-in">
        {stackedHeader}
        {formCard}
        <LegalFooter className="mt-8" />
      </div>
    </main>
  );
}

// -----------------------------------------------------------------------------
// Branded Hero (linke Spalte im Split-Layout)
// -----------------------------------------------------------------------------
function BrandedHero({
  imageUrl,
  logoUrl,
  logoLightUrl,
  tenantName,
  greeting,
}: {
  imageUrl: string;
  logoUrl: string | null;
  logoLightUrl: string | null;
  tenantName: string | undefined;
  greeting: string | null;
}) {
  // Auf dem Hero-Overlay (immer dunkel) ist die helle Logo-Variante
  // praktisch immer besser lesbar. Fallback auf das Standard-Logo,
  // wenn keine helle Variante hochgeladen wurde.
  const heroLogo = logoLightUrl ?? logoUrl;
  return (
    <aside
      className="relative lg:flex-1 lg:min-h-screen min-h-[40vh] flex flex-col justify-between p-8 lg:p-12 text-white overflow-hidden"
      style={{
        backgroundImage: `linear-gradient(135deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.25) 60%, rgba(0,0,0,0.55) 100%), url(${cssEscapeUrl(imageUrl)})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {/* Logo oben */}
      <div>
        {heroLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={heroLogo}
            alt={tenantName ?? ""}
            className="max-h-12 max-w-[200px] object-contain drop-shadow-lg"
          />
        ) : tenantName ? (
          <div className="text-display-sm font-semibold tracking-tight drop-shadow-lg">
            {tenantName}
          </div>
        ) : null}
      </div>

      {/* Greeting unten */}
      {greeting && (
        <div className="max-w-md hero-prose text-white drop-shadow-md">
          <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
            {greeting}
          </ReactMarkdown>
        </div>
      )}

      <style jsx>{`
        .hero-prose :global(h1) {
          font-size: 2rem;
          line-height: 1.15;
          font-weight: 600;
          margin: 0 0 0.5rem 0;
          letter-spacing: -0.01em;
        }
        .hero-prose :global(h2) {
          font-size: 1.5rem;
          line-height: 1.2;
          font-weight: 600;
          margin: 0 0 0.5rem 0;
        }
        .hero-prose :global(p) {
          font-size: 1rem;
          line-height: 1.55;
          margin: 0.5rem 0;
          opacity: 0.92;
        }
        .hero-prose :global(strong) {
          font-weight: 600;
        }
        .hero-prose :global(a) {
          color: inherit;
          text-decoration: underline;
          text-underline-offset: 2px;
        }
      `}</style>
    </aside>
  );
}

/** Escaped Quotes/Parentheses in einer URL für den Einsatz in einem
 *  CSS-`url(...)`-Ausdruck. Die signierten S3-URLs enthalten oft
 *  Parameter mit '&', '=' und gelegentlich auch '(' — alle drei sind
 *  in CSS url(...) ohne Quoting problematisch. Wir setzen einfache
 *  Anführungszeichen drumherum und escapen interne ' falls vorhanden. */
function cssEscapeUrl(url: string): string {
  return `"${url.replace(/"/g, '\\"')}"`;
}
