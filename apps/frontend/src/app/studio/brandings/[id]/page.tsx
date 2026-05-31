"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, type BrandingDetail } from "@/lib/api";
import { PageHeader } from "@/components/studio/PageHeader";
import { MarkdownField } from "@/components/studio/MarkdownField";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui";

export default function BrandingEditorPage() {
  const t = useT();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [branding, setBranding] = useState<BrandingDetail | null>(null);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lokaler Edit-State (debounced auf den Server gesynced)
  const [name, setName] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#0f172a");
  const [accentColor, setAccentColor] = useState("#f59e0b");
  const [fontFamily, setFontFamily] = useState("Inter");
  const [introText, setIntroText] = useState("");
  const [footerText, setFooterText] = useState("");
  const [customCss, setCustomCss] = useState("");

  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const logoLightInputRef = useRef<HTMLInputElement | null>(null);
  const faviconInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingKind, setUploadingKind] = useState<
    "logo" | "logoLight" | "favicon" | null
  >(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getBranding(id);
      setBranding(res.branding);
      setName(res.branding.name);
      setPrimaryColor(res.branding.primaryColor);
      setAccentColor(res.branding.accentColor);
      setFontFamily(res.branding.fontFamily);
      setIntroText(res.branding.introText ?? "");
      setFooterText(res.branding.footerText ?? "");
      setCustomCss(res.branding.customCss ?? "");
      // Default-Status nachladen
      const list = await api.listBrandings();
      setDefaultId(list.defaultBrandingId);
    } catch (err) {
      if (err instanceof Error && err.message.includes("401")) {
        router.replace("/login");
        return;
      }
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const { branding: updated } = await api.updateBranding(id, {
        name,
        primaryColor,
        accentColor,
        fontFamily,
        introText: introText.trim() || null,
        footerText: footerText.trim() || null,
        customCss: customCss.trim() || null,
      });
      setBranding(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  async function makeDefault() {
    await api.setDefaultBranding(id);
    setDefaultId(id);
  }

  async function remove() {
    if (
      !confirm(
        t("brandingEditor.confirmDelete")
      )
    )
      return;
    await api.deleteBranding(id);
    router.push("/studio/brandings");
  }

  async function uploadAsset(
    kind: "logo" | "logoLight" | "favicon",
    file: File
  ) {
    setUploadingKind(kind);
    setError(null);
    try {
      const init = await api.initBrandingAssetUpload(id, {
        kind,
        contentType: file.type,
        sizeBytes: file.size,
      });
      const put = await fetch(init.uploadUrl, {
        method: "PUT",
        headers: init.headers,
        body: file,
      });
      if (!put.ok) {
        throw new Error(`Upload fehlgeschlagen: HTTP ${put.status}`);
      }
      const { branding: updated } = await api.completeBrandingAssetUpload(id, {
        kind,
        key: init.key,
      });
      setBranding(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setUploadingKind(null);
    }
  }

  async function removeAsset(
    kind: "logo" | "logoLight" | "favicon"
  ) {
    const labels = {
      logo: t("brandingEditor.labelLogo"),
      logoLight: t("brandingEditor.remLogoLight"),
      favicon: t("brandingEditor.labelFavicon"),
    } as const;
    if (!confirm(t("brandingEditor.confirmRemoveAsset", { label: labels[kind] }))) return;
    const { branding: updated } = await api.deleteBrandingAsset(id, kind);
    setBranding(updated);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-ui text-ink-tertiary">{t("common.loading")}</div>
    );
  }
  if (!branding) {
    return (
      <div className="px-6 sm:px-8 lg:px-12 py-8">
        <div className="text-ui text-semantic-danger">
          {error ?? t("brandingEditor.notFound")}
        </div>
      </div>
    );
  }

  const isDefault = defaultId === id;

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: t("brandingEditor.breadcrumbStudio"), href: "/studio" },
          { label: t("brandingEditor.breadcrumb"), href: "/studio/brandings" },
          { label: branding.name },
        ]}
        title={branding.name}
        description={
          isDefault ? t("brandingEditor.defaultDesc") : undefined
        }
        actions={
          <>
            {!isDefault && (
              <Button variant="secondary" onClick={makeDefault}>{t("brandingEditor.makeDefault")}</Button>
            )}
            <Button variant="danger" onClick={remove}>{t("common.delete")}</Button>
            <Button variant="primary" onClick={save} disabled={saving}>
              {saving ? t("common.saving") : t("common.save")}
            </Button>
          </>
        }
      />

      <div className="px-6 sm:px-8 lg:px-12 py-6 space-y-6 max-w-6xl">

        {error && (
          <div className="text-sm text-semantic-danger bg-semantic-danger/10 border border-semantic-danger/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Form */}
          <div className="space-y-4">
            <Field label={t("brandingEditor.labelName")}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-line-subtle px-3 py-2 text-sm"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label={t("brandingEditor.labelPrimary")}>
                <ColorField value={primaryColor} onChange={setPrimaryColor} />
              </Field>
              <Field label={t("brandingEditor.labelAccent")}>
                <ColorField value={accentColor} onChange={setAccentColor} />
              </Field>
            </div>
            <p className="text-ui-xs text-ink-tertiary -mt-2 mb-1 leading-relaxed">
              <strong className="text-ink-secondary font-medium">{t("brandingEditor.whereItWorks")}</strong>{" "}
              {t("brandingEditor.colorHelp")}
            </p>

            <Field label={t("brandingEditor.labelFont")}>
              <select
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                className="w-full rounded-md border border-line-subtle px-3 py-2 text-sm bg-surface-raised"
              >
                <option value="Inter">{t("brandingEditor.fontInter")}</option>
                <option value="Playfair Display">Playfair Display (Serif)</option>
                <option value="Cormorant Garamond">Cormorant Garamond (Serif)</option>
                <option value="DM Sans">DM Sans</option>
                <option value="Lora">Lora (Serif)</option>
                <option value="Montserrat">Montserrat</option>
                <option value="Source Sans 3">Source Sans 3</option>
                <option value="system-ui">{t("brandingEditor.fontSystem")}</option>
              </select>
            </Field>

            <MarkdownField
              label={t("brandingEditor.introLabel")}
              value={introText}
              onChange={setIntroText}
              rows={3}
              maxLength={2000}
              placeholder={t("brandingEditor.introPlaceholder")}
              hint={t("brandingEditor.introHint")}
            />

            <Field label={t("brandingEditor.footerLabel")}>
              <input
                value={footerText}
                onChange={(e) => setFooterText(e.target.value)}
                placeholder={t("brandingEditor.footerPlaceholder")}
                className="w-full rounded-md border border-line-subtle px-3 py-2 text-sm"
              />
            </Field>

            {/* Logo (Standard + helle Variante fuer dunkle Hintergruende)
                + Favicon. Helle Variante ist optional — wenn das Logo
                ohnehin hell/farbig ist, kann sie leer bleiben; die
                Login-Seite faellt dann auf das Standard-Logo zurueck. */}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <AssetField
                  label={t("brandingEditor.labelLogo")}
                  imageUrl={branding.logoUrl}
                  accept="image/png,image/jpeg,image/svg+xml"
                  hint={t("brandingEditor.hintLogo")}
                  uploading={uploadingKind === "logo"}
                  inputRef={logoInputRef}
                  onPick={() => logoInputRef.current?.click()}
                  onFile={(f) => uploadAsset("logo", f)}
                  onRemove={() => removeAsset("logo")}
                />
                <AssetField
                  label={t("brandingEditor.labelLogoLight")}
                  imageUrl={branding.logoLightUrl}
                  accept="image/png,image/jpeg,image/svg+xml"
                  hint={t("brandingEditor.hintLogoLight")}
                  uploading={uploadingKind === "logoLight"}
                  inputRef={logoLightInputRef}
                  onPick={() => logoLightInputRef.current?.click()}
                  onFile={(f) => uploadAsset("logoLight", f)}
                  onRemove={() => removeAsset("logoLight")}
                  darkPreview
                />
              </div>
              <AssetField
                label={t("brandingEditor.labelFavicon")}
                imageUrl={branding.faviconUrl}
                accept="image/png,image/x-icon,image/vnd.microsoft.icon"
                hint={t("brandingEditor.hintFavicon")}
                uploading={uploadingKind === "favicon"}
                inputRef={faviconInputRef}
                onPick={() => faviconInputRef.current?.click()}
                onFile={(f) => uploadAsset("favicon", f)}
                onRemove={() => removeAsset("favicon")}
              />
            </div>

            <Field label={t("brandingEditor.cssLabel")}>
              <textarea
                value={customCss}
                onChange={(e) => setCustomCss(e.target.value)}
                rows={5}
                placeholder=".lumio-gallery { /* … */ }"
                className="w-full rounded-md border border-line-subtle px-3 py-2 text-xs font-mono"
              />
            </Field>
          </div>

          {/* Live-Preview */}
          <div className="space-y-2">
            <div className="text-sm font-medium">{t("brandingEditor.previewTitle")}</div>
            <BrandingPreview
              primaryColor={primaryColor}
              accentColor={accentColor}
              fontFamily={fontFamily}
              logoUrl={branding.logoUrl}
              introText={introText}
              footerText={footerText}
            />
            <p className="text-xs text-ink-tertiary">
              {t("brandingEditor.previewNote")}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-ink-secondary">{label}</label>
      {children}
    </div>
  );
}

