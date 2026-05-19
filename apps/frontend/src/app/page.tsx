/**
 * Lumio — Landing / Status Page
 *
 * Im Pre-Alpha-Stadium nur Statusseite. Wird später durch echte Login-Seite
 * (single-Mode) oder Marketing-Seite (multi-Mode) ersetzt.
 */
import Link from "next/link";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const mode = process.env.NEXT_PUBLIC_DEPLOYMENT_MODE ?? "single";

export default function HomePage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8 bg-surface-canvas">
      {/* Dezenter Gradient wie auf der Login-Page */}
      <div
        aria-hidden
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, rgba(245,158,11,0.06) 0%, transparent 70%)",
        }}
      />

      <div className="relative max-w-xl w-full space-y-8 animate-fade-in">
        <header className="space-y-3">
          <div className="text-ui-xs font-medium text-accent uppercase tracking-[0.15em]">
            Lumio · Pre-Alpha
          </div>
          <h1 className="text-display-xl font-medium tracking-tight text-ink-primary">
            Foto- & Video-Sharing.
            <br />
            <span className="text-ink-secondary">Self-hosted.</span>
          </h1>
          <p className="text-ui-lg text-ink-tertiary leading-relaxed">
            Eine schnelle, datenschutzfreundliche Plattform für Fotograf:innen
            zum Teilen, Proofing und Ausliefern von Shootings.
          </p>
        </header>

        <div className="rounded-md border border-line-subtle bg-surface-raised p-5 space-y-3">
          <div className="text-ui-sm font-medium text-ink-secondary">
            System-Status
          </div>
          <dl className="text-ui space-y-1.5">
            <div className="flex justify-between items-center">
              <dt className="text-ink-tertiary">Deployment-Modus</dt>
              <dd className="font-mono text-ui-sm">{mode}</dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-ink-tertiary">API</dt>
              <dd className="font-mono text-ui-xs">{apiUrl}</dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-ink-tertiary">Version</dt>
              <dd className="font-mono text-ui-sm">0.1.0</dd>
            </div>
          </dl>
        </div>

        <nav className="flex gap-2 text-ui">
          <Link
            href="/login"
            className="inline-flex items-center justify-center font-medium h-9 px-4 rounded bg-accent text-accent-contrast hover:bg-accent-hover transition-colors duration-motion"
          >
            Studio Login
          </Link>
          <Link
            href={`${apiUrl}/health`}
            className="inline-flex items-center justify-center font-medium h-9 px-4 rounded bg-surface-raised text-ink-primary border border-line-subtle hover:border-line-strong hover:bg-surface-overlay transition-colors duration-motion"
          >
            API Health
          </Link>
          <a
            href="https://forgejo.thiel.tools/thiel/lumio"
            className="inline-flex items-center justify-center font-medium h-9 px-4 rounded bg-surface-raised text-ink-primary border border-line-subtle hover:border-line-strong hover:bg-surface-overlay transition-colors duration-motion"
          >
            Source
          </a>
        </nav>

        <footer className="text-ui-xs text-ink-tertiary pt-8 border-t border-line-subtle">
          Self-hosted on your terms. Licensed under AGPL-3.0.
        </footer>
      </div>
    </main>
  );
}
