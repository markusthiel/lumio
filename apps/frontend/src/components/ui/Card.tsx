/**
 * Lumio Card — der Standard-Container für gruppierten Inhalt.
 *
 * Varianten:
 *   default = raised Surface, subtle Border (Statisch, viel verwendet)
 *   sunken  = sunken Surface (eingelassen, für Code/Empty-States)
 *
 * Wenn padding=false: kein internes Padding. Der Aufrufer macht das z.B.
 * bei vollflächigen Bildern oder Tabellen.
 */
import type { HTMLAttributes } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "sunken";
  padding?: boolean;
}

const VARIANTS = {
  default: "bg-surface-raised border border-line-subtle",
  sunken: "bg-surface-sunken border border-line-subtle",
};

export function Card({
  variant = "default",
  padding = true,
  className,
  ...rest
}: CardProps) {
  return (
    <div
      className={`rounded-md ${VARIANTS[variant]} ${padding ? "p-5" : ""} ${className ?? ""}`}
      {...rest}
    />
  );
}

export function CardHeader({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`flex items-start justify-between gap-4 mb-4 ${className ?? ""}`}
      {...rest}
    />
  );
}

export function CardTitle({
  className,
  ...rest
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={`text-ui-md font-medium text-ink-primary ${className ?? ""}`}
      {...rest}
    />
  );
}

export function CardDescription({
  className,
  ...rest
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={`text-ui-sm text-ink-tertiary mt-0.5 ${className ?? ""}`}
      {...rest}
    />
  );
}
