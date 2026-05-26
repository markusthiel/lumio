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

      {/* Globale Markdown-Preview-Typografie. Local-scoped via class. */}
      <style jsx global>{`
        .markdown-preview h1 {
          font-size: 1.5rem;
          line-height: 1.2;
          font-weight: 600;
          margin: 0.25rem 0;
        }
        .markdown-preview h2 {
          font-size: 1.25rem;
          line-height: 1.25;
          font-weight: 600;
          margin: 0.25rem 0;
        }
        .markdown-preview h3 {
          font-size: 1.1rem;
          font-weight: 600;
          margin: 0.25rem 0;
        }
        .markdown-preview p {
          margin: 0.4rem 0;
          line-height: 1.5;
        }
        .markdown-preview ul,
        .markdown-preview ol {
          margin: 0.4rem 0;
          padding-left: 1.5rem;
        }
        .markdown-preview ul {
          list-style: disc;
        }
        .markdown-preview ol {
          list-style: decimal;
        }
        .markdown-preview li {
          margin: 0.15rem 0;
        }
        .markdown-preview strong {
          font-weight: 600;
        }
        .markdown-preview em {
          font-style: italic;
        }
        .markdown-preview a {
          color: rgb(var(--accent) / 1);
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .markdown-preview code {
          background: rgb(var(--surface-sunken) / 0.8);
          padding: 0.1rem 0.3rem;
          border-radius: 2px;
          font-size: 0.85em;
        }
        .markdown-preview blockquote {
          border-left: 3px solid rgb(var(--line-subtle) / 1);
          padding-left: 0.75rem;
          color: rgb(var(--ink-secondary) / 1);
          font-style: italic;
        }
      `}</style>
    </div>
  );
}
