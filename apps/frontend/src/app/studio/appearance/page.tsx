"use client";

import { useEffect, useRef, useState } from "react";
import {
  api,
  type Appearance,
  type AppearanceAssetKind,
} from "@/lib/api";
import { PageHeader } from "@/components/studio/PageHeader";
import { Button } from "@/components/ui";
import { ColorField, AssetField } from "@/components/studio/AppearanceFields";
import {
  applyStudioAccent,
  applyStudioTheme,
} from "@/lib/studio-appearance";

const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml";
const hexRe = /^#[0-9a-fA-F]{6}$/;

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line-subtle bg-surface-raised p-5 space-y-4">
      <div>
        <h2 className="text-ui-md font-semibold text-ink-primary">{title}</h2>
        {description && (
          <p className="text-sm text-ink-tertiary mt-0.5">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-ink-secondary">{label}</label>
      {children}
      {hint && <p className="text-xs text-ink-tertiary">{hint}</p>}
    </div>
  );
}

export default function AppearancePage() {
  const [appearance, setAppearance] = useState<Appearance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingKind, setUploadingKind] =
    useState<AppearanceAssetKind | null>(null);

  // Editierbare (nicht-Asset) Felder
  const [studioTheme, setStudioTheme] = useState<"dark" | "light">("dark");
  const [studioAccent, setStudioAccent] = useState("");
  const [loginAccent, setLoginAccent] = useState("");
  const [loginGreeting, setLoginGreeting] = useState("");

  const studioLogoRef = useRef<HTMLInputElement | null>(null);
  const studioLogoLightRef = useRef<HTMLInputElement | null>(null);
  const loginLogoRef = useRef<HTMLInputElement | null>(null);
  const loginBgRef = useRef<HTMLInputElement | null>(null);
  const emailLogoRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { appearance } = await api.getAppearance();
        setAppearance(appearance);
        setStudioTheme(appearance.studioTheme);
        setStudioAccent(appearance.studioAccentColor ?? "");
        setLoginAccent(appearance.loginAccentColor ?? "");
        setLoginGreeting(appearance.loginGreeting ?? "");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Konnte nicht laden");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Beim Verlassen der Seite die zuletzt GESPEICHERTEN Werte
  // wiederherstellen — falls der Nutzer eine Live-Vorschau gestartet,
  // aber nicht gespeichert hat.
  useEffect(() => {
    return () => {
      if (appearance) {
        applyStudioAccent(appearance.studioAccentColor);
        applyStudioTheme(appearance.studioTheme);
      }
    };
  }, [appearance]);

  async function uploadAsset(kind: AppearanceAssetKind, file: File) {
    setUploadingKind(kind);
    setError(null);
    try {
      const init = await api.initAppearanceAssetUpload({
        kind,
        contentType: file.type,
        sizeBytes: file.size,
      });
      const put = await fetch(init.uploadUrl, {
        method: "PUT",
        headers: init.headers,
        body: file,
      });
      if (!put.ok) throw new Error(`Upload fehlgeschlagen: HTTP ${put.status}`);
      const { appearance } = await api.completeAppearanceAssetUpload({
        kind,
        key: init.key,
      });
      setAppearance(appearance);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload fehlgeschlagen");
    } finally {
      setUploadingKind(null);
    }
  }

  async function removeAsset(kind: AppearanceAssetKind) {
    setUploadingKind(kind);
    setError(null);
    try {
      const { appearance } = await api.deleteAppearanceAsset(kind);
      setAppearance(appearance);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Konnte nicht entfernen");
    } finally {
      setUploadingKind(null);
    }
  }

  async function save() {
    // Farb-Validierung (leer = Standard, sonst muss es #rrggbb sein)
    if (studioAccent.trim() && !hexRe.test(studioAccent.trim())) {
      setError("Studio-Akzentfarbe muss ein Hex-Wert sein, z.B. #3a87fe");
      return;
    }
    if (loginAccent.trim() && !hexRe.test(loginAccent.trim())) {
      setError("Login-Akzentfarbe muss ein Hex-Wert sein, z.B. #3a87fe");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { appearance } = await api.updateAppearance({
        studioTheme,
        studioAccentColor: studioAccent.trim() || null,
        loginAccentColor: loginAccent.trim() || null,
        loginGreeting: loginGreeting.trim() || null,
      });
      setAppearance(appearance);
      applyStudioAccent(appearance.studioAccentColor);
      applyStudioTheme(appearance.studioTheme);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "Studio", href: "/studio" },
          { label: "Gestaltung", href: "/studio/brandings" },
          { label: "Studio & Login" },
        ]}
        title="Studio & Login"
        description="Eigenes Erscheinungsbild für dein Studio-Backend, die Login-Seite und E-Mails — unabhängig vom Galerie-Branding."
        actions={
          <Button variant="primary" onClick={save} disabled={saving || loading}>
            {saving ? "Speichern…" : "Speichern"}
          </Button>
        }
      />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {error && (
          <div className="rounded-md border border-semantic-danger/40 bg-semantic-danger/10 px-4 py-3 text-sm text-semantic-danger">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-sm text-ink-tertiary">Lädt…</div>
        ) : !appearance ? null : (
          <>
            {/* ============ STUDIO-BACKEND ============ */}
            <Section
              title="Studio-Backend"
              description="So sieht deine Arbeitsumgebung aus, wenn du eingeloggt bist."
            >
              <Field
                label="Grundton"
                hint="Hell oder dunkel — wirkt sofort als Vorschau, gespeichert wird mit „Speichern“."
              >
                <div className="inline-flex rounded-md border border-line-subtle overflow-hidden">
                  {(["dark", "light"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setStudioTheme(t);
                        applyStudioTheme(t);
                      }}
                      className={`px-4 py-1.5 text-sm transition-colors ${
                        studioTheme === t
                          ? "bg-accent text-accent-contrast"
                          : "text-ink-secondary hover:bg-surface-sunken"
                      }`}
                    >
                      {t === "dark" ? "Dunkel" : "Hell"}
                    </button>
                  ))}
                </div>
              </Field>

              <Field
                label="Akzentfarbe"
                hint="Färbt Buttons, Links und aktive Elemente im Studio. Leer = Standard (Amber)."
              >
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <ColorField
                      value={studioAccent}
                      onChange={(v) => {
                        setStudioAccent(v);
                        if (!v.trim() || hexRe.test(v.trim()))
                          applyStudioAccent(v.trim() || null);
                      }}
                    />
                  </div>
                  {studioAccent && (
                    <button
                      type="button"
                      className="text-xs text-ink-tertiary hover:text-ink-secondary"
                      onClick={() => {
                        setStudioAccent("");
                        applyStudioAccent(null);
                      }}
                    >
                      Zurücksetzen
                    </button>
                  )}
                </div>
              </Field>

              <div className="grid sm:grid-cols-2 gap-4">
                <AssetField
                  label="Logo (dunkler Modus)"
                  imageUrl={appearance.studioLogoUrl}
                  accept={IMAGE_ACCEPT}
                  hint="Erscheint oben in der Seitenleiste. Helle/weiße Variante empfohlen."
                  uploading={uploadingKind === "studioLogo"}
                  inputRef={studioLogoRef}
                  onPick={() => studioLogoRef.current?.click()}
                  onFile={(f) => uploadAsset("studioLogo", f)}
                  onRemove={() => removeAsset("studioLogo")}
                  darkPreview
                />
                <AssetField
                  label="Logo (heller Modus)"
                  imageUrl={appearance.studioLogoLightUrl}
                  accept={IMAGE_ACCEPT}
                  hint="Optional. Dunkle Variante für den hellen Grundton. Leer = das normale Logo."
                  uploading={uploadingKind === "studioLogoLight"}
                  inputRef={studioLogoLightRef}
                  onPick={() => studioLogoLightRef.current?.click()}
                  onFile={(f) => uploadAsset("studioLogoLight", f)}
                  onRemove={() => removeAsset("studioLogoLight")}
                />
              </div>
            </Section>

            {/* ============ LOGIN-SEITE ============ */}
            <Section
              title="Login-Seite"
              description="Die Seite, auf der du (und dein Team) euch anmeldet."
            >
              <div className="grid sm:grid-cols-2 gap-4">
                <AssetField
                  label="Logo"
                  imageUrl={appearance.loginLogoUrl}
                  accept={IMAGE_ACCEPT}
                  hint="Erscheint über dem Login-Formular."
                  uploading={uploadingKind === "loginLogo"}
                  inputRef={loginLogoRef}
                  onPick={() => loginLogoRef.current?.click()}
                  onFile={(f) => uploadAsset("loginLogo", f)}
                  onRemove={() => removeAsset("loginLogo")}
                  darkPreview
                />
                <Field
                  label="Akzentfarbe"
                  hint="Login-Button und Links. Leer = Standard."
                >
                  <ColorField
                    value={loginAccent}
                    onChange={setLoginAccent}
                  />
                </Field>
              </div>

              <AssetField
                label="Hintergrundbild"
                imageUrl={appearance.loginBackgroundUrl}
                accept={IMAGE_ACCEPT}
                hint="Großflächiges Bild hinter dem Login. PNG/JPEG/WEBP, max. 10 MB."
                uploading={uploadingKind === "loginBackground"}
                inputRef={loginBgRef}
                onPick={() => loginBgRef.current?.click()}
                onFile={(f) => uploadAsset("loginBackground", f)}
                onRemove={() => removeAsset("loginBackground")}
                previewHeight="large"
              />

              <Field
                label="Begrüßungstext"
                hint="Kurzer Text über dem Login. Markdown möglich (# Überschrift, **fett**)."
              >
                <textarea
                  value={loginGreeting}
                  onChange={(e) => setLoginGreeting(e.target.value)}
                  rows={3}
                  placeholder="z.B. Willkommen zurück bei Thiel Media"
                  className="w-full rounded-md border border-line-subtle px-3 py-2 text-sm resize-y"
                />
              </Field>
            </Section>

            {/* ============ E-MAILS ============ */}
            <Section
              title="E-Mails"
              description="Logo in den E-Mails, die Lumio in deinem Namen verschickt (Galerie-Einladungen, Benachrichtigungen)."
            >
              <AssetField
                label="E-Mail-Logo"
                imageUrl={appearance.emailLogoUrl}
                accept={IMAGE_ACCEPT}
                hint="Erscheint im Kopf der E-Mails. Dunkle Variante empfohlen (heller Mail-Hintergrund)."
                uploading={uploadingKind === "emailLogo"}
                inputRef={emailLogoRef}
                onPick={() => emailLogoRef.current?.click()}
                onFile={(f) => uploadAsset("emailLogo", f)}
                onRemove={() => removeAsset("emailLogo")}
              />
            </Section>

            <div className="flex justify-end">
              <Button
                variant="primary"
                onClick={save}
                disabled={saving || loading}
              >
                {saving ? "Speichern…" : "Speichern"}
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
