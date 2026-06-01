"use client";

/**
 * Lumio — Endkunden-Print-Shop (Galerie)
 *
 * Multi-Step in einer Page (kein Routing zwischen Steps, weil Cart-
 * State sonst verloren ginge):
 *   1. browse — Files der Galerie, Picker-Modal pro File
 *   2. cart — Warenkorb-Review + Adresse + Bezahlmodus + AGB
 *   3. payment — Stripe-Payment (nur bei stripe_connect, sonst sofort
 *      Confirmation)
 *
 * Cart-State lebt im React-State (nicht persistent in localStorage —
 * Endkunden bestellen typisch in einer Session).
 *
 * Pre-Conditions:
 *   - Galerie muss freigeschaltet sein (Visitor-Cookie). Wenn nicht:
 *     Redirect zur Galerie-Hauptseite.
 *   - /g/:slug/print-shop/catalog liefert 404 wenn Print-Shop nicht
 *     verfuegbar — wir zeigen dann eine entsprechende Meldung.
 */
import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loadStripe, Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { api, type PublicFile } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { CropFrame, defaultCropForAspect, type Crop } from "@/components/print-shop/CropFrame";

type Catalog = Awaited<ReturnType<typeof api.getGalleryPrintShopCatalog>>;
type ProductRow = Catalog["products"][number];
type Variant = ProductRow["variants"][number];
type ShipMethod = Catalog["shipping"][number];

interface CartItem {
  variantId: string;
  fileId: string;
  fileName: string;
  fileThumbUrl: string | null;
  product: ProductRow;
  variant: Variant;
  quantity: number;
  crop: { x: number; y: number; width: number; height: number } | null;
}

