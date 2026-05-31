"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { useT } from "@/lib/i18n";

/**
 * Tenant-Picker für die Apex-Domain im Multi-Mode.
 *
 * Form-Submit baut eine Subdomain-URL aus dem eingegebenen Slug und
 * navigiert dorthin. Dort übernimmt dann die Tenant-Subdomain-Login-
 * Seite. Wir validieren nur grobe Slug-Form (Lower-Case, Ziffern,
 * Bindestrich) — die echte Existenzprüfung passiert serverseitig bei
 * der nachfolgenden Page (404 / Tenant-not-found wird vom Login-Pfad
 * behandelt).
 *
 * Optional: "Ich kenne meinen Studio-Namen nicht" → Mailto-Link an
 * Support. Aktuell nicht implementiert, kann später ergänzt werden.
 */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function TenantPicker({ domainBase }: { domainBase: string }) {
  const t = useT();
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = slug.trim().toLowerCase();
    if (!cleaned) {
      setError(t("tenantPicker.errEmpty"));
      return;
    }
    if (!SLUG_RE.test(cleaned)) {
      setError(
        t("tenantPicker.errFormat")
      );
      return;
    }
    if (!domainBase) {
      setError(
        t("tenantPicker.errConfig")
      );
      return;
    }
    // Subdomain-URL bauen. window.location-Protocol übernehmen damit
    // localhost-http / production-https beide funktionieren.
    const proto =
      typeof window !== "undefined" ? window.location.protocol : "https:";
    window.location.href = `${proto}//${cleaned}.${domainBase}/login`;
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-md border border-line-subtle bg-surface-raised p-5"
    >
      <label className="block text-ui-sm text-ink-secondary">
        {t("tenantPicker.label")}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value);
            setError(null);
          }}
          placeholder={t("tenantPicker.placeholder")}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="flex-1 h-9 px-2.5 rounded bg-surface-sunken border border-line-subtle hover:border-line-strong focus:border-accent text-ui text-ink-primary placeholder:text-ink-tertiary focus:outline-none transition-colors duration-motion"
        />
        <span className="text-ui-sm text-ink-tertiary font-mono whitespace-nowrap">
          .{domainBase || "…"}
        </span>
      </div>
      {error && (
        <p className="text-ui-sm text-semantic-danger">{error}</p>
      )}
      <Button type="submit" variant="primary" size="sm" disabled={!slug.trim()}>
        {t("tenantPicker.submit")}
      </Button>
      <p className="text-ui-xs text-ink-tertiary pt-2">
        {t("tenantPicker.hint")}
      </p>
    </form>
  );
}
