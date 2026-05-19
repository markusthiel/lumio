"use client";

/**
 * Lumio Input + Textarea + Select — eine konsistente Optik.
 *
 * Alle drei Varianten:
 *   - sunken Hintergrund (etwas tiefer als die Surface)
 *   - subtle Border, im Focus accent
 *   - 32px Höhe als Default (md), 28px sm, 40px lg
 *
 * Wir lassen DIE NATIVE BROWSER-INTERAKTION (Datepicker, Autofill,
 * Spelling) komplett unangetastet. Kein Custom-Dropdown.
 */
import { forwardRef } from "react";
import type {
  InputHTMLAttributes,
  TextareaHTMLAttributes,
  SelectHTMLAttributes,
} from "react";

const FIELD_BASE =
  "w-full bg-surface-sunken text-ink-primary " +
  "border border-line-subtle hover:border-line-strong " +
  "focus:border-accent focus:bg-surface-canvas " +
  "transition-colors duration-motion " +
  "placeholder:text-ink-tertiary " +
  "disabled:opacity-50 disabled:cursor-not-allowed " +
  "focus:outline-none";

const SIZE_INPUT = "h-8 px-2.5 text-ui rounded";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      className={`${FIELD_BASE} ${SIZE_INPUT} ${className ?? ""}`}
      {...rest}
    />
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={`${FIELD_BASE} px-2.5 py-2 text-ui rounded ${className ?? ""}`}
        {...rest}
      />
    );
  }
);

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, children, ...rest },
  ref
) {
  return (
    <select
      ref={ref}
      className={`${FIELD_BASE} ${SIZE_INPUT} appearance-none pr-7 ${className ?? ""}`}
      style={{
        // Custom-Pfeil per inline SVG, weil unterschiedliche Browser den
        // nativen Pfeil sehr verschieden rendern. Wir akzeptieren das hier
        // als Ausnahme zur "native-belassen"-Regel.
        backgroundImage:
          'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'><path fill=\'%23787880\' d=\'M2 4l4 4 4-4\'/></svg>")',
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 8px center",
      }}
      {...rest}
    >
      {children}
    </select>
  );
});