export default function GalleryPrintShopPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const t = useT();
  const router = useRouter();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [files, setFiles] = useState<PublicFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"browse" | "cart" | "payment">("browse");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [picker, setPicker] = useState<PublicFile | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [cat, fls] = await Promise.all([
          api.getGalleryPrintShopCatalog(slug),
          api.listPublicFiles(slug),
        ]);
        setCatalog(cat);
        setFiles(fls.files.filter((f) => f.kind === "image"));
      } catch (err) {
        // 404 = Print-Shop nicht verfuegbar. 401 = Visitor-Cookie fehlt
        // -> Galerie zuerst freischalten.
        const msg = err instanceof Error ? err.message : t("printShop.error");
        if (msg.includes("401") || msg.toLowerCase().includes("unauth")) {
          router.replace(`/g/${slug}`);
          return;
        }
        setError(msg);
      }
    })();
  }, [slug, router]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full rounded-md border border-line-subtle bg-surface-raised p-6 text-center">
          <h1 className="text-lg font-semibold mb-2">{t("printShop.unavailable")}</h1>
          <p className="text-sm text-ink-tertiary mb-4">{error}</p>
          <Link
            href={`/g/${slug}`}
            className="text-sm text-accent hover:underline"
          >
            {t("printShop.backToGallery")}
          </Link>
        </div>
      </div>
    );
  }
  if (!catalog || !files) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-ink-tertiary">{t("common.loading")}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-canvas">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <Header
          slug={slug}
          studioName={catalog.config.studioDisplayName ?? catalog.gallery.title}
          step={step}
          cartCount={cart.reduce((s, i) => s + i.quantity, 0)}
          onGoToCart={() => setStep("cart")}
        />

        {step === "browse" && (
          <BrowseStep
            files={files}
            cart={cart}
            onPickFile={setPicker}
          />
        )}

        {step === "cart" && (
          <CartStep
            slug={slug}
            cart={cart}
            catalog={catalog}
            onBack={() => setStep("browse")}
            onUpdateCart={setCart}
            onRequirePayment={() => setStep("payment")}
            onConfirmed={(orderNumber) => {
              router.push(`/g/${slug}/print-shop/order/${orderNumber}`);
            }}
          />
        )}

        {picker && (
          <PickerDialog
            slug={slug}
            file={picker}
            catalog={catalog}
            onClose={() => setPicker(null)}
            onAdd={(item) => {
              setCart((prev) => [...prev, item]);
              setPicker(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Header
// =============================================================================
function Header({
  slug,
  studioName,
  step,
  cartCount,
  onGoToCart,
}: {
  slug: string;
  studioName: string;
  step: string;
  cartCount: number;
  onGoToCart: () => void;
}) {
  const t = useT();
  return (
    <header className="flex items-center justify-between mb-6 pb-4 border-b border-line-subtle">
      <div>
        <h1 className="text-xl font-semibold">{studioName} · Print-Shop</h1>
        <Link
          href={`/g/${slug}`}
          className="text-xs text-accent hover:underline"
        >
          ← {t("printShop.backToGallery")}
        </Link>
      </div>
      {step === "browse" && cartCount > 0 && (
        <button
          type="button"
          onClick={onGoToCart}
          className="px-4 py-2 text-sm rounded bg-accent text-white"
        >
          {t("printShop.cart", { count: cartCount })}
        </button>
      )}
    </header>
  );
}

// =============================================================================
// Browse Step: Files
// =============================================================================
function BrowseStep({
  files,
  cart,
  onPickFile,
}: {
  files: PublicFile[];
  cart: CartItem[];
  onPickFile: (f: PublicFile) => void;
}) {
  const t = useT();
  return (
    <div>
      <p className="text-sm text-ink-tertiary mb-4">
        {t("printShop.pickImage")}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {files.map((f) => {
          const inCart = cart.filter((c) => c.fileId === f.id).length;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => onPickFile(f)}
              className="relative group rounded overflow-hidden bg-surface-sunken aspect-square hover:opacity-90 transition-opacity"
            >
              {f.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={f.thumbUrl}
                  alt={f.filename}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-ink-tertiary">
                  {f.filename}
                </div>
              )}
              <div className="absolute inset-0 flex items-end justify-end p-2 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-black/50 to-transparent">
                <span className="text-xs text-white bg-accent px-2 py-1 rounded">
                  {t("printShop.orderBtn")}
                </span>
              </div>
              {inCart > 0 && (
                <span className="absolute top-2 right-2 inline-flex items-center justify-center w-6 h-6 rounded-full bg-accent text-white text-xs font-medium">
                  {inCart}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// =============================================================================
// Picker Dialog
// =============================================================================
function PickerDialog({
  file,
  catalog,
  onClose,
  onAdd,
}: {
  slug: string;
  file: PublicFile;
  catalog: Catalog;
  onClose: () => void;
  onAdd: (item: CartItem) => void;
}) {
  const t = useT();
  const [selectedProduct, setSelectedProduct] = useState<ProductRow | null>(
    catalog.products[0] ?? null
  );
  const [selectedVariant, setSelectedVariant] = useState<Variant | null>(
    catalog.products[0]?.variants[0] ?? null
  );
  const [quantity, setQuantity] = useState(1);
  // Crop-State: aktiv wenn die ausgewaehlte Variante eine fixed
  // aspectRatio hat UND wir die Bild-Pixel kennen (sonst koennten wir
  // nichts constrainen). Default-Crop kommt vom Helper, der User kann
  // ihn via Drag verschieben/resizen.
  const cropActive = !!(
    selectedVariant?.aspectRatio &&
    file.width &&
    file.height
  );
  const [crop, setCrop] = useState<Crop | null>(() =>
    cropActive
      ? defaultCropForAspect(
          file.width!,
          file.height!,
          selectedVariant!.aspectRatio!
        )
      : null
  );
  // Wenn die Variante wechselt, setzt CropFrame intern den Crop auf
  // das neue Default zurueck und ruft onChange — wir muessen also nur
  // synchron 'crop' nullen/setzen damit die ueberreichte initialCrop-
  // Prop stimmt.
  useEffect(() => {
    if (cropActive) {
      setCrop(
        defaultCropForAspect(
          file.width!,
          file.height!,
          selectedVariant!.aspectRatio!
        )
      );
    } else {
      setCrop(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVariant?.id, cropActive]);

  function add() {
    if (!selectedProduct || !selectedVariant) return;
    onAdd({
      variantId: selectedVariant.id,
      fileId: file.id,
      fileName: file.filename,
      fileThumbUrl: file.thumbUrl,
      product: selectedProduct,
      variant: selectedVariant,
      quantity,
      crop: cropActive ? crop : null,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-surface-raised rounded-md max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="grid sm:grid-cols-2 gap-0">
          <div className="bg-black flex items-center justify-center p-2 sm:p-3">
            {cropActive && file.width && file.height ? (
              <CropFrame
                imageUrl={file.previewUrl ?? file.thumbUrl ?? ""}
                imageWidth={file.width}
                imageHeight={file.height}
                aspectRatio={selectedVariant!.aspectRatio!}
                initialCrop={crop}
                onChange={setCrop}
                maxHeightPx={360}
              />
            ) : (
              file.thumbUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={file.previewUrl ?? file.thumbUrl}
                  alt={file.filename}
                  className="max-w-full max-h-[360px] object-contain"
                />
              )
            )}
          </div>
          <div className="p-5 space-y-4">
            <h3 className="text-lg font-semibold">{t("printShop.orderPrint")}</h3>

            {catalog.products.length === 0 ? (
              <p className="text-sm text-ink-tertiary">
                {t("printShop.noProducts")}
              </p>
            ) : (
              <>
                <label className="block">
                  <span className="block text-xs text-ink-tertiary mb-1">
                    {t("printShop.product")}
                  </span>
                  <select
                    className="w-full rounded border border-line-subtle bg-surface-raised px-2 py-1.5 text-sm"
                    value={selectedProduct?.id ?? ""}
                    onChange={(e) => {
                      const p = catalog.products.find(
                        (x) => x.id === e.target.value
                      );
                      setSelectedProduct(p ?? null);
                      setSelectedVariant(p?.variants[0] ?? null);
                    }}
                  >
                    {catalog.products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {selectedProduct?.description && (
                    <span className="block text-xs text-ink-tertiary mt-1">
                      {selectedProduct.description}
                    </span>
                  )}
                </label>

                {selectedProduct &&
                  selectedProduct.variants.length > 0 && (
                    <label className="block">
                      <span className="block text-xs text-ink-tertiary mb-1">
                        {t("printShop.variant")}
                      </span>
                      <select
                        className="w-full rounded border border-line-subtle bg-surface-raised px-2 py-1.5 text-sm"
                        value={selectedVariant?.id ?? ""}
                        onChange={(e) => {
                          const v = selectedProduct.variants.find(
                            (x) => x.id === e.target.value
                          );
                          setSelectedVariant(v ?? null);
                        }}
                      >
                        {selectedProduct.variants.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name} — {formatPrice(v.priceCents, catalog.config.currency)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                <label className="block">
                  <span className="block text-xs text-ink-tertiary mb-1">
                    {t("printShop.quantity")}
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={quantity}
                    onChange={(e) =>
                      setQuantity(
                        Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1))
                      )
                    }
                    className="w-24 rounded border border-line-subtle bg-surface-raised px-2 py-1.5 text-sm"
                  />
                </label>

                {cropActive && (
                  <p className="text-xs text-ink-tertiary bg-surface-sunken rounded px-2 py-1.5">
                    {t("printShop.cropHint")}
                  </p>
                )}

                <div className="text-sm pt-2 border-t border-line-subtle flex justify-between">
                  <span className="text-ink-tertiary">{t("printShop.subtotal")}</span>
                  <span className="font-semibold tabular-nums">
                    {formatPrice(
                      (selectedVariant?.priceCents ?? 0) * quantity,
                      catalog.config.currency
                    )}
                  </span>
                </div>
              </>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-3 py-2 text-sm rounded border border-line-subtle"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={add}
                disabled={!selectedVariant}
                className="flex-1 px-3 py-2 text-sm rounded bg-accent text-white disabled:opacity-50"
              >
                {t("printShop.toCart")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Cart Step
// =============================================================================
function CartStep({
  slug,
  cart,
  catalog,
  onBack,
  onUpdateCart,
  onConfirmed,
}: {
  slug: string;
  cart: CartItem[];
  catalog: Catalog;
  onBack: () => void;
  onUpdateCart: (c: CartItem[]) => void;
  onRequirePayment: () => void;
  onConfirmed: (orderNumber: string) => void;
}) {
  const t = useT();
  const [shippingMethodId, setShippingMethodId] = useState<string>(
    catalog.shipping[0]?.id ?? ""
  );
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [addr, setAddr] = useState({
    street: "",
    street2: "",
    postalCode: "",
    city: "",
    countryCode: "DE",
    phone: "",
  });
  const [guestNote, setGuestNote] = useState("");
  const [paymentMode, setPaymentMode] = useState<
    "stripe_connect" | "offline_invoice"
  >(catalog.payment.stripeConnectReady ? "stripe_connect" : "offline_invoice");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stripeIntent, setStripeIntent] = useState<{
    clientSecret: string;
    publishableKey: string;
    stripeAccountId: string;
    orderNumber: string;
  } | null>(null);

  // Live-Preis-Berechnung
  const [totals, setTotals] = useState<{
    subtotalCents: number;
    shippingCents: number;
    taxCents: number;
    totalCents: number;
    currency: string;
  } | null>(null);

  useEffect(() => {
    if (cart.length === 0) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const r = await api.priceGalleryCart(slug, {
          items: cart.map((c) => ({
            variantId: c.variantId,
            fileId: c.fileId,
            quantity: c.quantity,
            crop: c.crop,
          })),
          shippingMethodId: shippingMethodId || null,
        });
        if (!ctrl.signal.aborted) setTotals(r);
      } catch {
        // ignore preview-Fehler
      }
    })();
    return () => ctrl.abort();
  }, [cart, shippingMethodId, slug]);

  function removeItem(idx: number) {
    onUpdateCart(cart.filter((_, i) => i !== idx));
  }
  function updateQty(idx: number, q: number) {
    onUpdateCart(
      cart.map((it, i) => (i === idx ? { ...it, quantity: Math.max(1, q) } : it))
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.checkoutGalleryCart(slug, {
        items: cart.map((c) => ({
          variantId: c.variantId,
          fileId: c.fileId,
          quantity: c.quantity,
          crop: c.crop,
        })),
        shippingMethodId,
        guestName,
        guestEmail,
        shippingAddress: {
          street: addr.street,
          ...(addr.street2 ? { street2: addr.street2 } : {}),
          postalCode: addr.postalCode,
          city: addr.city,
          countryCode: addr.countryCode,
          ...(addr.phone ? { phone: addr.phone } : {}),
        },
        paymentMode,
        guestNote: guestNote || undefined,
        acceptedTerms,
      });

      if (
        r.payment.mode === "stripe_connect" &&
        catalog.payment.stripePublishableKey &&
        catalog.payment.stripeAccountId
      ) {
        setStripeIntent({
          clientSecret: r.payment.clientSecret,
          publishableKey: catalog.payment.stripePublishableKey,
          stripeAccountId: catalog.payment.stripeAccountId,
          orderNumber: r.orderNumber,
        });
      } else {
        // Offline: direkt zur Bestaetigung
        onConfirmed(r.orderNumber);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("printShop.error"));
    } finally {
      setBusy(false);
    }
  }

  if (cart.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-ink-tertiary mb-4">
          {t("printShop.cartEmpty")}
        </p>
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 text-sm rounded border border-line-subtle"
        >
          {t("printShop.cartButtonArrow")}
        </button>
      </div>
    );
  }

  // Wenn Stripe-Intent vorhanden: Payment-Form rendern
  if (stripeIntent) {
    return (
      <StripePaymentStep
        stripeIntent={stripeIntent}
        onSuccess={() => onConfirmed(stripeIntent.orderNumber)}
        onCancel={() => setStripeIntent(null)}
      />
    );
  }

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="text-xs text-accent hover:underline"
      >
        {t("printShop.continueShopping")}
      </button>

      {/* Cart-Items */}
      <section className="rounded-md border border-line-subtle bg-surface-raised p-4">
        <h2 className="text-sm font-semibold mb-3">
          {t("printShop.cart", { count: cart.length })}
        </h2>
        <ul className="divide-y divide-line-subtle">
          {cart.map((it, idx) => (
            <li
              key={`${it.fileId}-${it.variantId}-${idx}`}
              className="py-3 flex items-center gap-3"
            >
              {it.fileThumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={it.fileThumbUrl}
                  alt={it.fileName}
                  className="w-16 h-16 object-cover rounded shrink-0"
                />
              ) : (
                <div className="w-16 h-16 bg-surface-sunken rounded shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {it.product.name}
                </div>
                <div className="text-xs text-ink-tertiary">
                  {it.variant.name} ({it.variant.widthMm}×{it.variant.heightMm} mm)
                </div>
              </div>
              <input
                type="number"
                min={1}
                max={20}
                value={it.quantity}
                onChange={(e) => updateQty(idx, parseInt(e.target.value, 10) || 1)}
                className="w-16 rounded border border-line-subtle bg-surface-raised px-2 py-1 text-sm"
              />
              <div className="text-sm tabular-nums w-20 text-right">
                {formatPrice(
                  it.variant.priceCents * it.quantity,
                  catalog.config.currency
                )}
              </div>
              <button
                type="button"
                onClick={() => removeItem(idx)}
                className="text-xs text-ink-tertiary hover:text-semantic-danger"
                aria-label={t("printShop.remove")}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Versand */}
      <section className="rounded-md border border-line-subtle bg-surface-raised p-4">
        <h2 className="text-sm font-semibold mb-3">{t("printShop.shipping")}</h2>
        <select
          className="w-full rounded border border-line-subtle bg-surface-raised px-2 py-1.5 text-sm"
          value={shippingMethodId}
          onChange={(e) => setShippingMethodId(e.target.value)}
        >
          {catalog.shipping.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} — {formatPrice(m.priceCents, catalog.config.currency)}
              {m.estimatedDaysMin &&
                ` (${t("printShop.shippingDays", { min: m.estimatedDaysMin, max: m.estimatedDaysMax ?? m.estimatedDaysMin })})`}
            </option>
          ))}
        </select>
      </section>

      {/* Lieferadresse */}
      <section className="rounded-md border border-line-subtle bg-surface-raised p-4">
        <h2 className="text-sm font-semibold mb-3">{t("printShop.shippingAddress")}</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <FieldRow
            label={t("printShop.fullName")}
            required
            value={guestName}
            onChange={setGuestName}
          />
          <FieldRow
            label={t("printShop.email")}
            type="email"
            required
            value={guestEmail}
            onChange={setGuestEmail}
          />
          <FieldRow
            label={t("printShop.street")}
            required
            value={addr.street}
            onChange={(v) => setAddr({ ...addr, street: v })}
            className="sm:col-span-2"
          />
          <FieldRow
            label={t("printShop.addressExtra")}
            value={addr.street2}
            onChange={(v) => setAddr({ ...addr, street2: v })}
            className="sm:col-span-2"
          />
          <FieldRow
            label={t("printShop.postalCode")}
            required
            value={addr.postalCode}
            onChange={(v) => setAddr({ ...addr, postalCode: v })}
          />
          <FieldRow
            label={t("printShop.city")}
            required
            value={addr.city}
            onChange={(v) => setAddr({ ...addr, city: v })}
          />
          <FieldRow
            label={t("printShop.country")}
            required
            value={addr.countryCode}
            onChange={(v) => setAddr({ ...addr, countryCode: v.toUpperCase() })}
          />
          <FieldRow
            label={t("printShop.phone")}
            value={addr.phone}
            onChange={(v) => setAddr({ ...addr, phone: v })}
          />
        </div>
      </section>

      {/* Notiz */}
      <section className="rounded-md border border-line-subtle bg-surface-raised p-4">
        <label className="block">
          <span className="block text-sm font-semibold mb-2">
            {t("printShop.note")}
          </span>
          <textarea
            value={guestNote}
            onChange={(e) => setGuestNote(e.target.value)}
            rows={2}
            placeholder={t("printShop.notePlaceholder")}
            className="w-full rounded border border-line-subtle bg-surface-raised px-2 py-1.5 text-sm"
          />
        </label>
      </section>

      {/* Bezahlmodus */}
      <section className="rounded-md border border-line-subtle bg-surface-raised p-4">
        <h2 className="text-sm font-semibold mb-3">{t("printShop.payment")}</h2>
        <div className="space-y-2">
          {catalog.payment.stripeConnectReady && (
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="payment"
                value="stripe_connect"
                checked={paymentMode === "stripe_connect"}
                onChange={() => setPaymentMode("stripe_connect")}
                className="mt-1"
              />
              <span className="text-sm">
                <strong>{t("printShop.payOnline")}</strong>
                <span className="block text-xs text-ink-tertiary">
                  {t("printShop.payOnlineHint")}
                </span>
              </span>
            </label>
          )}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="payment"
              value="offline_invoice"
              checked={paymentMode === "offline_invoice"}
              onChange={() => setPaymentMode("offline_invoice")}
              className="mt-1"
            />
            <span className="text-sm">
              <strong>{t("printShop.payInvoice")}</strong>
              <span className="block text-xs text-ink-tertiary">
                {t("printShop.payInvoiceHint")}
              </span>
            </span>
          </label>
        </div>
      </section>

      {/* Totals */}
      {totals && (
        <section className="rounded-md border border-line-subtle bg-surface-raised p-4">
          <dl className="text-sm space-y-1">
            <div className="flex justify-between">
              <dt className="text-ink-tertiary">{t("printShop.subtotal")}</dt>
              <dd className="tabular-nums">
                {formatPrice(totals.subtotalCents, totals.currency)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-tertiary">{t("printShop.shipping")}</dt>
              <dd className="tabular-nums">
                {formatPrice(totals.shippingCents, totals.currency)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-tertiary">
                {t("printShop.vat")} (
                {catalog.config.vatHandling === "inclusive"
                  ? t("printShop.vatIncluded")
                  : t("printShop.vatAdded")}
                )
              </dt>
              <dd className="tabular-nums">
                {formatPrice(totals.taxCents, totals.currency)}
              </dd>
            </div>
            <div className="flex justify-between pt-2 border-t border-line-subtle font-semibold">
              <dt>{t("printShop.total")}</dt>
              <dd className="tabular-nums">
                {formatPrice(totals.totalCents, totals.currency)}
              </dd>
            </div>
          </dl>
        </section>
      )}

      {/* AGB */}
      {(catalog.config.termsUrl || catalog.config.privacyUrl) && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            className="mt-1"
          />
          <span>
            {t("printShop.acceptTermsPre")}{" "}
            {catalog.config.termsUrl && (
              <a
                href={catalog.config.termsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                {t("printShop.terms")}
              </a>
            )}
            {catalog.config.termsUrl &&
              catalog.config.privacyUrl &&
              ` ${t("printShop.and")} `}
            {catalog.config.privacyUrl && (
              <a
                href={catalog.config.privacyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                {t("printShop.privacy")}
              </a>
            )}
            .
          </span>
        </label>
      )}
      {!catalog.config.termsUrl && !catalog.config.privacyUrl && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            className="mt-1"
          />
          <span>{t("printShop.confirmNoTerms")}</span>
        </label>
      )}

      {error && (
        <div className="rounded-md border border-semantic-danger/30 bg-semantic-danger/8 px-3 py-2 text-sm text-semantic-danger">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={busy || !acceptedTerms || !guestName || !guestEmail}
        className="w-full px-4 py-3 rounded bg-accent text-white font-medium disabled:opacity-50"
      >
        {busy
          ? t("printShop.ordering")
          : paymentMode === "stripe_connect"
            ? t("printShop.toPayment")
            : t("printShop.submitOrder")}
      </button>
    </div>
  );
}

function FieldRow({
  label,
  type = "text",
  required,
  value,
  onChange,
  className,
}: {
  label: string;
  type?: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="block text-xs text-ink-tertiary mb-1">
        {label} {required && <span className="text-semantic-danger">*</span>}
      </span>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-line-subtle bg-surface-raised px-2 py-1.5 text-sm"
      />
    </label>
  );
}

// =============================================================================
// Stripe Payment Step
// =============================================================================
const stripePromises = new Map<string, Promise<Stripe | null>>();
function getStripePromise(
  publishableKey: string,
  stripeAccount: string
): Promise<Stripe | null> {
  const cacheKey = `${publishableKey}::${stripeAccount}`;
  if (!stripePromises.has(cacheKey)) {
    stripePromises.set(
      cacheKey,
      loadStripe(publishableKey, { stripeAccount })
    );
  }
  return stripePromises.get(cacheKey)!;
}

function StripePaymentStep({
  stripeIntent,
  onSuccess,
  onCancel,
}: {
  stripeIntent: {
    clientSecret: string;
    publishableKey: string;
    stripeAccountId: string;
    orderNumber: string;
  };
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const stripePromise = useMemo(
    () =>
      getStripePromise(
        stripeIntent.publishableKey,
        stripeIntent.stripeAccountId
      ),
    [stripeIntent]
  );

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onCancel}
        className="text-xs text-accent hover:underline"
      >
        ← {t("printShop.backToCart")}
      </button>
      <section className="rounded-md border border-line-subtle bg-surface-raised p-4">
        <h2 className="text-sm font-semibold mb-3">{t("printShop.payment")}</h2>
        <Elements
          stripe={stripePromise}
          options={{ clientSecret: stripeIntent.clientSecret }}
        >
          <PaymentForm onSuccess={onSuccess} />
        </Elements>
      </section>
    </div>
  );
}

function PaymentForm({ onSuccess }: { onSuccess: () => void }) {
  const t = useT();
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const result = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });
    if (result.error) {
      setError(result.error.message ?? t("printShop.paymentFailed"));
      setBusy(false);
      return;
    }
    if (
      result.paymentIntent &&
      (result.paymentIntent.status === "succeeded" ||
        result.paymentIntent.status === "processing")
    ) {
      onSuccess();
    } else {
      setError(t("printShop.unexpectedState"));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <PaymentElement />
      {error && (
        <div className="rounded-md border border-semantic-danger/30 bg-semantic-danger/8 px-3 py-2 text-sm text-semantic-danger">
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={!stripe || busy}
        className="w-full px-4 py-3 rounded bg-accent text-white font-medium disabled:opacity-50"
      >
        {busy ? t("printShop.processing") : t("printShop.payNow")}
      </button>
    </form>
  );
}

function formatPrice(cents: number, currency = "EUR"): string {
  return (cents / 100).toLocaleString("de-DE", {
    style: "currency",
    currency,
  });
}
