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
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-xl w-full space-y-6">
        <header className="space-y-2">
          <div className="text-sm font-medium text-brand-accent uppercase tracking-wider">
            Lumio · Pre-Alpha
          </div>
          <h1 className="text-4xl font-semibold tracking-tight">
            Foto- & Video-Sharing.
            <br />
            Self-hosted.
          </h1>
          <p className="text-slate-600 text-lg">
            Eine schnelle, datenschutzfreundliche Plattform für Fotograf:innen
            zum Teilen, Proofing und Ausliefern von Shootings.
          </p>
        </header>

        <div className="rounded-lg border border-slate-200 p-5 space-y-3 bg-slate-50">
          <div className="text-sm font-medium text-slate-700">System-Status</div>
          <dl className="text-sm space-y-1.5">
            <div className="flex justify-between">
              <dt className="text-slate-500">Deployment-Modus</dt>
              <dd className="font-mono">{mode}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">API</dt>
              <dd className="font-mono text-xs">{apiUrl}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Version</dt>
              <dd className="font-mono">0.1.0</dd>
            </div>
          </dl>
        </div>

        <nav className="flex gap-3 text-sm">
          <Link
            href="/login"
            className="px-4 py-2 rounded-md bg-slate-900 text-white hover:bg-slate-800 transition"
          >
            Studio Login
          </Link>
          <Link
            href={`${apiUrl}/health`}
            className="px-4 py-2 rounded-md border border-slate-300 hover:bg-slate-100 transition"
          >
            API Health
          </Link>
          <a
            href="https://forgejo.thiel.tools/thiel/lumio"
            className="px-4 py-2 rounded-md border border-slate-300 hover:bg-slate-100 transition"
          >
            Source
          </a>
        </nav>

        <footer className="text-xs text-slate-400 pt-8 border-t border-slate-100">
          Self-hosted on your terms. Licensed under AGPL-3.0.
        </footer>
      </div>
    </main>
  );
}
