"use client";

/**
 * Lumio Button — eine Komponente, drei Varianten, drei Größen.
 *
 * Variants:
 *   primary    = Accent-Hintergrund, für die wichtigste Aktion pro Bereich
 *   secondary  = Subtle Border, neutral; die Default-Wahl
 *   ghost      = nur Text + Hover, für Tertiär-Aktionen und Toolbar-Items
 *   danger     = roter Border, destruktiv (löschen, widerrufen)
 *
 * Sizes:
 *   sm        = 24px hoch, fürs Werkzeug-Feeling (kompakt)
 *   md        = 32px hoch, Default
 *   lg        = 40px hoch, Hero-Buttons
 *
 * Konsistente Transitions auf Hover/Active, Focus-Ring via :focus-visible
 * aus globals.css.
 */
import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-contrast hover:bg-accent-hover " +
    "active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed",
  secondary:
    "bg-surface-raised text-ink-primary border border-line-subtle " +
    "hover:border-line-strong hover:bg-surface-overlay " +
    "active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed",
  ghost:
    "text-ink-secondary hover:text-ink-primary hover:bg-surface-raised " +
    "disabled:opacity-50 disabled:cursor-not-allowed",
  danger:
    "bg-surface-raised text-semantic-danger border border-line-subtle " +
    "hover:border-semantic-danger/50 hover:bg-semantic-danger/10 " +
    "active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-6 px-2 text-ui-xs gap-1 rounded-sm",
  md: "h-8 px-3 text-ui gap-1.5 rounded",
  lg: "h-10 px-4 text-ui-md gap-2 rounded-md",
};

const BASE =
  "inline-flex items-center justify-center font-medium whitespace-nowrap " +
  "transition-all duration-motion ease-out " +
  "focus-visible:outline-none";

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = "secondary", size = "md", className, type, ...rest },
    ref
  ) {
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        className={`${BASE} ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className ?? ""}`}
        {...rest}
      />
    );
  }
);
