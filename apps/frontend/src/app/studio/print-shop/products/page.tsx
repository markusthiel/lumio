"use client";

/**
 * Lumio Studio — Print-Produkt-Katalog
 *
 * CRUD fuer Produkte und ihre Varianten. Produkt = ein 'Typ' (z.B.
 * Premium-Print-Glanz). Variante = konkrete Groesse + Material + Preis.
 *
 * Pragmatisches Layout: aufgeklappte Produkt-Karten mit Inline-Varianten.
 * Editierung ueber einen modalen Dialog (statt Inline-Edit) — weniger
 * State-Wirrwarr.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import type {
  PrintProductCreateInput,
  PrintVariantCreateInput,
} from "@/lib/api";
import { Button, Input, Select, Textarea } from "@/components/ui";

type Product = Awaited<
  ReturnType<typeof api.listPrintProducts>
>["products"][number];
type Variant = Product["variants"][number];
type ProviderMine = Awaited<
  ReturnType<typeof api.listTenantPrintProviders>
>["providers"][number];

const CATEGORIES = [
  { value: "print", label: "printProducts.catPrint" },
  { value: "canvas", label: "printProducts.catCanvas" },
  { value: "photobook", label: "printProducts.catPhotobook" },
  { value: "frame", label: "printProducts.catFrame" },
  { value: "metal_print", label: "printProducts.catMetalPrint" },
  { value: "poster", label: "printProducts.catPoster" },
] as const;

export default function PrintProductsPage() {
  const t = useT();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [providers, setProviders] = useState<ProviderMine[] | null>(null);
  const [editing, setEditing] = useState<
    | { mode: "create-product" }
    | { mode: "edit-product"; product: Product }
    | { mode: "create-variant"; product: Product }
    | { mode: "edit-variant"; product: Product; variant: Variant }
    | null
  >(null);
  const [message, setMessage] = useState<
    { kind: "success" | "danger"; text: string } | null
  >(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, pr] = await Promise.all([
        api.listPrintProducts(),
        api.listTenantPrintProviders(),
      ]);
      setProducts(p.products);
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

  async function deleteProduct(p: Product) {
    if (!confirm(t("printProducts.deleteProductConfirm", { name: p.name }))) return;
    setBusy(true);
    try {
      await api.deletePrintProduct(p.id);
      await load();
      setMessage({ kind: "success", text: t("printProducts.productDeleted") });
    } catch (err) {
      setMessage({
        kind: "danger",
        text: err instanceof Error ? err.message : t("common.error"),
      });
    } finally {
      setBusy(false);
    }
  }

  async function deleteVariant(v: Variant) {
    if (!confirm(t("printProducts.deleteVariantConfirm", { name: v.name }))) return;
    setBusy(true);
    try {
      await api.deletePrintVariant(v.id);
      await load();
      setMessage({ kind: "success", text: t("printProducts.variantDeleted") });
    } catch (err) {
      setMessage({
        kind: "danger",
        text: err instanceof Error ? err.message : t("common.error"),
      });
    } finally {
      setBusy(false);
    }
  }

  if (!products || !providers) {
    return <div className="text-sm text-ink-tertiary">Lädt…</div>;
  }

  const enabledProviders = providers.filter((p) => p.enabled);

  if (enabledProviders.length === 0) {
    return (
      <div className="rounded-md border border-semantic-warning/30 bg-semantic-warning/8 px-3 py-4 text-sm text-semantic-warning">
        Du hast noch keinen aktiven Anbieter — Produkte können erst
        angelegt werden, wenn mindestens ein Anbieter konfiguriert ist.{" "}
        <a
          href="/studio/print-shop/providers"
          className="underline font-medium"
        >
          Zu den Anbietern
        </a>
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
        <Button
          onClick={() => setEditing({ mode: "create-product" })}
          disabled={busy}
        >{t("printProducts.addProduct")}</Button>
      </div>

      {products.length === 0 ? (
        <div className="rounded-md border border-line-subtle bg-surface-raised px-4 py-6 text-sm text-ink-tertiary text-center">{t("printProducts.noProducts")}</div>
      ) : (
        <ul className="space-y-3">
          {products.map((p) => (
            <li
              key={p.id}
              className="rounded-md border border-line-subtle bg-surface-raised p-4"
            >
              <div className="flex items-start gap-3 flex-wrap mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <strong className="text-sm">{p.name}</strong>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-surface-sunken text-ink-secondary">
                      {(() => { const cat = CATEGORIES.find((c) => c.value === p.category); return cat ? t(cat.label) : p.category; })() ??
                        p.category}
                    </span>
                    {!p.enabled && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-surface-sunken text-ink-tertiary">
                        inaktiv
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-ink-tertiary">
                    Anbieter:{" "}
                    {providers.find((pr) => pr.providerKey === p.providerKey)
                      ?.providerLabel ?? p.providerKey}
                    {p.providerProductRef &&
                      ` · SKU: ${p.providerProductRef}`}
                  </div>
                  {p.description && (
                    <div className="text-xs text-ink-secondary mt-1">
                      {p.description}
                    </div>
                  )}
                </div>
                <div className="flex gap-1 flex-wrap">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setEditing({ mode: "edit-product", product: p })}
                    disabled={busy}
                  >{t("common.edit")}</Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => deleteProduct(p)}
                    disabled={busy}
                  >{t("common.delete")}</Button>
                </div>
              </div>

              {/* Varianten */}
              <div className="border-t border-line-subtle pt-3 mt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-ink-tertiary uppercase tracking-wide">
                    {t("printProducts.variantsCount", { n: p.variants.length })}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      setEditing({ mode: "create-variant", product: p })
                    }
                    disabled={busy}
                  >{t("printProducts.addVariant")}</Button>
                </div>
                {p.variants.length === 0 ? (
                  <div className="text-xs text-ink-tertiary py-2 text-center">
                    {t("printProducts.noVariants")}
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {p.variants.map((v) => (
                      <li
                        key={v.id}
                        className="flex items-center gap-2 text-sm py-1 flex-wrap"
                      >
                        <span className="flex-1 min-w-0">
                          <strong className="font-normal">{v.name}</strong>{" "}
                          <span className="text-ink-tertiary">
                            · {v.widthMm}×{v.heightMm} mm
                            {v.finishType && ` · ${v.finishType}`}
                            {!v.enabled && t("printProducts.inactiveSuffix")}
                          </span>
                        </span>
                        <span className="text-sm tabular-nums">
                          {formatPrice(v.priceCents)}
                          {v.costCents !== null && (
                            <span className="text-ink-tertiary text-xs ml-1">
                              {t("printProducts.costNote", { price: formatPrice(v.costCents) })}
                            </span>
                          )}
                        </span>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            setEditing({
                              mode: "edit-variant",
                              product: p,
                              variant: v,
                            })
                          }
                          disabled={busy}
                        >{t("common.edit")}</Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => deleteVariant(v)}
                          disabled={busy}
                        >{t("common.delete")}</Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && editing.mode.includes("product") && (
        <ProductDialog
          enabledProviders={enabledProviders}
          existing={
            editing.mode === "edit-product" ? editing.product : null
          }
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
            setMessage({ kind: "success", text: t("printProducts.saved") });
          }}
        />
      )}
      {editing && editing.mode.includes("variant") && "product" in editing && (
        <VariantDialog
          productId={editing.product.id}
          existing={
            editing.mode === "edit-variant" ? editing.variant : null
          }
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
            setMessage({ kind: "success", text: t("printProducts.saved") });
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

function ProductDialog({
  enabledProviders,
  existing,
  onClose,
  onSaved,
}: {
  enabledProviders: ProviderMine[];
  existing: Product | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [providerKey, setProviderKey] = useState(
    existing?.providerKey ?? enabledProviders[0]?.providerKey ?? ""
  );
  const [category, setCategory] = useState<PrintProductCreateInput["category"]>(
    (existing?.category as PrintProductCreateInput["category"]) ?? "print"
  );
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: PrintProductCreateInput = {
        name: name.trim(),
        description: description.trim() || null,
        providerKey,
        category,
        enabled,
      };
      if (existing) {
        await api.updatePrintProduct(existing.id, payload);
      } else {
        await api.createPrintProduct(payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} title={existing ? t("printProducts.editProductTitle") : t("printProducts.createProductTitle")}>
      <form onSubmit={submit} className="space-y-3">
        <FormRow label={t("printProducts.name")}>
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder={t("printProducts.namePlaceholderProduct")}
          />
        </FormRow>
        <FormRow label={t("printProducts.descOptional")}>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
        </FormRow>
        <FormRow label={t("printProducts.provider")}>
          <Select
            value={providerKey}
            onChange={(e) => setProviderKey(e.target.value)}
            required
          >
            {enabledProviders.map((p) => (
              <option key={p.providerKey} value={p.providerKey}>
                {p.providerLabel}
              </option>
            ))}
          </Select>
        </FormRow>
        <FormRow label={t("printProducts.category")}>
          <Select
            value={category}
            onChange={(e) =>
              setCategory(e.target.value as PrintProductCreateInput["category"])
            }
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {t(c.label)}
              </option>
            ))}
          </Select>
        </FormRow>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Im Endkunden-Katalog sichtbar
        </label>

        {error && <FormError>{error}</FormError>}
        <DialogActions onClose={onClose} saving={saving} />
      </form>
    </Modal>
  );
}

