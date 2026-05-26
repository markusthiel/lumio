/**
 * Lumio — Root-Route
 *
 * Modusabhängiger Einstieg:
 *
 *   Single-Mode (Self-Hoster, EIN Tenant pro Deployment):
 *     Permanenter Redirect auf /login. Es gibt keine Tenant-Auswahl,
 *     also keinen Sinn für eine Zwischenseite. Wer schon eingeloggt
 *     ist, wird vom /login auf /studio weitergeleitet (das übernimmt
 *     die LoginPage selbst).
 *
 *   Multi-Mode (Cloud, viele Tenants über Subdomains):
 *     - Auf der Apex-Domain (z.B. lumio-cloud.de) → Tenant-Picker
 *       (Form für Slug-Eingabe → Subdomain-Redirect)
 *     - Auf einer Tenant-Subdomain (z.B. stefan.lumio-cloud.de) →
 *       Redirect auf /login (Tenant ist durch Host bereits identifiziert)
 *
 *   Die Apex-vs-Subdomain-Unterscheidung passiert Server-Side über den
 *   Host-Header. Dadurch entsteht keine sichtbare Zwischenseite mit
 *   "lädt..."-Zustand.
 *
 * Pre-Alpha-Status-Anzeige ist hier raus. Wer den API-Health-Endpoint
 * sehen will, geht direkt zu /api/v1/health.
 */
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";

import { TenantPicker } from "@/components/landing/TenantPicker";

const MODE = process.env.NEXT_PUBLIC_DEPLOYMENT_MODE ?? "single";
const DOMAIN_BASE = process.env.NEXT_PUBLIC_DOMAIN_BASE ?? "";

export default async function HomePage() {
  // Single-Mode: direkt durchleiten.
  if (MODE === "single") {
    redirect("/login");
  }

  // Multi-Mode: Host inspizieren um zu entscheiden, ob wir auf der
  // Apex-Domain oder einer Tenant-Subdomain sind.
  //
  // Reservierte Subdomains (studio, api, admin, app, www) zaehlen
  // AUCH als Apex-aequivalent — sie sind keine Tenant-Subdomains.
  // 'studio.lumio-cloud.de' ist der zentrale Login-Host fuer alle
  // Tenants im Multi-Mode.
  const RESERVED_SUBDOMAINS = ["www", "studio", "api", "admin", "app"];
  const headerList = await headers();
  const host = (headerList.get("host") ?? "").split(":")[0].toLowerCase();
  const isApex =
    !DOMAIN_BASE ||
    host === DOMAIN_BASE ||
    RESERVED_SUBDOMAINS.some((sd) => host === `${sd}.${DOMAIN_BASE}`);

  // Tenant-Subdomain: Tenant ist via Host bekannt, direkt zu Login.
  if (!isApex) {
    redirect("/login");
  }

  // Apex: Tenant-Picker rendern. Form-Submit redirected auf Subdomain.
  return (
    <main className="min-h-screen flex items-center justify-center p-8 bg-surface-canvas">
      <div
        aria-hidden
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, rgba(245,158,11,0.06) 0%, transparent 70%)",
        }}
      />

      <div className="relative max-w-md w-full space-y-8 animate-fade-in">
        <header className="space-y-3">
          <div className="text-ui-xs font-medium text-accent uppercase tracking-[0.15em]">
            Lumio
          </div>
          <h1 className="text-display-xl font-medium tracking-tight text-ink-primary">
            Foto- &amp; Video-Sharing
            <br />
            <span className="text-ink-secondary">für Profis.</span>
          </h1>
          <p className="text-ui-lg text-ink-tertiary leading-relaxed">
            Schnelles Proofing, Auswahl und Auslieferung von Shootings.
          </p>
        </header>

        <TenantPicker domainBase={DOMAIN_BASE} />

        <div className="flex gap-4 text-ui-sm text-ink-tertiary justify-center">
          <Link
            href="https://lumio-app.de"
            className="hover:text-ink-secondary"
          >
            Self-hosted Version
          </Link>
          <span>·</span>
          <a
            href="https://forgejo.thiel.tools/thiel/lumio"
            className="hover:text-ink-secondary"
          >
            Quellcode
          </a>
        </div>
      </div>
    </main>
  );
}
