"use client";

import { useState } from "react";
import { api, type PublicGalleryMeta } from "@/lib/api";

export function UnlockForm({
  slug,
  meta,
  urlToken,
  onUnlocked,
}: {
  slug: string;
  meta: PublicGalleryMeta;
  urlToken?: string;
  onUnlocked: () => Promise<void> | void;
}) {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api.unlockGallery(slug, {
        password: meta.requiresPassword ? password : undefined,
        token: urlToken,
      });
      await onUnlocked();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Fehler";
      setError(
        msg.includes("invalid_password")
          ? "Passwort ist nicht korrekt."
          : msg.includes("password_required")
          ? "Passwort wird benötigt."
          : msg
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="max-w-md mx-auto px-6 py-20">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-semibold">{meta.title}</h1>
        {meta.description && (
          <p className="text-sm opacity-60 mt-2">{meta.description}</p>
        )}
      </div>

      <form
        onSubmit={onSubmit}
        className="space-y-4 bg-white/5 border border-white/10 rounded-lg p-6 backdrop-blur"
      >
        <div className="text-sm opacity-80">
          {meta.requiresPassword
            ? "Diese Galerie ist passwortgeschützt."
            : "Klicke unten, um die Galerie zu öffnen."}
        </div>

        {meta.requiresPassword && (
          <div className="space-y-1">
            <label htmlFor="pw" className="text-xs font-medium opacity-80">
              Passwort
            </label>
            <input
              id="pw"
              type="password"
              autoFocus
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md bg-white/10 border border-white/20 px-3 py-2 text-sm placeholder:opacity-40 focus:outline-none focus:ring-2 focus:ring-brand-accent"
              placeholder="Passwort eingeben"
            />
          </div>
        )}

        {error && (
          <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full bg-brand-accent text-neutral-950 text-sm font-medium rounded-md py-2.5 hover:opacity-90 disabled:opacity-50 transition"
        >
          {pending ? "Wird geprüft…" : "Galerie öffnen"}
        </button>
      </form>
    </div>
  );
}
