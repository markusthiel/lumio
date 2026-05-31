"use client";

/**
 * Lumio Studio — Versandmethoden
 *
 * CRUD fuer ShippingMethod. Pragmatisch — kein Dialog, Inline-Tabelle
 * mit Add-Form unten.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ShippingMethodCreateInput } from "@/lib/api";
import { Button, Input } from "@/components/ui";
import { useT } from "@/lib/i18n";

type Method = Awaited<
  ReturnType<typeof api.listShippingMethods>
>["methods"][number];
type ProviderMine = Awaited<
  ReturnType<typeof api.listTenantPrintProviders>
>["providers"][number];

export default function ShippingMethodsPage() {
  const t = useT();
  const [methods, setMethods] = useState<Method[] | null>(null);
  const [providers, setProviders] = useState<ProviderMine[] | null>(null);
  const [editing, setEditing] = useState<Method | "new" | null>(null);
  const [message, setMessage] = useState<
    { kind: "success" | "danger"; text: string } | null
  >(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, pr] = await Promise.all([
        api.listShippingMethods(),
        api.listTenantPrintProviders(),
      ]);
      setMethods(m.methods);
      setProviders(pr.providers);
    } catch (err) {
      setMessage({
        kind: "danger",
        text: err instanceof Error ? err.message : t("common.error"),
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(m: Method) {
    if (!confirm(t("shipping.confirmDelete", { name: m.name }))) return;
    setBusy(true);
    try {
      await api.deleteShippingMethod(m.id);
      await load();
      setMessage({ kind: "success", text: t("shipping.deleted") });
    } catch (err) {
      setMessage({
        kind: "danger",
        text: err instanceof Error ? err.message : t("common.error"),
      });
    } finally {
      setBusy(false);
    }
  }

  if (!methods || !providers) {
    return <div className="text-sm text-ink-tertiary">{t("common.loading")}</div>;
  }

  const enabledProviders = providers.filter((p) => p.enabled);

  if (enabledProviders.length === 0) {
    return (
      <div className="rounded-md border border-semantic-warning/30 bg-semantic-warning/8 px-3 py-4 text-sm text-semantic-warning">
        {t("shipping.noProvidersWarning")}{" "}
        <a
          href="/studio/print-shop/providers"
          className="underline font-medium"
        >{t("shipping.toProviders")}</a>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {message && (
        <div
          className={
            message.kind === "success"
              ? "rounded-md border border-semantic-success/30 bg-semantic-success/8 px-3 py-2 text-sm text-semantic-success"
              : "rounded-md border border-semantic-danger/30 bg-semantic-danger/8 px-3 py-2 text-sm text-semantic-danger"
          }
        >
          {message.text}
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")} disabled={busy}>{t("shipping.addMethod")}</Button>
      </div>

      {methods.length === 0 ? (
        <div className="rounded-md border border-line-subtle bg-surface-raised px-4 py-6 text-sm text-ink-tertiary text-center">{t("shipping.noMethods")}</div>
      ) : (
        <ul className="space-y-2">
          {methods.map((m) => (
            <li
              key={m.id}
              className="rounded-md border border-line-subtle bg-surface-raised p-3 flex items-center gap-3 flex-wrap"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <strong className="text-sm">{m.name}</strong>
                  {!m.enabled && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-surface-sunken text-ink-tertiary">{t("shipping.inactive")}</span>
                  )}
                </div>
                <div className="text-xs text-ink-tertiary">
                  {formatPrice(m.priceCents)}
                  {(m.estimatedDaysMin || m.estimatedDaysMax) && (
                    <>
                      {" · "}
                      {m.estimatedDaysMin === m.estimatedDaysMax
                        ? t("shipping.daysExact", { n: m.estimatedDaysMin })
                        : t("shipping.daysRange", { min: m.estimatedDaysMin ?? "?", max: m.estimatedDaysMax ?? "?" })}
                    </>
                  )}
                  {m.countries.length > 0 && ` · ${m.countries.join(", ")}`}
                  {" · "}
                  {providers.find((p) => p.providerKey === m.providerKey)
                    ?.providerLabel ?? m.providerKey}
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setEditing(m)}
                disabled={busy}
              >{t("common.edit")}</Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => remove(m)}
                disabled={busy}
              >{t("common.delete")}</Button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <ShippingDialog
          enabledProviders={enabledProviders}
          existing={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
            setMessage({ kind: "success", text: t("shipping.saved") });
          }}
        />
      )}
    </div>
  );
}

function formatPrice(cents: number): string {
  return (cents / 100).toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
  });
}

function ShippingDialog({
  enabledProviders,
  existing,
  onClose,
  onSaved,
}: {
  enabledProviders: ProviderMine[];
  existing: Method | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(existing?.name ?? "DHL Standard");
  const [providerKey, setProviderKey] = useState(
    existing?.providerKey ?? enabledProviders[0]?.providerKey ?? ""
  );
  const [priceEuros, setPriceEuros] = useState(
    existing ? (existing.priceCents / 100).toFixed(2) : "5.90"
  );
  const [daysMin, setDaysMin] = useState(
    existing?.estimatedDaysMin?.toString() ?? "3"
  );
  const [daysMax, setDaysMax] = useState(
    existing?.estimatedDaysMax?.toString() ?? "5"
  );
  const [countries, setCountries] = useState(
    existing ? existing.countries.join(", ") : "DE, AT, CH"
  );
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const price = Math.round(parseFloat(priceEuros) * 100);
      if (!Number.isFinite(price) || price < 0) {
        throw new Error(t("shipping.priceInvalid"));
      }
      const countryList = countries
        .split(",")
        .map((c) => c.trim().toUpperCase())
        .filter((c) => /^[A-Z]{2}$/.test(c));
      const payload: ShippingMethodCreateInput = {
        providerKey,
        name: name.trim(),
        priceCents: price,
        estimatedDaysMin: daysMin.trim()
          ? parseInt(daysMin, 10)
          : null,
        estimatedDaysMax: daysMax.trim()
          ? parseInt(daysMax, 10)
          : null,
        countries: countryList,
        enabled,
      };
      if (existing) {
        await api.updateShippingMethod(existing.id, payload);
      } else {
        await api.createShippingMethod(payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-surface-raised rounded-md border border-line-subtle p-5 max-w-md w-full max-h-[85vh] overflow-y-auto">
        <h3 className="text-lg font-semibold mb-4">
          {existing ? t("shipping.dialogEditTitle") : t("shipping.dialogNewTitle")}
        </h3>
        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="block text-xs text-ink-tertiary mb-1">{t("shipping.labelName")}</span>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <label className="block">
            <span className="block text-xs text-ink-tertiary mb-1">{t("shipping.labelProvider")}</span>
            <select
              className="w-full rounded border border-line-subtle bg-surface-raised px-2 py-1.5 text-sm"
              value={providerKey}
              onChange={(e) => setProviderKey(e.target.value)}
              required
            >
              {enabledProviders.map((p) => (
                <option key={p.providerKey} value={p.providerKey}>
                  {p.providerLabel}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs text-ink-tertiary mb-1">{t("shipping.labelPrice")}</span>
            <Input
              type="number"
              step="0.01"
              value={priceEuros}
              onChange={(e) => setPriceEuros(e.target.value)}
              required
              min={0}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs text-ink-tertiary mb-1">{t("shipping.labelDaysFrom")}</span>
              <Input
                type="number"
                value={daysMin}
                onChange={(e) => setDaysMin(e.target.value)}
                min={0}
              />
            </label>
            <label className="block">
              <span className="block text-xs text-ink-tertiary mb-1">{t("shipping.labelDaysTo")}</span>
              <Input
                type="number"
                value={daysMax}
                onChange={(e) => setDaysMax(e.target.value)}
                min={0}
              />
            </label>
          </div>
          <label className="block">
            <span className="block text-xs text-ink-tertiary mb-1">{t("shipping.labelCountries")}</span>
            <Input
              type="text"
              value={countries}
              onChange={(e) => setCountries(e.target.value)}
              placeholder="DE, AT, CH"
            />
            <span className="block text-xs text-ink-tertiary mt-0.5">{t("shipping.countriesHint")}</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />{t("shipping.active")}</label>

          {error && (
            <div className="rounded border border-semantic-danger/30 bg-semantic-danger/8 px-2 py-1.5 text-xs text-semantic-danger">
              {error}
            </div>
          )}

          <div className="flex gap-2 justify-end pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={saving}
            >{t("common.cancel")}</Button>
            <Button type="submit" disabled={saving}>{t("common.save")}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
