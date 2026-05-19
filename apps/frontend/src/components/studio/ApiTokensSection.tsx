"use client";

import { useEffect, useState } from "react";
import { api, type ApiTokenSummary } from "@/lib/api";

/**
 * Studio-Settings-Sektion zum Verwalten von API-Tokens.
 *
 * Tokens werden für Plugins (Lightroom) und CLI-Tools verwendet. Sie
 * haben dieselben Rechte wie der User, sind aber einzeln widerrufbar.
 *
 * Wichtig: Der Plaintext-Token wird vom Server nur EINMAL beim
 * Erstellen geliefert. Wir zeigen ihn dem User direkt nach dem POST in
 * einer Kopierfläche; wenn er den dort verpasst, muss er einen neuen
 * Token erzeugen.
 */
export function ApiTokensSection() {
  const [tokens, setTokens] = useState<ApiTokenSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<{
    token: string;
    name: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await api.listApiTokens();
      setTokens(res.tokens);
    } catch (err) {
      console.error("listApiTokens failed:", err);
    } finally {
      setLoading(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await api.createApiToken(newName.trim());
      setJustCreated({ token: res.token, name: res.name });
      setNewName("");
      await load();
    } catch (err) {
      console.error("createApiToken failed:", err);
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string, name: string) {
    if (!window.confirm(`Token "${name}" widerrufen?`)) return;
    try {
      await api.revokeApiToken(id);
      await load();
    } catch (err) {
      console.error("revokeApiToken failed:", err);
    }
  }

  async function copyToken() {
    if (!justCreated) return;
    await navigator.clipboard.writeText(justCreated.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="rounded-lg border border-line-subtle bg-surface-raised p-5 space-y-4">
      <div>
        <h2 className="text-sm font-medium">API-Tokens</h2>
        <p className="text-xs text-ink-tertiary mt-0.5">
          Für Plugins (z.B. Lightroom) und CLI-Tools. Tokens haben dieselben
          Rechte wie dein Studio-Account und sind einzeln widerrufbar.
        </p>
      </div>

      {/* Frisch erstellter Token — wird einmal angezeigt */}
      {justCreated && (
        <div className="rounded-md border border-semantic-warning/30 bg-semantic-warning/10 p-3 space-y-2">
          <div className="text-xs font-medium text-semantic-warning">
            Token „{justCreated.name}" wurde erstellt. Kopiere ihn jetzt —
            er wird nicht erneut angezeigt.
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-xs bg-surface-raised border border-semantic-warning/30 rounded px-2 py-1.5 overflow-x-auto whitespace-nowrap">
              {justCreated.token}
            </code>
            <button
              type="button"
              onClick={copyToken}
              className="text-xs px-2 py-1.5 rounded border border-semantic-warning/40 bg-surface-raised hover:bg-semantic-warning/15 whitespace-nowrap"
            >
              {copied ? "✓" : "Kopieren"}
            </button>
            <button
              type="button"
              onClick={() => setJustCreated(null)}
              className="text-xs px-2 py-1.5 rounded border border-semantic-warning/40 bg-surface-raised hover:bg-semantic-warning/15"
              aria-label="Schließen"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Neuer Token */}
      <form onSubmit={create} className="flex items-center gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="z.B. Lightroom Studio-Mac"
          maxLength={100}
          className="flex-1 rounded-md border border-line-subtle px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          className="text-sm px-3 py-1.5 rounded-md bg-accent text-accent-contrast hover:bg-accent-hover disabled:opacity-50 whitespace-nowrap"
        >
          {creating ? "…" : "Token erstellen"}
        </button>
      </form>

      {/* Liste */}
      {!loading && tokens.length === 0 && (
        <p className="text-xs text-ink-tertiary italic">Keine Tokens.</p>
      )}
      {tokens.length > 0 && (
        <ul className="divide-y divide-line-subtle border border-line-subtle rounded-md">
          {tokens.map((tok) => (
            <li
              key={tok.id}
              className="p-3 flex items-center justify-between gap-3 text-sm"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{tok.name}</div>
                <div className="text-xs text-ink-tertiary mt-0.5">
                  Erstellt {formatDate(tok.createdAt)}
                  {tok.lastUsedAt
                    ? ` · zuletzt verwendet ${formatDate(tok.lastUsedAt)}`
                    : " · noch nicht verwendet"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => revoke(tok.id, tok.name)}
                className="text-xs text-semantic-danger hover:underline whitespace-nowrap"
              >
                Widerrufen
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
