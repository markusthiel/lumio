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
import { LegalFooter } from "@/components/LegalFooter";
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

type NavIconName =
  | "galleries"
  | "analytics"
  | "print"
  | "design"
  | "settings"
  | "account";

/** Schlichte Linien-Icons für die Sidebar — gleicher Stil wie das
 *  Such-Icon (24er viewBox, currentColor, stroke). */
function NavIcon({ name }: { name: NavIconName }) {
  const common = {
    className: "w-[18px] h-[18px] shrink-0",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "galleries":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-4.5-4.5L6 21" />
        </svg>
      );
    case "analytics":
      return (
        <svg {...common}>
          <path d="M3 3v18h18" />
          <rect x="7" y="12" width="3" height="5" />
          <rect x="13" y="8" width="3" height="9" />
        </svg>
      );
    case "print":
      return (
        <svg {...common}>
          <path d="M6 9V3h12v6" />
          <path d="M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
          <rect x="6" y="14" width="12" height="7" rx="1" />
        </svg>
      );
    case "design":
      return (
        <svg {...common}>
          <path d="m14.5 3.5 6 6L8 22l-5 1 1-5z" />
          <path d="m12.5 5.5 6 6" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.81.66 1.65 1.65 0 0 0-1 1.51V22a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8 20.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 3.6 15a1.65 1.65 0 0 0-1.51-1H2a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 3.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8 4.6h.09A1.65 1.65 0 0 0 9 3.09V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 14 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 20.4 9v.09A1.65 1.65 0 0 0 22 10a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
    case "account":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      );
  }
}

interface NavItem {
  href: string;
  labelKey: string;
  fallback: string;
  /** Icon-Key für die Sidebar (siehe NavIcon). */
  icon: NavIconName;
  // Matcher: aktiv wenn pathname mit prefix anfängt
  prefix: string;
  /** Sammeleintrag: aktiv, wenn der Pfad mit einem dieser Prefixe
   *  beginnt (gruppiert mehrere Unterseiten unter einem Menüpunkt;
   *  die Unterseiten erscheinen als Tab-Leiste via StudioSubTabs). */
  matchPrefixes?: string[];
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
  { href: "/studio",            labelKey: "nav.galleries",  fallback: "Galerien",      icon: "galleries",  prefix: "/studio" },
  { href: "/studio/analytics",  labelKey: "nav.analytics",  fallback: "Analytics",     icon: "analytics",  prefix: "/studio/analytics",  rolesAllowed: ["owner", "admin"], requiresFeature: "advanced_analytics" },
  { href: "/studio/print-shop", labelKey: "nav.printShop",  fallback: "Print-Shop",    icon: "print",      prefix: "/studio/print-shop", rolesAllowed: ["owner", "admin"], requiresFeature: "print_shop" },
  // Sammeleintrag „Gestaltung" → Tabs: Branding · Templates · Tags
  { href: "/studio/brandings",  labelKey: "nav.design",     fallback: "Gestaltung",    icon: "design",     prefix: "/studio/brandings",
    matchPrefixes: ["/studio/brandings", "/studio/templates", "/studio/tags"] },
  // Sammeleintrag „Einstellungen" → Tabs: Allgemein · Team · Integrationen · Datenexport · Audit · AV-Vertrag
  { href: "/studio/settings",   labelKey: "nav.settings",   fallback: "Einstellungen", icon: "settings",   prefix: "/studio/settings",
    matchPrefixes: ["/studio/settings", "/studio/team", "/studio/webhooks", "/studio/exports", "/studio/audit", "/studio/avv"] },
  // Sammeleintrag „Konto" → Tabs: Mein Konto · Plan & Speicher
  { href: "/studio/account",    labelKey: "nav.accountGroup", fallback: "Konto",       icon: "account",    prefix: "/studio/account",
    matchPrefixes: ["/studio/account", "/studio/billing"] },
];

// Top-Level-Segmente, die KEINE Galerie sind — damit der „Galerien"-
// Eintrag bei /studio/<bekanntes-segment> nicht fälschlich aktiv wird.
const RESERVED_SEGMENTS = new Set([
  "analytics", "print-shop", "brandings", "templates", "tags",
  "settings", "team", "webhooks", "exports", "audit", "avv",
  "account", "billing",
]);

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
  // Sammeleintrag (Gestaltung/Einstellungen/Konto): aktiv, sobald der
  // Pfad zu einer seiner Unterseiten gehört. Galerien: exakt /studio
  // oder /studio/<galerie-id> — aber nicht bei reservierten Segmenten
  // (settings, team, …), die zu anderen Menüpunkten gehören.
  const active = (() => {
    if (item.matchPrefixes) {
      return item.matchPrefixes.some(
        (p) => pathname === p || pathname.startsWith(p + "/")
      );
    }
    if (item.prefix === "/studio") {
      if (pathname === "/studio") return true;
      const m = pathname.match(/^\/studio\/([^/]+)/);
      return Boolean(m && !RESERVED_SEGMENTS.has(m[1]));
    }
    return pathname === item.prefix || pathname.startsWith(item.prefix + "/");
  })();

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
        aria-current={active ? "page" : undefined}
        className={`group relative flex items-center gap-2.5 h-9 pl-3 pr-2.5 rounded-md text-ui transition-colors duration-motion ease-out ${
          active
            ? "bg-accent/10 text-accent font-medium"
            : "text-ink-secondary hover:text-ink-primary hover:bg-surface-raised"
        }`}
      >
        {/* Vertikale Akzent-Leiste — das Pendant zur Tab-Unterlinie */}
        {active && (
          <span
            aria-hidden
            className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent"
          />
        )}
        <span
          className={
            active
              ? "text-accent"
              : "text-ink-tertiary group-hover:text-ink-secondary"
          }
        >
          <NavIcon name={item.icon} />
        </span>
        <span className="truncate">{label}</span>
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
    <div className="p-2 border-t border-line-subtle space-y-1.5">
      <button
        type="button"
        onClick={handleLogout}
        className="group w-full flex items-center gap-2.5 h-9 px-3 rounded-md text-ui text-ink-tertiary hover:text-ink-primary hover:bg-surface-raised transition-colors duration-motion ease-out"
      >
        <span className="text-ink-tertiary group-hover:text-ink-secondary">
          <svg
            className="w-[18px] h-[18px] shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </span>
        <span>{logoutLabel}</span>
      </button>
      <LegalFooter align="start" className="px-3 pb-0.5" />
    </div>
  );
}
