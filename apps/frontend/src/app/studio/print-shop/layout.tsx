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
  { href: "/studio/print-shop/orders", label: "Bestellungen" },
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
    <>
      <header className="px-6 sm:px-8 lg:px-12 pt-6 pb-5 border-b border-line-subtle">
        <h1 className="text-display text-ink-primary font-medium tracking-tight">
          Print-Shop
        </h1>
        <p className="text-ui text-ink-tertiary mt-1.5">
          Verkaufe Prints, Leinwände und Photobooks direkt aus deinen
          Galerien. Konfiguriere Anbieter, Produkte und Versand.
        </p>
      </header>

      <div
        className="border-b border-line-subtle overflow-x-auto"
        aria-label="Print-Shop-Navigation"
      >
        <nav className="flex items-center gap-0.5 px-6 sm:px-8 lg:px-12 min-w-max">
          {TABS.map((tab) => {
            const active = tab.exact
              ? pathname === tab.href
              : pathname.startsWith(tab.href);
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

      <div className="px-6 sm:px-8 lg:px-12 py-6 max-w-5xl">{children}</div>
    </>
  );
}