function ColorField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useT();
  const valid = /^#[0-9a-fA-F]{6}$/.test(value.trim());
  return (
    <div className="flex items-center gap-2">
      {/* Sichtbares Farb-Swatch. Das native <input type="color"> liegt
          unsichtbar darüber und öffnet beim Klick den OS-Picker — so
          umgehen wir das kollabierende Default-Rendering des color-
          Inputs (zeigte sich nur als dünner Strich). */}
      <label
        className="relative w-10 h-9 rounded border border-line-subtle cursor-pointer overflow-hidden shrink-0"
        style={{ backgroundColor: valid ? value : "transparent" }}
        title={t("brandingEditor.colorPickerTitle")}
      >
        <input
          type="color"
          value={valid ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="absolute -inset-1 w-[calc(100%+8px)] h-[calc(100%+8px)] opacity-0 cursor-pointer"
        />
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 rounded-md border border-line-subtle px-3 py-2 text-sm font-mono"
        pattern="^#[0-9a-fA-F]{6}$"
        spellCheck={false}
      />
    </div>
  );
}

function AssetField({
  label,
  imageUrl,
  accept,
  hint,
  uploading,
  inputRef,
  onPick,
  onFile,
  onRemove,
  previewHeight = "small",
  darkPreview = false,
}: {
  label: string;
  imageUrl: string | null;
  accept: string;
  hint: string;
  uploading: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPick: () => void;
  onFile: (file: File) => void;
  onRemove: () => void;
  /** "small" für Logo/Favicon, "large" für Hero-Background. */
  previewHeight?: "small" | "large";
  /** Wenn true, wird der Preview-Container dunkler — damit weiße Logos
   *  und helle Varianten sichtbar bleiben. */
  darkPreview?: boolean;
}) {
  const t = useT();
  const previewCls =
    previewHeight === "large"
      ? "min-h-[180px] max-h-[260px]"
      : "min-h-[64px]";
  const imageCls =
    previewHeight === "large"
      ? "max-h-[240px] max-w-full object-cover w-full rounded"
      : "max-h-12 max-w-full object-contain";
  // Dark-Preview nutzt einen kraeftig dunklen Hintergrund (fast schwarz)
  // damit weiße / sehr helle Logos sichtbar sind. Standard ist der
  // gehobene Surface-Layer.
  const previewBg = darkPreview
    ? "bg-[#0a0a0c] border-[#1a1a1f]"
    : "bg-surface-raised border-line-subtle";
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-ink-secondary">{label}</label>
      <div className="rounded-md border border-line-subtle bg-surface-sunken p-3 space-y-2">
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            if (e.target) e.target.value = "";
          }}
        />
        {imageUrl ? (
          <div
            className={`border rounded p-2 flex items-center justify-center ${previewBg} ${previewCls}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="" className={imageCls} />
          </div>
        ) : (
          <div
            className={`text-xs text-ink-tertiary text-center py-3 flex items-center justify-center ${previewCls}`}
          >{t("brandingEditor.nothingUploaded")}</div>
        )}
        <div className="flex justify-between items-center gap-2">
          <button
            onClick={onPick}
            disabled={uploading}
            className="text-xs px-2 py-1 rounded border border-line-subtle hover:bg-surface-raised disabled:opacity-50"
          >
            {uploading ? "…" : imageUrl ? t("brandingEditor.replace") : t("brandingEditor.upload")}
          </button>
          {imageUrl && (
            <button
              onClick={onRemove}
              className="text-xs text-red-600 hover:underline"
            >{t("brandingEditor.removeBtn")}</button>
          )}
        </div>
        <div className="text-[10px] text-ink-tertiary">{hint}</div>
      </div>
    </div>
  );
}

function BrandingPreview({
  primaryColor,
  accentColor,
  fontFamily,
  logoUrl,
  introText,
  footerText,
}: {
  primaryColor: string;
  accentColor: string;
  fontFamily: string;
  logoUrl: string | null;
  introText: string;
  footerText: string;
}) {
  const t = useT();
  return (
    <div
      className="rounded-lg overflow-hidden border border-line-subtle shadow-sm"
      style={{ backgroundColor: primaryColor, fontFamily }}
    >
      {/* Header */}
      <div className="p-4 border-b border-white/10">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="h-8 max-w-[60%] object-contain" />
        ) : (
          <div className="text-accent-contrast/40 text-xs italic">{t("brandingEditor.previewLogo")}</div>
        )}
      </div>

      {/* Body */}
      <div className="p-6 space-y-4 text-accent-contrast">
        <h2 className="text-xl">{t("brandingEditor.demoGallery")}</h2>
        {introText && (
          <p className="text-sm opacity-80 whitespace-pre-wrap">{introText}</p>
        )}
        <div className="grid grid-cols-3 gap-2">
          <div className="aspect-square bg-surface-raised/10 rounded" />
          <div className="aspect-square bg-surface-raised/10 rounded" />
          <div className="aspect-square bg-surface-raised/10 rounded" />
        </div>
        <button
          className="text-sm px-3 py-1.5 rounded font-medium"
          style={{ backgroundColor: accentColor, color: primaryColor }}
        >{t("brandingEditor.exampleAction")}</button>
      </div>

      {/* Footer */}
      {footerText && (
        <div className="p-4 mt-4 border-t border-white/10 text-xs text-accent-contrast/60 text-center">
          {footerText}
        </div>
      )}
    </div>
  );
}
