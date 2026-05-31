"use client";

import { useState } from "react";
import { api, type PublicGalleryMeta } from "@/lib/api";
import { useT } from "@/lib/i18n";

export function UnlockForm({
  slug,
  meta,
  urlToken,
  requirePassword = false,
  onUnlocked,
}: {
  slug: string;
  meta: PublicGalleryMeta;
  urlToken?: string;
  /** Erzwingt das Passwortfeld auch ohne Galerie-Passwort — z. B. wenn
   *  der Freigabe-Link ein eigenes Passwort hat. */
  requirePassword?: boolean;
  onUnlocked: () => Promise<void> | void;
}) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showPassword = meta.requiresPassword || requirePassword;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api.unlockGallery(slug, {
        password: showPassword ? password : undefined,
        token: urlToken,
      });
      await onUnlocked();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("gallery.requestFailed");
      setError(
        msg.includes("invalid_password")
          ? t("gallery.passwordIncorrect")
          : msg.includes("password_required")
          ? t("gallery.passwordRequired")
          : msg
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-6 py-16 animate-fade-in">
      <div className="w-full max-w-md">
        {/* Hero — Title sehr groß, Description ruhig darunter. Bei
            Lock-Galerien ist das die einzige Stelle, an der die Kunden
            das Setting des Shootings sehen, also geben wir der Typo
            ordentlich Raum. */}
        <div className="text-center mb-10">
          <h1 className="text-display-lg sm:text-display-xl font-medium tracking-tight">
            {meta.title}
          </h1>
          {meta.description && (
            <p className="text-ui opacity-60 mt-4 max-w-sm mx-auto leading-relaxed">
              {meta.description}
            </p>
          )}
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-5 bg-white/[0.03] border border-white/10 rounded-md p-7 backdrop-blur"
        >
          <div className="text-ui-sm opacity-75">
            {showPassword
              ? t("gallery.locked")
              : t("gallery.unlockHint")}
          </div>

          {showPassword && (
            <div className="space-y-1.5">
              <label htmlFor="pw" className="text-ui-sm font-medium opacity-90 block">
                {t("gallery.password")}
              </label>
              <input
                id="pw"
                type="password"
                autoFocus
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded bg-white/5 border border-white/15 hover:border-white/30 focus:border-brand-accent focus:bg-white/10 px-3 h-10 text-ui placeholder:opacity-40 focus:outline-none transition-colors duration-motion"
                placeholder={t("gallery.passwordPlaceholder")}
              />
            </div>
          )}

          {error && (
            <div className="text-ui-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-sm px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full h-10 bg-brand-accent text-brand-accent-contrast text-ui font-medium rounded hover:opacity-90 disabled:opacity-50 transition-opacity duration-motion"
          >
            {pending ? t("gallery.unlockChecking") : t("gallery.open")}
          </button>
        </form>
      </div>
    </div>
  );
}
