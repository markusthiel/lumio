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
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useT } from "@/lib/i18n";
import { api } from "@/lib/api";
import { GlobalSearchModal } from "@/components/studio/GlobalSearchModal";
import { StorageBanner } from "@/components/studio/StorageBanner";
import { SubscriptionBanner } from "@/components/studio/SubscriptionBanner";
import { PreArchiveBanner } from "@/components/studio/PreArchiveBanner";
import { AnnouncementBanner } from "@/components/studio/AnnouncementBanner";
import {
  PendingDeletionBanner,
  useDeletionStatus,
} from "@/components/studio/DangerZone";

interface NavItem {
  href: string;
  labelKey: string;
  fallback: string;
  // Matcher: aktiv wenn pathname mit prefix anfängt
  prefix: string;
  /** Wenn gesetzt: nur User mit einer dieser Rollen sehen den Eintrag.
   *  Member-User sehen z.B. Team gar nicht — sie sind keine Studio-
   *  Verwaltung. Wenn das Feld fehlt: fuer alle eingeloggten User
   *  sichtbar (Default). */
  rolesAllowed?: Array<"owner" | "admin" | "member">;
  /** Wenn gesetzt: nur sichtbar wenn dieser Feature-Flag fuer den Tenant
   *  aktiv ist (aus /auth/me.features). */
  requiresFeature?: string;
}

const NAV: NavItem[] = [
  { href: "/studio",            labelKey: "nav.galleries",  fallback: "Galerien",      prefix: "/studio" },
  { href: "/studio/analytics",  labelKey: "nav.analytics",  fallback: "Analytics",     prefix: "/studio/analytics",  rolesAllowed: ["owner", "admin"], requiresFeature: "advanced_analytics" },
  { href: "/studio/team",       labelKey: "nav.team",       fallback: "Team",          prefix: "/studio/team",       rolesAllowed: ["owner", "admin"] },
  { href: "/studio/brandings",  labelKey: "nav.brandings",  fallback: "Branding",      prefix: "/studio/brandings" },
  { href: "/studio/templates",  labelKey: "nav.templates",  fallback: "Templates",     prefix: "/studio/templates" },
  { href: "/studio/tags",       labelKey: "nav.tags",       fallback: "Tags",          prefix: "/studio/tags" },
  { href: "/studio/print-shop", labelKey: "nav.printShop",  fallback: "Print-Shop",    prefix: "/studio/print-shop", rolesAllowed: ["owner", "admin"], requiresFeature: "print_shop" },
  { href: "/studio/webhooks",   labelKey: "nav.webhooks",   fallback: "Webhooks",      prefix: "/studio/webhooks" },
  { href: "/studio/audit",      labelKey: "nav.audit",      fallback: "Audit",         prefix: "/studio/audit" },
  { href: "/studio/exports",    labelKey: "nav.exports",    fallback: "Datenexport",   prefix: "/studio/exports" },
  { href: "/studio/avv",        labelKey: "nav.dpa",        fallback: "AV-Vertrag",    prefix: "/studio/avv",        rolesAllowed: ["owner", "admin"] },
  { href: "/studio/billing",    labelKey: "nav.billing",    fallback: "Plan & Speicher", prefix: "/studio/billing" },
  { href: "/studio/account",    labelKey: "nav.account",    fallback: "Mein Konto",    prefix: "/studio/account" },
  { href: "/studio/settings",   labelKey: "nav.settings",   fallback: "Einstellungen", prefix: "/studio/settings" },
];

