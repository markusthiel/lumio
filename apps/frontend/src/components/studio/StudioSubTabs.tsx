"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";

type Role = "owner" | "admin" | "member";

interface SubTab {
  href: string;
  label: string;
  /** Nur sichtbar für diese Rollen (Default: alle). */
  rolesAllowed?: Role[];
  /** Nur sichtbar wenn dieser Feature-Flag aktiv ist. */
  requiresFeature?: string;
}

interface SubGroup {
  /** Pfade, bei denen diese Tab-Leiste erscheint. */
  match: string[];
  tabs: SubTab[];
}

/**
 * Untermenüs der zusammengefassten Studio-Bereiche. Erscheinen als
 * horizontale Tab-Leiste oben auf der Seite (über dem Content), analog
 * zur Galerie-Detailansicht. Auf schmalen Screens horizontal scrollbar.
 *
 * Die Seiten selbst bleiben unter ihren bisherigen URLs — hier wird nur
 * navigiert, nichts verschoben. Alte Links bleiben gültig.
 */
const SUB_GROUPS: SubGroup[] = [
  {
    // Gestaltung
    match: ["/studio/brandings", "/studio/templates", "/studio/tags", "/studio/appearance"],
    tabs: [
      { href: "/studio/brandings", label: "Branding" },
      { href: "/studio/appearance", label: "Studio & Login" },
      { href: "/studio/templates", label: "Templates" },
      { href: "/studio/tags", label: "Tags" },
    ],
  },
  {
    // Einstellungen (Verwaltung)
    match: [
      "/studio/settings",
      "/studio/team",
      "/studio/webhooks",
      "/studio/exports",
      "/studio/audit",
      "/studio/avv",
    ],
    tabs: [
      { href: "/studio/settings", label: "Allgemein" },
      { href: "/studio/team", label: "Team", rolesAllowed: ["owner", "admin"] },
      { href: "/studio/webhooks", label: "Integrationen" },
      { href: "/studio/exports", label: "Datenexport" },
      { href: "/studio/audit", label: "Audit" },
      { href: "/studio/avv", label: "AV-Vertrag", rolesAllowed: ["owner", "admin"] },
    ],
  },
  {
    // Konto
    match: ["/studio/account", "/studio/billing"],
    tabs: [
      { href: "/studio/account", label: "Mein Konto" },
      { href: "/studio/billing", label: "Plan & Speicher" },
    ],
  },
];

function isOn(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

export function StudioSubTabs() {
  const pathname = usePathname();
  const [userRole, setUserRole] = useState<Role | null>(null);
  const [features, setFeatures] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.me();
        if (cancelled) return;
        setUserRole(r.user.role);
        setFeatures(r.features ?? []);
      } catch {
        if (!cancelled) setUserRole("member");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const group = SUB_GROUPS.find((g) =>
    g.match.some((p) => isOn(pathname, p))
  );
  if (!group) return null;

  const tabs = group.tabs.filter((tab) => {
    if (tab.rolesAllowed) {
      if (!userRole) return false;
      if (!tab.rolesAllowed.includes(userRole)) return false;
    }
    if (tab.requiresFeature && !features.includes(tab.requiresFeature)) {
      return false;
    }
    return true;
  });

  // Bei nur einem sichtbaren Tab lohnt die Leiste nicht.
  if (tabs.length <= 1) return null;

  return (
    <div className="border-b border-line-subtle overflow-x-auto">
      <nav
        className="flex items-center gap-0.5 px-6 sm:px-8 lg:px-12 min-w-max"
        aria-label="Unterbereiche"
      >
        {tabs.map((tab) => {
          const active = isOn(pathname, tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`whitespace-nowrap px-3 py-2.5 text-ui-sm border-b-2 -mb-px transition-colors duration-motion ease-out ${
                active
                  ? "border-accent text-ink-primary font-medium"
                  : "border-transparent text-ink-secondary hover:text-ink-primary"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
