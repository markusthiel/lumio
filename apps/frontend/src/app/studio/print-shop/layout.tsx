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
import { useT } from "@/lib/i18n";
import { usePathname } from "next/navigation";

const TABS: ReadonlyArray<{ href: string; label: string; exact?: boolean }> = [
  { href: "/studio/print-shop", label: "printAdmin.navOverview", exact: true },
  { href: "/studio/print-shop/orders", label: "printAdmin.navOrders" },
  { href: "/studio/print-shop/settings", label: "printAdmin.navSettings" },
  { href: "/studio/print-shop/providers", label: "printAdmin.navProviders" },
  { href: "/studio/print-shop/products", label: "printAdmin.navProducts" },
  { href: "/studio/print-shop/shipping", label: "printAdmin.navShipping" },
];

export default function PrintShopLayout({

  children,
}: {
  children: React.ReactNode;
}) {
  const t = useT();
  const pathname = usePathname() ?? "";
  return (
    <>
      <header className="px-6 sm:px-8 lg:px-12 pt-6 pb-5 border-b border-line-subtle">
        <h1 className="text-display text-ink-primary font-medium tracking-tight">
          Print-Shop
        </h1>
        <p className="text-ui text-ink-tertiary mt-1.5">
          {t("printAdmin.layoutDesc")}
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
                {t(tab.label)}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="px-6 sm:px-8 lg:px-12 py-6 max-w-5xl">{children}</div>
    </>
  );
}