function VariantDialog({
  productId,
  existing,
  onClose,
  onSaved,
}: {
  productId: string;
  existing: Variant | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(existing?.name ?? "");
  const [widthMm, setWidthMm] = useState(String(existing?.widthMm ?? ""));
  const [heightMm, setHeightMm] = useState(String(existing?.heightMm ?? ""));
  const [finishType, setFinishType] = useState(existing?.finishType ?? "");
  const [priceEuros, setPriceEuros] = useState(
    existing ? (existing.priceCents / 100).toFixed(2) : ""
  );
  const [costEuros, setCostEuros] = useState(
    existing?.costCents !== null && existing?.costCents !== undefined
      ? (existing.costCents / 100).toFixed(2)
      : ""
  );
  const [aspectMode, setAspectMode] = useState<"free" | "fixed">(
    existing?.aspectRatio ? "fixed" : "free"
  );
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const w = parseInt(widthMm, 10);
      const h = parseInt(heightMm, 10);
      const price = Math.round(parseFloat(priceEuros) * 100);
      const cost = costEuros.trim()
        ? Math.round(parseFloat(costEuros) * 100)
        : null;
      if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) {
        throw new Error(t("printProducts.errWidthHeight"));
      }
      if (!Number.isFinite(price) || price < 0) {
        throw new Error(t("printProducts.errPrice"));
      }
      const payload: PrintVariantCreateInput = {
        name: name.trim(),
        widthMm: w,
        heightMm: h,
        aspectRatio: aspectMode === "fixed" ? w / h : null,
        finishType: finishType.trim() || null,
        priceCents: price,
        costCents: cost,
        enabled,
      };
      if (existing) {
        await api.updatePrintVariant(existing.id, payload);
      } else {
        await api.createPrintVariant(productId, payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} title={existing ? t("printProducts.editVariantTitle") : t("printProducts.createVariantTitle")}>
      <form onSubmit={submit} className="space-y-3">
        <FormRow label={t("printProducts.name")}>
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder={t("printProducts.namePlaceholderVariant")}
          />
        </FormRow>
        <div className="grid grid-cols-2 gap-3">
          <FormRow label={t("printProducts.widthMm")}>
            <Input
              type="number"
              value={widthMm}
              onChange={(e) => setWidthMm(e.target.value)}
              required
              min={1}
            />
          </FormRow>
          <FormRow label={t("printProducts.heightMm")}>
            <Input
              type="number"
              value={heightMm}
              onChange={(e) => setHeightMm(e.target.value)}
              required
              min={1}
            />
          </FormRow>
        </div>
        <FormRow label={t("printProducts.materialFinish")}>
          <Input
            type="text"
            value={finishType}
            onChange={(e) => setFinishType(e.target.value)}
            placeholder={t("printProducts.materialPlaceholder")}
          />
        </FormRow>
        <FormRow label={t("printProducts.aspectRatio")}>
          <Select
            value={aspectMode}
            onChange={(e) => setAspectMode(e.target.value as "free" | "fixed")}
          >
            <option value="free">{t("printProducts.aspectFree")}</option>
            <option value="fixed">{t("printProducts.aspectFixed")}</option>
          </Select>
        </FormRow>
        <div className="grid grid-cols-2 gap-3">
          <FormRow label={t("printProducts.priceEur")}>
            <Input
              type="number"
              step="0.01"
              value={priceEuros}
              onChange={(e) => setPriceEuros(e.target.value)}
              required
              min={0}
            />
          </FormRow>
          <FormRow label={t("printProducts.costEur")}>
            <Input
              type="number"
              step="0.01"
              value={costEuros}
              onChange={(e) => setCostEuros(e.target.value)}
              min={0}
              placeholder={t("printProducts.costPlaceholder")}
            />
          </FormRow>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />{t("printProducts.active")}</label>

        {error && <FormError>{error}</FormError>}
        <DialogActions onClose={onClose} saving={saving} />
      </form>
    </Modal>
  );
}

// =============================================================================
// Reusable Dialog Primitives
// =============================================================================

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
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
        <h3 className="text-lg font-semibold mb-4">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function FormRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs text-ink-tertiary mb-1">{label}</span>
      {children}
    </label>
  );
}

function FormError({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-semantic-danger/30 bg-semantic-danger/8 px-2 py-1.5 text-xs text-semantic-danger">
      {children}
    </div>
  );
}

function DialogActions({
  onClose,
  saving,
}: {
  onClose: () => void;
  saving: boolean;
}) {
  const t = useT();
  return (
    <div className="flex gap-2 justify-end pt-2">
      <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>{t("common.cancel")}</Button>
      <Button type="submit" disabled={saving}>{t("common.save")}</Button>
    </div>
  );
}
