"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";

interface Props {
  tenantId: string;
  tenantName: string;
  onClose: () => void;
  onInvited: () => Promise<void> | void;
}

/**
 * Modal zum Einladen eines weiteren Owners. Bei Erfolg zeigen wir
 * — genau wie beim Tenant-Anlegen — den Setup-Link einmalig an, damit
 * der Operator ihn manuell weiterleiten kann falls Mail nicht ankam.
 */
export function InviteOwnerDialog({
  tenantId,
  tenantName,
  onClose,
  onInvited,
}: Props) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    setupUrl: string;
    mailSent: boolean;
  } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.superInviteOwner(tenantId, {
        email: email.trim(),
        name: name.trim(),
      });
      setResult({ setupUrl: r.setup.url, mailSent: r.setup.mailSent });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("common.error");
      setError(
        msg.includes("email_taken")
          ? t("super.invEmailTaken")
          : msg.includes("tenant_inactive")
          ? t("super.invTenantInactive")
          : msg
      );
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <Backdrop>
        <div className="w-full max-w-lg rounded-md border border-line-strong bg-surface-raised p-6 space-y-4">
          <h2 className="text-ui-lg font-semibold text-ink-primary">
            {t("super.invInvitedTitle")}
          </h2>
          <p className="text-ui-sm text-ink-tertiary">
            {result.mailSent
              ? t("super.invMailSent", { email })
              : t("super.invMailFailed")}
          </p>
          <div className="rounded bg-surface-sunken border border-line-subtle p-3 break-all font-mono text-ui-xs">
            {result.setupUrl}
          </div>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(result.setupUrl)}
            className="text-ui-sm text-accent hover:text-accent-hover"
          >
            {t("super.copyLink")}
          </button>
          <button
            type="button"
            onClick={() => onInvited()}
            className="w-full h-9 rounded bg-accent text-accent-contrast text-ui-sm font-medium"
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
        <div>
          <h2 className="text-ui-lg font-semibold text-ink-primary">
            {t("super.invTitle")}
          </h2>
          <p className="text-ui-sm text-ink-tertiary mt-0.5">
            {t("super.invFor", { name: tenantName })}
          </p>
        </div>

        <label className="block">
          <span className="text-ui-sm text-ink-secondary">{t("super.name")}</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
            className="mt-1 w-full h-9 px-2.5 rounded bg-surface-sunken border border-line-subtle text-ui text-ink-primary focus:border-accent focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-ui-sm text-ink-secondary">{t("super.email")}</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={200}
            className="mt-1 w-full h-9 px-2.5 rounded bg-surface-sunken border border-line-subtle text-ui text-ink-primary focus:border-accent focus:outline-none"
          />
        </label>

        {error && <div className="text-ui-sm text-semantic-danger">{error}</div>}

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-9 px-3 rounded border border-line-strong text-ui-sm text-ink-secondary"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={busy || !email || !name}
            className="flex-1 h-9 rounded bg-accent text-accent-contrast text-ui-sm font-medium disabled:opacity-50"
          >
            {busy ? t("super.inviting") : t("super.invite")}
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
  onClose?: () => void;
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
