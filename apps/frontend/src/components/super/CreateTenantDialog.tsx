"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n";
import { api, type SuperTenantCreated } from "@/lib/api";

interface Props {
  onClose: () => void;
  onCreated: () => Promise<void> | void;
}

/**
 * Modal zum Anlegen eines neuen Tenants + Initial-Owner. Bei Erfolg
 * zeigt der Dialog den Setup-Link an (einmalig — wird in der DB nur
 * gehasht abgelegt). Der Operator kann den Link kopieren, falls der
 * Mail-Versand fehlschlägt.
 */
export function CreateTenantDialog({ onClose, onCreated }: Props) {
  const t = useT();
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [customDomain, setCustomDomain] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SuperTenantCreated | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.superCreateTenant({
        slug: slug.trim().toLowerCase(),
        name: name.trim(),
        displayName: displayName.trim() || null,
        customDomain: customDomain.trim() || null,
        ownerEmail: ownerEmail.trim(),
        ownerName: ownerName.trim(),
      });
      setResult(r);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("common.error");
      setError(
        msg.includes("slug_taken")
          ? t("super.ctSlugTaken")
          : msg.includes("domain_taken")
          ? t("super.ctDomainTaken")
          : msg.includes("email_taken")
          ? t("super.invEmailTaken")
          : msg
      );
    } finally {
      setBusy(false);
    }
  }

  // Erfolg: Setup-Link anzeigen, Dialog NICHT automatisch schließen —
  // der Operator soll bewusst bestätigen, dass er den Link gesehen hat.
  if (result) {
    return (
      <Backdrop onClose={() => {}}>
        <div className="w-full max-w-lg rounded-md border border-line-strong bg-surface-raised p-6 space-y-4">
          <div>
            <h2 className="text-ui-lg font-semibold text-ink-primary">
              {t("super.ctCreatedTitle", { name: result.tenant.name })}
            </h2>
            <p className="text-ui-sm text-ink-tertiary mt-1">
              {result.setup.mailSent
                ? t("super.ctMailSent", { email: result.owner.email })
                : t("super.ctMailFailed")}
            </p>
          </div>

          <div className="rounded bg-surface-sunken border border-line-subtle p-3 break-all font-mono text-ui-xs">
            {result.setup.url}
          </div>

          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(result.setup.url);
            }}
            className="text-ui-sm text-accent hover:text-accent-hover transition-colors duration-motion"
          >
            {t("super.copyLink")}
          </button>

          <div className="text-ui-xs text-ink-tertiary border-t border-line-subtle pt-3">
            {t("super.ctLinkValid")}
          </div>

          <button
            type="button"
            onClick={() => onCreated()}
            className="w-full h-9 rounded bg-accent text-accent-contrast font-medium text-ui-sm hover:bg-accent-hover transition-colors duration-motion"
          >
            {t("super.done")}
          </button>
        </div>
      </Backdrop>
    );
  }

  return (
    <Backdrop onClose={onClose}>
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-md border border-line-strong bg-surface-raised p-6 space-y-3"
      >
        <h2 className="text-ui-lg font-semibold text-ink-primary">
          {t("super.ctTitle")}
        </h2>

        <Field label={t("super.studioName")} required>
          <input
            type="text"
            value={name}
            onChange={(e) => {
              const v = e.target.value;
              setName(v);
              // Slug aus Name vorschlagen, solange nicht manuell editiert
              if (!slugTouched) {
                setSlug(
                  v
                    .toLowerCase()
                    .normalize("NFD")
                    .replace(/[\u0300-\u036f]/g, "")
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/-+/g, "-")
                    .replace(/^-+|-+$/g, "")
                    .slice(0, 30)
                );
              }
            }}
            required
            maxLength={120}
            placeholder="Studio Müller"
            className="block w-full h-9 px-2.5 rounded bg-surface-sunken border border-line-subtle text-ui text-ink-primary focus:border-accent focus:outline-none"
          />
        </Field>

        <Field
          label={t("super.ctDisplayName")}
          hint={t("super.ctDisplayHint")}
        >
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={120}
            placeholder="z.B. Müller Photography"
            className="block w-full h-9 px-2.5 rounded bg-surface-sunken border border-line-subtle text-ui text-ink-primary focus:border-accent focus:outline-none"
          />
        </Field>

        <Field
          label={t("super.ctSlug")}
          required
          hint={t("super.ctSlugHint")}
        >
          <input
            type="text"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
            }}
            required
            minLength={2}
            maxLength={40}
            placeholder="studio-mueller"
            className="block w-full h-9 px-2.5 rounded bg-surface-sunken border border-line-subtle text-ui text-ink-primary font-mono focus:border-accent focus:outline-none"
          />
        </Field>

        <Field
          label={t("super.ctDomain")}
          hint={t("super.ctDomainHint")}
        >
          <input
            type="text"
            value={customDomain}
            onChange={(e) => setCustomDomain(e.target.value.toLowerCase())}
            maxLength={200}
            placeholder="studio-mueller.de"
            className="block w-full h-9 px-2.5 rounded bg-surface-sunken border border-line-subtle text-ui text-ink-primary font-mono focus:border-accent focus:outline-none"
          />
        </Field>

        <div className="border-t border-line-subtle pt-3">
          <div className="text-ui-xs uppercase tracking-[0.12em] text-ink-tertiary mb-2">
            Initial-Owner
          </div>
          <Field label={t("super.name")} required>
            <input
              type="text"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              required
              maxLength={120}
              className="block w-full h-9 px-2.5 rounded bg-surface-sunken border border-line-subtle text-ui text-ink-primary focus:border-accent focus:outline-none"
            />
          </Field>
          <div className="h-2" />
          <Field
            label={t("super.email")}
            required
            hint={t("super.ctEmailHint")}
          >
            <input
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              required
              maxLength={200}
              className="block w-full h-9 px-2.5 rounded bg-surface-sunken border border-line-subtle text-ui text-ink-primary focus:border-accent focus:outline-none"
            />
          </Field>
        </div>

        {error && (
          <div className="text-ui-sm text-semantic-danger">{error}</div>
        )}

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-9 px-4 rounded border border-line-strong text-ui-sm text-ink-secondary hover:text-ink-primary hover:bg-surface-overlay transition-colors duration-motion"
          >
            Abbrechen
          </button>
          <button
            type="submit"
            disabled={busy}
            className="flex-1 h-9 rounded bg-accent text-accent-contrast font-medium text-ui-sm hover:bg-accent-hover disabled:opacity-50 transition-colors duration-motion"
          >
            {busy ? t("super.ctCreating") : t("super.ctSubmit")}
          </button>
        </div>
      </form>
    </Backdrop>
  );
}

function Backdrop({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-ui-sm text-ink-secondary">
        {label}
        {required && <span className="text-semantic-danger ml-0.5">*</span>}
      </span>
      <div className="mt-1">{children}</div>
      {hint && (
        <div className="mt-1 text-ui-xs text-ink-tertiary">{hint}</div>
      )}
    </label>
  );
}
