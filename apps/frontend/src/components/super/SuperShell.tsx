"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";

interface Admin {
  id: string;
  email: string;
  displayName: string;
}

/**
 * Layout-Wrapper für /super/* Pages. Lädt den eingeloggten Super-Admin,
 * redirected sonst zu /super/login.
 *
 * Layout:
 *  - Desktop (>=sm): Sidebar permanent links sichtbar
 *  - Mobile (<sm): Sidebar als Slide-over-Drawer, getriggert durch
 *    Hamburger-Button oben links. Schliessbar via Overlay-Click oder
 *    Navigation. Pattern wie im StudioShell — gleiches z-Index-System.
 */
export function SuperShell({ children }: { children: React.ReactNode }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [loading, setLoading] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.superMe();
        setAdmin(r.admin);
      } catch {
        router.replace("/super/login");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  // Drawer schliessen bei Route-Wechsel
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-canvas">
        <div className="text-ui text-ink-tertiary">Lädt…</div>
      </div>
    );
  }
  if (!admin) return null;

  return (
    <div className="min-h-screen flex bg-surface-canvas text-ink-primary">
      {/* Mobile Hamburger — fixed oben links, nur <sm sichtbar */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label={t("nav.menuOpen")}
        className="fixed top-3 left-3 z-30 sm:hidden h-9 w-9 rounded bg-surface-raised border border-line-subtle flex items-center justify-center text-ink-primary shadow"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            d="M2 4h12M2 8h12M2 12h12"
          />
        </svg>
      </button>

      {/* Sidebar — fixed slide-over auf Mobile, statisch auf Desktop */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[220px] border-r border-line-subtle bg-surface-raised flex flex-col transition-transform duration-motion ease-out sm:translate-x-0 sm:static sm:flex-shrink-0 sm:w-56 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="h-14 flex items-center justify-between px-5 border-b border-line-subtle">
          <span className="text-accent text-ui-md font-semibold tracking-tight">
            Lumio · Super
          </span>
          {/* Schliessen-Knopf nur auf Mobile */}
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label={t("nav.menuClose")}
            className="sm:hidden h-7 w-7 -mr-1 flex items-center justify-center text-ink-tertiary hover:text-ink-primary"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                d="M2 2l10 10M12 2L2 12"
              />
            </svg>
          </button>
        </div>

        <nav className="flex-1 py-2 overflow-y-auto">
          <SidebarLink
            href="/super"
            active={pathname === "/super"}
            label={t("super.navOverview")}
          />
          <SidebarLink
            href="/super/tenants"
            active={pathname?.startsWith("/super/tenants") ?? false}
            label={t("super.navTenants")}
          />
          <SidebarLink
            href="/super/users"
            active={pathname?.startsWith("/super/users") ?? false}
            label={t("super.navUsers")}
          />
          <SidebarLink
            href="/super/storage"
            active={pathname?.startsWith("/super/storage") ?? false}
            label={t("super.navStorage")}
          />
          <SidebarLink
            href="/super/mrr"
            active={pathname?.startsWith("/super/mrr") ?? false}
            label={t("super.navMrr")}
          />
          <SidebarLink
            href="/super/announcements"
            active={pathname?.startsWith("/super/announcements") ?? false}
            label={t("super.navBanner")}
          />
          <SidebarLink
            href="/super/broadcasts"
            active={pathname?.startsWith("/super/broadcasts") ?? false}
            label={t("super.navBroadcasts")}
          />
          <SidebarLink
            href="/super/print-providers"
            active={pathname?.startsWith("/super/print-providers") ?? false}
            label={t("super.navPrintProvider")}
          />
          <SidebarLink
            href="/super/audit"
            active={pathname?.startsWith("/super/audit") ?? false}
            label={t("super.navAudit")}
          />
          <SidebarLink
            href="/super/system"
            active={pathname?.startsWith("/super/system") ?? false}
            label={t("super.navSystem")}
          />
          <SidebarLink
            href="/super/csp"
            active={pathname?.startsWith("/super/csp") ?? false}
            label={t("super.navCsp")}
          />
          <SidebarLink
            href="/super/plan-catalog"
            active={pathname?.startsWith("/super/plan-catalog") ?? false}
            label={t("super.navPlanCatalog")}
          />
          <SidebarLink
            href="/super/mail-log"
            active={pathname?.startsWith("/super/mail-log") ?? false}
            label={t("super.navMailLog")}
          />
          <SidebarLink
            href="/super/jobs"
            active={pathname?.startsWith("/super/jobs") ?? false}
            label={t("super.navJobs")}
          />
          <SidebarLink
            href="/super/security"
            active={pathname?.startsWith("/super/security") ?? false}
            label={t("super.navSecurity")}
          />
        </nav>

        <div className="border-t border-line-subtle p-4">
          <div className="text-ui-xs text-ink-tertiary mb-1">
            angemeldet als
          </div>
          <div className="text-ui-sm text-ink-secondary truncate">
            {admin.displayName}
          </div>
          <div className="text-ui-xs text-ink-tertiary truncate">
            {admin.email}
          </div>
          <button
            type="button"
            onClick={async () => {
              await api.superLogout().catch(() => {});
              router.replace("/super/login");
            }}
            className="mt-3 text-ui-xs text-ink-tertiary hover:text-ink-secondary transition-colors duration-motion"
          >
            Abmelden
          </button>
        </div>
      </aside>

      {/* Overlay zum Schliessen */}
      {mobileOpen && (
        <button
          type="button"
          aria-label={t("nav.menuClose")}
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 sm:hidden"
        />
      )}

      {/* Main — auf Mobile bleibt oben Platz fuer den Hamburger.
          pt-14 sm:pt-0: gibt der Hamburger-Button auf Mobile etwas
          Freiraum oben damit er nicht mit dem Page-Titel kollidiert. */}
      <main className="flex-1 min-w-0 overflow-auto pt-14 sm:pt-0">
        {children}
      </main>
    </div>
  );
}

function SidebarLink({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={`block px-5 py-2 text-ui-sm transition-colors duration-motion ${
        active
          ? "bg-accent/10 text-ink-primary border-l-2 border-accent"
          : "text-ink-secondary hover:text-ink-primary hover:bg-surface-overlay"
      }`}
    >
      {label}
    </Link>
  );
}
