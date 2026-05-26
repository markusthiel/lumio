"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, type BrandingDetail } from "@/lib/api";
import { PageHeader } from "@/components/studio/PageHeader";
import { MarkdownField } from "@/components/studio/MarkdownField";
import { Button } from "@/components/ui";

export default function BrandingEditorPage() {
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
  const [loginGreeting, setLoginGreeting] = useState("");

  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const logoLightInputRef = useRef<HTMLInputElement | null>(null);
  const faviconInputRef = useRef<HTMLInputElement | null>(null);
  const loginBgInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingKind, setUploadingKind] = useState<
    "logo" | "logoLight" | "favicon" | "loginBackground" | null
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
      setLoginGreeting(res.branding.loginGreeting ?? "");
      // Default-Status nachladen
      const list = await api.listBrandings();
      setDefaultId(list.defaultBrandingId);
    } catch (err) {
      if (err instanceof Error && err.message.includes("401")) {
        router.replace("/login");
        return;
      }
      setError(err instanceof Error ? err.message : "Fehler");
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
        loginGreeting: loginGreeting.trim() || null,
      });
      setBranding(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
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
        "Dieses Branding-Profil löschen? Galerien, die es nutzen, fallen auf das Default zurück."
      )
    )
      return;
    await api.deleteBranding(id);
    router.push("/studio/brandings");
  }

  async function uploadAsset(
    kind: "logo" | "logoLight" | "favicon" | "loginBackground",
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
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setUploadingKind(null);
    }
  }

  async function removeAsset(
    kind: "logo" | "logoLight" | "favicon" | "loginBackground"
  ) {
    const labels = {
      logo: "Logo",
      logoLight: "Helles Logo",
      favicon: "Favicon",
      loginBackground: "Login-Hintergrund",
    } as const;
    if (!confirm(`${labels[kind]} entfernen?`)) return;
    const { branding: updated } = await api.deleteBrandingAsset(id, kind);
    setBranding(updated);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-ui text-ink-tertiary">
        Lädt…
      </div>
    );
  }
  if (!branding) {
    return (
      <div className="px-6 sm:px-8 py-8">
        <div className="text-ui text-semantic-danger">
          {error ?? "Profil nicht gefunden."}
        </div>
      </div>
    );
  }

  const isDefault = defaultId === id;

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "Studio", href: "/studio" },
          { label: "Branding", href: "/studio/brandings" },
          { label: branding.name },
        ]}
        title={branding.name}
        description={
          isDefault ? "Tenant-Default — wird für Galerien ohne explizites Branding verwendet" : undefined
        }
        actions={
          <>
            {!isDefault && (
              <Button variant="secondary" onClick={makeDefault}>
                Als Default
              </Button>
            )}
            <Button variant="danger" onClick={remove}>
              Löschen
            </Button>
            <Button variant="primary" onClick={save} disabled={saving}>
              {saving ? "Speichert…" : "Speichern"}
            </Button>
          </>
        }
      />

      <div className="px-6 sm:px-8 py-6 space-y-6 max-w-6xl">

        {error && (
          <div className="text-sm text-semantic-danger bg-semantic-danger/10 border border-semantic-danger/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Form */}
          <div className="space-y-4">
            <Field label="Name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-line-subtle px-3 py-2 text-sm"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Primärfarbe (Hintergrund)">
                <ColorField value={primaryColor} onChange={setPrimaryColor} />
              </Field>
              <Field label="Akzentfarbe (Buttons, Links)">
                <ColorField value={accentColor} onChange={setAccentColor} />
              </Field>
            </div>
            <p className="text-ui-xs text-ink-tertiary -mt-2 mb-1 leading-relaxed">
              <strong className="text-ink-secondary font-medium">Wo das wirkt:</strong>{" "}
              Primärfarbe = Hintergrund der Galerie und automatisch
              passende Textfarbe (hell-auf-dunkel oder umgekehrt).
              Akzent = „Slideshow starten" und „Auswahl fertig"-Buttons,
              Like-Icon, Fokus-Indikatoren, Komment-Submit. Bei leeren
              Galerien sind viele dieser Elemente noch nicht sichtbar.
            </p>

            <Field label="Schrift">
              <select
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                className="w-full rounded-md border border-line-subtle px-3 py-2 text-sm bg-surface-raised"
              >
                <option value="Inter">Inter (Standard)</option>
                <option value="Playfair Display">Playfair Display (Serif)</option>
                <option value="Cormorant Garamond">Cormorant Garamond (Serif)</option>
                <option value="DM Sans">DM Sans</option>
                <option value="Lora">Lora (Serif)</option>
                <option value="Montserrat">Montserrat</option>
                <option value="Source Sans 3">Source Sans 3</option>
                <option value="system-ui">System</option>
              </select>
            </Field>

            <MarkdownField
              label="Intro-Text (vor der Galerie)"
              value={introText}
              onChange={setIntroText}
              rows={3}
              maxLength={2000}
              placeholder="z.B. Begrüßung des Kunden"
              hint="Markdown möglich: # Überschrift, **fett**, leere Zeile für Absatz."
            />

            <Field label="Footer-Text">
              <input
                value={footerText}
                onChange={(e) => setFooterText(e.target.value)}
                placeholder="© 2026 Mein Studio · Alle Rechte vorbehalten"
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
                  label="Logo"
                  imageUrl={branding.logoUrl}
                  accept="image/png,image/jpeg,image/svg+xml"
                  hint="PNG/JPEG/SVG, transparent empfohlen. Wird auf hellen Flächen genutzt."
                  uploading={uploadingKind === "logo"}
                  inputRef={logoInputRef}
                  onPick={() => logoInputRef.current?.click()}
                  onFile={(f) => uploadAsset("logo", f)}
                  onRemove={() => removeAsset("logo")}
                />
                <AssetField
                  label="Logo (hell)"
                  imageUrl={branding.logoLightUrl}
                  accept="image/png,image/jpeg,image/svg+xml"
                  hint="Helle/weiße Variante für dunkle Hintergründe (Studio-UI, Login-Hero). Optional — wenn leer, wird das Standard-Logo verwendet."
                  uploading={uploadingKind === "logoLight"}
                  inputRef={logoLightInputRef}
                  onPick={() => logoLightInputRef.current?.click()}
                  onFile={(f) => uploadAsset("logoLight", f)}
                  onRemove={() => removeAsset("logoLight")}
                  darkPreview
                />
              </div>
              <AssetField
                label="Favicon"
                imageUrl={branding.faviconUrl}
                accept="image/png,image/x-icon,image/vnd.microsoft.icon"
                hint="PNG oder ICO, quadratisch"
                uploading={uploadingKind === "favicon"}
                inputRef={faviconInputRef}
                onPick={() => faviconInputRef.current?.click()}
                onFile={(f) => uploadAsset("favicon", f)}
                onRemove={() => removeAsset("favicon")}
              />
            </div>

            {/* Login-Branding (eigene Sektion, klar abgegrenzt). Wirkt nur
                fuer das Tenant-Default-Branding auf der Studio-Login-Seite
                — bei anderen Brandings ist es trotzdem konfigurierbar
                damit man Setups vorbereiten kann. */}
            <div className="rounded-md border border-line-subtle bg-surface-sunken/40 p-4 space-y-3">
              <div>
                <div className="text-sm font-medium text-ink-primary">
                  Login-Seite
                </div>
                <div className="text-ui-xs text-ink-tertiary mt-0.5 leading-relaxed">
                  Hintergrundbild und Begrüßungstext für die Studio-Login-
                  Seite. Wirkt sobald dieses Branding als{" "}
                  <strong className="text-ink-secondary">Tenant-Default</strong>{" "}
                  gesetzt ist und der Tenant über seine Subdomain angesteuert
                  wird.
                </div>
              </div>

              <AssetField
                label="Hintergrundbild"
                imageUrl={branding.loginBackgroundUrl}
                accept="image/jpeg,image/png,image/webp"
                hint="JPEG/PNG/WebP, idealerweise 2400×1600px oder größer, max. 10 MB. Wird links vom Login-Formular als Hero-Bild gerendert."
                uploading={uploadingKind === "loginBackground"}
                inputRef={loginBgInputRef}
                onPick={() => loginBgInputRef.current?.click()}
                onFile={(f) => uploadAsset("loginBackground", f)}
                onRemove={() => removeAsset("loginBackground")}
                previewHeight="large"
              />

              <MarkdownField
                label="Begrüßungstext"
                value={loginGreeting}
                onChange={setLoginGreeting}
                rows={4}
                maxLength={2000}
                placeholder={
                  "z.B.\n# Willkommen, Team Müller\nLogge dich ein, um deine Galerien zu verwalten."
                }
                hint="Markdown möglich: # Überschrift, **fett**, leere Zeile für Absatz."
              />
            </div>

            <Field label="Custom CSS (für Power-User)">
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
            <div className="text-sm font-medium">Vorschau</div>
            <BrandingPreview
              primaryColor={primaryColor}
              accentColor={accentColor}
              fontFamily={fontFamily}
              logoUrl={branding.logoUrl}
              introText={introText}
              footerText={footerText}
            />
            <p className="text-xs text-ink-tertiary">
              Vorschau zeigt das Branding ungefähr so, wie Kunden es sehen.
              Bilder und Layout passen sich an die echte Galerie an.
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
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-12 h-9 rounded border border-line-subtle cursor-pointer"
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 rounded-md border border-line-subtle px-3 py-2 text-sm font-mono"
        pattern="^#[0-9a-fA-F]{6}$"
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
          >
            Noch nichts hochgeladen.
          </div>
        )}
        <div className="flex justify-between items-center gap-2">
          <button
            onClick={onPick}
            disabled={uploading}
            className="text-xs px-2 py-1 rounded border border-line-subtle hover:bg-surface-raised disabled:opacity-50"
          >
            {uploading ? "…" : imageUrl ? "Ersetzen" : "Hochladen"}
          </button>
          {imageUrl && (
            <button
              onClick={onRemove}
              className="text-xs text-red-600 hover:underline"
            >
              Entfernen
            </button>
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
          <div className="text-accent-contrast/40 text-xs italic">Logo</div>
        )}
      </div>

      {/* Body */}
      <div className="p-6 space-y-4 text-accent-contrast">
        <h2 className="text-xl">Demo-Galerie</h2>
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
        >
          Beispiel-Aktion
        </button>
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
