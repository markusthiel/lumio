"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Markdown-Textarea mit Live-Preview-Toggle.
 *
 * Standard ist "Edit" — Tab-Switch zu "Preview" zeigt das gerenderte
 * Markdown im selben Container statt im Textarea. Wir nutzen denselben
 * ReactMarkdown-Stack wie die Galerie + Login-Seite, damit der Tenant
 * das Ergebnis 1:1 sieht.
 *
 * skipHtml=true: Raw-HTML im Markdown wird ignoriert. XSS-Defense und
 * konsistent mit dem Render-Pfad auf der Login-Page.
 *
 * Props:
 *  - label, hint    — beschriftet das Feld wie ein normales <Field>
 *  - value, onChange — kontrollierter Textarea-State
 *  - rows, maxLength, placeholder — wie <textarea>
 *  - previewClassName — optional, fuer dark-on-image-Previews
 *    (Login-Greeting wird ueber Bild gerendert) andere Typografie
 */
export function MarkdownField({
  label,
  hint,
  value,
  onChange,
  rows = 4,
  maxLength,
  placeholder,
  previewClassName,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  previewClassName?: string;
}) {
  const [mode, setMode] = useState<"edit" | "preview">("edit");

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-ink-secondary">{label}</label>
        <div className="flex rounded-sm overflow-hidden border border-line-subtle">
          <button
            type="button"
            onClick={() => setMode("edit")}
            className={`text-[10px] px-2 py-0.5 transition-colors duration-motion ${
              mode === "edit"
                ? "bg-ink-primary text-surface-base"
                : "bg-surface-raised text-ink-tertiary hover:text-ink-primary"
            }`}
          >
            Bearbeiten
          </button>
          <button
            type="button"
            onClick={() => setMode("preview")}
            className={`text-[10px] px-2 py-0.5 border-l border-line-subtle transition-colors duration-motion ${
              mode === "preview"
                ? "bg-ink-primary text-surface-base"
                : "bg-surface-raised text-ink-tertiary hover:text-ink-primary"
            }`}
            disabled={!value.trim()}
          >
            Vorschau
          </button>
        </div>
      </div>
      {mode === "edit" ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          maxLength={maxLength}
          placeholder={placeholder}
          className="w-full rounded-md border border-line-subtle px-3 py-2 text-sm bg-surface-raised"
        />
      ) : (
        <div
          className={
            previewClassName ??
            "rounded-md border border-line-subtle bg-surface-raised px-3 py-2 markdown-preview text-sm text-ink-primary"
          }
          style={{ minHeight: `${rows * 1.5}rem` }}
        >
          {value.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
              {value}
            </ReactMarkdown>
          ) : (
            <div className="text-ink-tertiary text-ui-xs italic">
              Leer — schreibe etwas im Bearbeiten-Modus.
            </div>
          )}
        </div>
      )}
      {hint && (
        <p className="text-ui-xs text-ink-tertiary leading-relaxed">{hint}</p>
      )}
      {maxLength && value.length > maxLength * 0.85 && (
        <p className="text-ui-xs text-ink-tertiary text-right">
          {value.length} / {maxLength} Zeichen
        </p>
      )}
    </div>
  );
}
