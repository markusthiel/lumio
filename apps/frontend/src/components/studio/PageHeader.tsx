"use client";

/**
 * PageHeader — der Standard-Header oberhalb jeder Studio-Page.
 *
 * Layout:
 *
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ Studio › Brandings                          [Action] [▼] │
 *   │ Branding-Profile                                         │
 *   │ Logos, Farben, Custom-CSS pro Galerie                    │
 *   └─────────────────────────────────────────────────────────┘
 *
 * breadcrumb ist optional; wenn er fehlt, gibt's nur Title + Description.
 * actions kommen rechts oben in einer Reihe — z.B. "Neue Galerie"-Button.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { StudioSubTabs } from "@/components/studio/StudioSubTabs";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  breadcrumb?: BreadcrumbItem[];
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({
  breadcrumb,
  title,
  description,
  actions,
}: PageHeaderProps) {
  return (
    <>
      <header className="px-6 sm:px-8 lg:px-12 pt-6 pb-5 border-b border-line-subtle">
        {breadcrumb && breadcrumb.length > 0 && (
          <nav
            aria-label="Breadcrumb"
            className="text-ui-xs text-ink-tertiary mb-3 flex items-center gap-1.5"
          >
            {breadcrumb.map((item, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {item.href ? (
                  <Link
                    href={item.href}
                    className="hover:text-ink-primary transition-colors duration-motion"
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span>{item.label}</span>
                )}
                {i < breadcrumb.length - 1 && (
                  <span className="text-ink-tertiary/60">/</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-display text-ink-primary font-medium tracking-tight">
              {title}
            </h1>
            {description && (
              <p className="text-ui text-ink-tertiary mt-1.5">
                {description}
              </p>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-2 shrink-0">{actions}</div>
          )}
        </div>
      </header>
      {/* Sub-Navigation der zusammengefassten Bereiche — erscheint nur auf
          Gruppen-Seiten, direkt unter dem Titel (analog Print-Shop). */}
      <StudioSubTabs />
    </>
  );
}
