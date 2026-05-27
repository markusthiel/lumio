"use client";

import { useEffect, useState } from "react";
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
 * redirected sonst zu /super/login. Stellt eine schmale Sidebar bereit.
 */
export function SuperShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [loading, setLoading] = useState(true);

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
      {/* Sidebar */}
      <aside className="w-56 border-r border-line-subtle bg-surface-raised flex flex-col">
        <div className="h-14 flex items-center px-5 border-b border-line-subtle">
          <span className="text-accent text-ui-md font-semibold tracking-tight">
            Lumio · Super
          </span>
        </div>

        <nav className="flex-1 py-2">
          <SidebarLink
            href="/super"
            active={pathname === "/super"}
            label="Übersicht"
          />
          <SidebarLink
            href="/super/tenants"
            active={pathname?.startsWith("/super/tenants") ?? false}
            label="Tenants"
          />
          <SidebarLink
            href="/super/audit"
            active={pathname?.startsWith("/super/audit") ?? false}
            label="Audit-Log"
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

      <main className="flex-1 overflow-auto">{children}</main>
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
