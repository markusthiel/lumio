"use client";

/**
 * Email-Chips-Input — mehrere E-Mail-Adressen als entfernbare Chips.
 *
 * UX:
 *  - Eingabe per Tippen + Enter / Komma / Leerzeichen (zum Bestaetigen)
 *  - Auch verarbeitet werden gepastete Listen ("a@x.de, b@y.de")
 *  - Adressen die nicht-valid sind werden mit roter Border markiert
 *    (nicht abgelehnt — der User kann nachbessern)
 *  - X-Button pro Chip zum Entfernen
 *  - Backspace im leeren Input loescht den letzten Chip
 *  - Max-Limit: 10 (Backend-Limit)
 *
 * Bewusst KEIN Autocomplete/History — Adressen sind kontextspezifisch
 * (Brautpaar / Eltern / Agentur), History ueber alle Galerien hinweg
 * macht keinen Sinn und waere ein Datenschutz-Footgun.
 */
import { useState, type KeyboardEvent, type ClipboardEvent } from "react";
import { useT } from "@/lib/i18n";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAILS = 10;

export function EmailChipsInput({
  value,
  onChange,
  placeholder,
  id,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  id?: string;
}) {
  const t = useT();
  const [draft, setDraft] = useState("");

  function tryCommit(raw: string): boolean {
    const candidates = raw
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (candidates.length === 0) return false;

    const next = [...value];
    let changed = false;
    for (const c of candidates) {
      if (next.length >= MAX_EMAILS) break;
      if (!next.includes(c)) {
        next.push(c);
        changed = true;
      }
    }
    if (changed) onChange(next);
    return true;
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === " " || e.key === "Tab") {
      if (draft.trim()) {
        e.preventDefault();
        if (tryCommit(draft)) {
          setDraft("");
        }
      }
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      // Letzten Chip loeschen
      onChange(value.slice(0, -1));
    }
  }

  function onBlur() {
    // Wenn der User wegklickt ohne Enter zu druecken, trotzdem committen
    if (draft.trim()) {
      tryCommit(draft);
      setDraft("");
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    if (text.includes(",") || text.includes(";") || text.includes("\n") || text.includes(" ")) {
      e.preventDefault();
      tryCommit(text);
      setDraft("");
    }
  }

  function removeChip(email: string) {
    onChange(value.filter((e) => e !== email));
  }

  return (
    <div className="flex flex-wrap gap-1.5 items-center min-h-[40px] w-full rounded-md border border-line-subtle px-2 py-1.5 bg-surface-base focus-within:border-accent">
      {value.map((email) => {
        const valid = EMAIL_RE.test(email);
        return (
          <span
            key={email}
            className={
              "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs " +
              (valid
                ? "bg-surface-sunken text-ink-primary"
                : "bg-red-50 text-red-700 border border-red-200")
            }
            title={valid ? undefined : t("printAdmin.invalidEmail")}
          >
            {email}
            <button
              type="button"
              onClick={() => removeChip(email)}
              className="text-ink-tertiary hover:text-ink-primary"
              aria-label={`${email} entfernen`}
            >
              ×
            </button>
          </span>
        );
      })}
      {value.length < MAX_EMAILS && (
        <input
          id={id}
          type="email"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          onPaste={onPaste}
          placeholder={value.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[140px] text-sm bg-transparent outline-none"
        />
      )}
      {value.length >= MAX_EMAILS && (
        <span className="text-xs text-ink-tertiary px-1">
          Max. {MAX_EMAILS} Adressen
        </span>
      )}
    </div>
  );
}