export function StudioShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [userRole, setUserRole] = useState<"owner" | "admin" | "member" | null>(
    null
  );
  const t = useT();

  // Deletion-Status global tracken — wird oben im Banner angezeigt
  // und nach Cancel-Click reloaded.
  const { status: deletionStatus, reload: reloadDeletionStatus } =
    useDeletionStatus();

  // Rolle einmal beim Mount laden — bestimmt welche Nav-Eintraege
  // sichtbar sind. Solange der Wert null ist, zeigen wir nur die
  // alltime-Eintraege (ohne rolesAllowed-Filter); sobald die Rolle
  // bekannt ist, kommt der Filter dazu. So vermeiden wir einen
  // Flicker fuer Owner/Admin.
  const [impersonation, setImpersonation] = useState<{
    bySuperAdminEmail: string;
    bySuperAdminName: string | null;
    expiresAt: string;
  } | null>(null);
  const [features, setFeatures] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.me();
        if (cancelled) return;
        setUserRole(r.user.role);
        setImpersonation(r.impersonation);
        setFeatures(r.features ?? []);
      } catch {
        setUserRole("member");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Nav nach Rolle UND Feature-Flag filtern. Bevor Rolle/Features
  // geladen sind, zeigen wir alle Eintraege ohne Restrictions; sobald
  // beide bekannt sind, kommen rolesAllowed/requiresFeature dazu.
  const visibleNav = NAV.filter((item) => {
    if (item.rolesAllowed) {
      if (!userRole) return false;
      if (!item.rolesAllowed.includes(userRole)) return false;
    }
    if (item.requiresFeature) {
      if (!features.includes(item.requiresFeature)) return false;
    }
    return true;
  });

  // Cmd/Ctrl + K öffnet die globale Suche, egal wo der Fokus ist.
  // / kann später als zusätzlicher Trigger dazukommen, aber riskiert
  // Inputs zu kapern — Cmd/Ctrl+K ist standardisiert (Linear, Slack,
  // Notion, GitHub) und kollidiert nie.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-surface-canvas text-ink-primary">
      {impersonation && <ImpersonationBanner imp={impersonation} />}
      <AnnouncementBanner />
      <div className="flex-1 flex">
      <GlobalSearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
      />
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

        {/* Search-Trigger */}
        <div className="px-2 pt-3 pb-1">
          <button
            type="button"
            onClick={() => {
              setSearchOpen(true);
              setMobileOpen(false);
            }}
            className="w-full h-8 flex items-center gap-2 px-2.5 rounded bg-surface-canvas hover:bg-surface-overlay border border-line-subtle hover:border-line-strong text-ink-tertiary hover:text-ink-secondary transition-colors duration-motion text-ui-sm"
          >
            <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <span className="flex-1 text-left">{t("studio.searchTrigger")}</span>
            <kbd className="text-[10px] font-mono px-1 py-0.5 bg-surface-sunken border border-line-subtle rounded-xs">⌘K</kbd>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 overflow-y-auto">
          <ul className="space-y-0.5">
            {visibleNav.map((item) => (
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
        <PendingDeletionBanner
          status={deletionStatus}
          onCancelled={() => void reloadDeletionStatus()}
        />
        <PreArchiveBanner />
        <SubscriptionBanner />
        <StorageBanner />
        {children}
      </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Impersonate-Banner
// ---------------------------------------------------------------------------
// Permanent oben sichtbar wenn die Session durch einen Super-Admin gestartet
// wurde. Datenschutz-Transparenz und visueller Reminder dass das KEIN
// echter User-Login ist. Tooltip mit Countdown bis Session-Ablauf.
function ImpersonationBanner({
  imp,
}: {
  imp: {
    bySuperAdminEmail: string;
    bySuperAdminName: string | null;
    expiresAt: string;
  };
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const remainingMs = Math.max(0, new Date(imp.expiresAt).getTime() - now);
  const remainingMin = Math.floor(remainingMs / 60000);

  async function endImpersonation() {
    try {
      await api.logout();
    } finally {
      // Zurueck zur Super-Admin-UI (anderer Tab/Subdomain)
      window.location.href = "/";
    }
  }

  return (
    <div className="bg-semantic-warning text-black px-4 py-2 text-sm flex items-center justify-center gap-3 flex-wrap">
      <span>
        <strong>Impersonate-Modus</strong> — du bist hier als Support eingeloggt
        durch <strong>{imp.bySuperAdminName ?? imp.bySuperAdminEmail}</strong>.
        Alle Aktionen werden protokolliert.
      </span>
      <span className="text-xs opacity-80">
        ({remainingMin} min verbleibend)
      </span>
      <button
        type="button"
        onClick={endImpersonation}
        className="text-xs px-2 py-0.5 rounded bg-black/15 hover:bg-black/25 font-medium"
      >
        Beenden
      </button>
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
