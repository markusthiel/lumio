"use client";

/**
 * StudioShell — das Skelett aller Studio-Pages.
 *
 * Layout:
 *   ┌──────────────┬───────────────────────────────────┐
 *   │              │                                   │
 *   │   Sidebar    │           Main Content            │
 *   │   (220px)    │                                   │
 *   │              │                                   │
 *   └──────────────┴───────────────────────────────────┘
 *
 * Mobile (<sm): Sidebar collapsed → Hamburger oben links, slide-over.
 *
 * Sidebar-Items werden über die i18n-Strings gerendert. Active-State
 * basiert auf usePathname() — wir matchen den Prefix, damit auch
 * Sub-Routes (z.B. /studio/galleries/<id>) den Galerien-Eintrag
 * highlighten.
 */
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useT } from "@/lib/i18n";
import { api } from "@/lib/api";

interface NavItem {
  href: string;
  labelKey: string;
  fallback: string;
  // Matcher: aktiv wenn pathname mit prefix anfängt
  prefix: string;
}

const NAV: NavItem[] = [
  { href: "/studio",            labelKey: "nav.galleries",  fallback: "Galerien",      prefix: "/studio" },
  { href: "/studio/brandings",  labelKey: "nav.brandings",  fallback: "Branding",      prefix: "/studio/brandings" },
  { href: "/studio/templates",  labelKey: "nav.templates",  fallback: "Templates",     prefix: "/studio/templates" },
  { href: "/studio/audit",      labelKey: "nav.audit",      fallback: "Audit",         prefix: "/studio/audit" },
  { href: "/studio/settings",   labelKey: "nav.settings",   fallback: "Einstellungen", prefix: "/studio/settings" },
];

export function StudioShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen flex bg-surface-canvas text-ink-primary">
      {/* Mobile Hamburger */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Menü öffnen"
        className="fixed top-3 left-3 z-30 sm:hidden h-9 w-9 rounded bg-surface-raised border border-line-subtle flex items-center justify-center text-ink-primary"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M2 4h12M2 8h12M2 12h12" />
        </svg>
      </button>

      {/* Sidebar — fixed auf Desktop, Slide-over auf Mobile */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[220px] bg-surface-sunken border-r border-line-subtle flex flex-col transition-transform duration-motion ease-out sm:translate-x-0 sm:static sm:flex-shrink-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Logo / Brand */}
        <div className="h-14 flex items-center px-5 border-b border-line-subtle">
          <Link
            href="/studio"
            className="flex items-center gap-2 text-ink-primary"
            onClick={() => setMobileOpen(false)}
          >
            <span className="text-accent text-ui-md font-semibold tracking-tight">
              Lumio
            </span>
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 overflow-y-auto">
          <ul className="space-y-0.5">
            {NAV.map((item) => (
              <SidebarLink
                key={item.href}
                item={item}
                onNavigate={() => setMobileOpen(false)}
              />
            ))}
          </ul>
        </nav>

        {/* Footer mit Logout */}
        <SidebarFooter onNavigate={() => setMobileOpen(false)} />
      </aside>

      {/* Overlay zum Schließen */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Menü schließen"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 sm:hidden"
        />
      )}

      {/* Main Area */}
      <main className="flex-1 min-w-0 min-h-screen">
        {children}
      </main>
    </div>
  );
}

function SidebarLink({
  item,
  onNavigate,
}: {
  item: NavItem;
  onNavigate: () => void;
}) {
  const t = useT();
  const pathname = usePathname();
  // /studio matched nur exakt UND als /studio/<id>; Subpages (brandings,
  // templates, …) sind aber separat. Wir machen das simpel: exakter
  // Match für /studio (sonst würden alle Items als aktiv gelten), und
  // startsWith für die Subpages.
  const active =
    item.prefix === "/studio"
      ? pathname === "/studio" ||
        /^\/studio\/[^/]+$/.test(pathname) ||
        false
      : pathname.startsWith(item.prefix);

  // i18n-Lookup mit Fallback
  const label = (() => {
    const translated = t(item.labelKey);
    return translated === item.labelKey ? item.fallback : translated;
  })();

  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        className={`flex items-center h-8 px-2.5 rounded text-ui transition-colors duration-motion ease-out ${
          active
            ? "bg-accent/12 text-ink-primary"
            : "text-ink-secondary hover:text-ink-primary hover:bg-surface-raised"
        }`}
      >
        {label}
      </Link>
    </li>
  );
}

function SidebarFooter({ onNavigate }: { onNavigate: () => void }) {
  const router = useRouter();
  const t = useT();

  async function handleLogout() {
    try {
      await api.logout();
    } finally {
      onNavigate();
      router.replace("/login");
    }
  }

  const logoutLabel = (() => {
    const translated = t("nav.logout");
    return translated === "nav.logout" ? "Abmelden" : translated;
  })();

  return (
    <div className="p-2 border-t border-line-subtle">
      <button
        type="button"
        onClick={handleLogout}
        className="w-full flex items-center h-8 px-2.5 rounded text-ui text-ink-tertiary hover:text-ink-primary hover:bg-surface-raised transition-colors duration-motion ease-out"
      >
        {logoutLabel}
      </button>
    </div>
  );
}
