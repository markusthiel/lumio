"use client";

/**
 * Lumio Studio — Print-Shop-Layout (Tabs)
 *
 * Gemeinsamer Tab-Header für alle /studio/print-shop/*-Pages. Die
 * eigentlichen Pages sind jeweils tab-spezifische Inhalte.
 *
 * Hinweis: das Top-Level-Layout (apps/frontend/src/app/studio/layout.tsx)
 * rendert bereits den StudioShell. Hier nur die Tab-Bar darunter.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: ReadonlyArray<{ href: string; label: string; exact?: boolean }> = [
  { href: "/studio/print-shop", label: "Übersicht", exact: true },
  { href: "/studio/print-shop/settings", label: "Einstellungen" },
  { href: "/studio/print-shop/providers", label: "Anbieter" },
  { href: "/studio/print-shop/products", label: "Produkte" },
  { href: "/studio/print-shop/shipping", label: "Versand" },
];

export default function PrintShopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";
  return (
    <div className="px-4 sm:px-8 py-6 max-w-5xl">
      <h1 className="text-2xl font-semibold mb-1">Print-Shop</h1>
      <p className="text-ui-sm text-ink-tertiary mb-4">
        Verkaufe Prints, Leinwände und Photobooks direkt aus deinen
        Galerien. Konfiguriere Anbieter, Produkte und Versand.
      </p>

      <nav
        className="border-b border-line-subtle mb-6 -mx-4 sm:-mx-8 px-4 sm:px-8 overflow-x-auto"
        aria-label="Print-Shop-Navigation"
      >
        <ul className="flex gap-1 min-w-max">
          {TABS.map((tab) => {
            const active = tab.exact
              ? pathname === tab.href
              : pathname.startsWith(tab.href);
            return (
              <li key={tab.href}>
                <Link
                  href={tab.href}
                  className={
                    active
                      ? "inline-block px-3 py-2 text-sm font-medium border-b-2 border-accent text-ink-primary -mb-px"
                      : "inline-block px-3 py-2 text-sm text-ink-secondary hover:text-ink-primary border-b-2 border-transparent -mb-px"
                  }
                >
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div>{children}</div>
    </div>
  );
}
