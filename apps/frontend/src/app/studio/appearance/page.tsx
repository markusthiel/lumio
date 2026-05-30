"use client";

import { useEffect, useRef, useState } from "react";
import {
  api,
  type Appearance,
  type AppearanceAssetKind,
} from "@/lib/api";
import { PageHeader } from "@/components/studio/PageHeader";
import { Button } from "@/components/ui";
import {
  ColorField,
  OverlayField,
  AssetField,
} from "@/components/studio/AppearanceFields";
import { BlurLevelPicker } from "@/components/studio/BlurLevelPicker";
import {
  applyStudioAccent,
  applyStudioTheme,
} from "@/lib/studio-appearance";

// Logos: gängige Web-Bildformate inkl. Vektor (SVG). Der Worker
// konvertiert Bitmaps zu WebP, SVG bleibt unverändert.
const LOGO_ACCEPT =
  "image/png,image/jpeg,image/webp,image/svg+xml,image/gif,image/avif,image/heic,image/heif,image/jp2,.jfif,.jp2,.j2k";
// Login-Hintergrund: zusätzlich TIFF/BMP und Kamera-RAW. RAW wird
// serverseitig demosaict und zu WebP eingedampft.
const PHOTO_ACCEPT =
  LOGO_ACCEPT +
  ",image/tiff,.tif,.tiff,.bmp,.jpf,.jpx,.cr2,.cr3,.nef,.nrw,.arw,.sr2,.srf,.dng,.raf,.orf,.rw2,.pef,.srw,.raw,.3fr,.erf,.kdc,.mos,.mrw,.x3f";
const hexRe = /^#[0-9a-fA-F]{6}$/;

// Aktuelle (signierte) URL eines Asset-Typs aus der Appearance ziehen.
function assetUrlForKind(
  a: Appearance,
  kind: AppearanceAssetKind
): string | null {
  switch (kind) {
    case "studioLogo":
      return a.studioLogoUrl;
    case "studioLogoLight":
      return a.studioLogoLightUrl;
    case "loginLogo":
      return a.loginLogoUrl;
    case "loginBackground":
      return a.loginBackgroundUrl;
    case "emailLogo":
      return a.emailLogoUrl;
  }
}

// Bereits direkt anzeigbar? WebP (nach Worker-Konvertierung) oder ein
// unverändertes SVG. Andernfalls läuft die Optimierung noch.
function isOptimized(url: string | null): boolean {
  return !url || /\.(webp|svg)(\?|$)/i.test(url);
}

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
      <label className="text-sm font-medium text-ink-secondary block">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-ink-tertiary">{hint}</p>}
    </div>
  );
}

type LoginLayout = "minimal" | "splash" | "side_by_side" | "centered";

/** Radio-Card-Picker für die Login-Layout-Variante — Mini-Diagramme,
 *  damit man die Anordnung vor dem Klick sieht (analog zur Galerie). */
function LoginLayoutPicker({
  value,
  onChange,
}: {
  value: LoginLayout;
  onChange: (v: LoginLayout) => void;
}) {
  const Box = ({ overlay = false }: { overlay?: boolean }) => (
    <div
      className={`rounded-sm p-1 flex flex-col gap-0.5 ${
        overlay ? "bg-surface-overlay/85" : "bg-ink-primary/15"
      }`}
    >
      <div className="h-0.5 w-full rounded-sm bg-ink-primary/40" />
      <div className="h-0.5 w-full rounded-sm bg-ink-primary/40" />
      <div className="h-1 w-1/2 rounded-sm bg-accent/80 mt-0.5" />
    </div>
  );
  const options: { id: LoginLayout; label: string; sketch: React.ReactNode }[] =
    [
      {
        id: "minimal",
        label: "Minimal",
        sketch: (
          <div className="w-full h-full flex items-center justify-center p-2">
            <div className="w-3/5">
              <Box />
            </div>
          </div>
        ),
      },
      {
        id: "splash",
        label: "Splash",
        sketch: (
          <div className="w-full h-full flex items-center justify-center p-1.5 bg-ink-primary/30">
            <div className="w-3/5">
              <Box overlay />
            </div>
          </div>
        ),
      },
      {
        id: "side_by_side",
        label: "Side-by-Side",
        sketch: (
          <div className="w-full h-full grid grid-cols-2">
            <div className="flex items-center justify-center p-1.5">
              <div className="w-full">
                <Box />
              </div>
            </div>
            <div className="bg-ink-primary/30" />
          </div>
        ),
      },
      {
        id: "centered",
        label: "Zentriert",
        sketch: (
          <div className="w-full h-full bg-ink-primary/10 p-2 flex flex-col items-center gap-1">
            <div className="h-0.5 w-1/3 rounded-sm bg-ink-primary/50" />
            <div className="w-3/5 mt-0.5">
              <Box overlay />
            </div>
          </div>
        ),
      },
    ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`rounded border p-2 text-left transition-colors ${
              active
                ? "border-accent bg-accent/10"
                : "border-line-subtle bg-surface-sunken hover:border-line-strong"
            }`}
          >
            <div className="aspect-[4/3] w-full rounded-sm bg-surface-overlay/40 overflow-hidden">
              {opt.sketch}
            </div>
            <div className="mt-2 text-xs font-medium text-ink-primary">
              {opt.label}
            </div>
          </button>
        );
      })}
    </div>
  );
}

type MailLogoPosition = "left" | "right" | "center" | "footer";
type MailHeaderStyle = "line" | "banner";

/** Mail-Layout: zwei Regler (Logo-Position + Kopf-Stil) mit einer
 *  kombinierten Live-Vorschau in der echten Akzentfarbe. Die Mini-Mail
 *  ist immer weiß (echte Mails haben hellen Hintergrund), daher feste
 *  Grautöne statt Theme-Tokens. */
function MailLayoutControls({
  logoPosition,
  onLogoPosition,
  headerStyle,
  onHeaderStyle,
  accent,
}: {
  logoPosition: MailLogoPosition;
  onLogoPosition: (v: MailLogoPosition) => void;
  headerStyle: MailHeaderStyle;
  onHeaderStyle: (v: MailHeaderStyle) => void;
  accent: string;
}) {
  const ac = accent || "#d97706";
  const LOGO_GRAY = "#4b5563";
  const TEXT_GRAY = "#d1d5db";
  const inFooter = logoPosition === "footer";
  const isBanner = headerStyle === "banner";
  const justify =
    logoPosition === "right"
      ? "flex-end"
      : logoPosition === "center"
        ? "center"
        : "flex-start";

  const LogoBar = ({ light }: { light?: boolean }) => (
    <div
      className="h-2.5 w-2/5 rounded-sm"
      style={{ backgroundColor: light ? "rgba(255,255,255,0.92)" : LOGO_GRAY }}
    />
  );

  // Kopfzeile der Vorschau
  let header: React.ReactNode;
  if (!inFooter) {
    header = isBanner ? (
      <div className="px-3 py-2.5 flex" style={{ backgroundColor: ac, justifyContent: justify }}>
        <LogoBar light />
      </div>
    ) : (
      <div className="px-3 py-2.5 flex" style={{ borderBottom: `2px solid ${ac}`, justifyContent: justify }}>
        <LogoBar />
      </div>
    );
  } else {
    header = isBanner ? (
      <div style={{ backgroundColor: ac, height: 10 }} />
    ) : (
      <div style={{ borderTop: `3px solid ${ac}` }} />
    );
  }

  const Pill = ({
    active,
    onClick,
    children,
  }: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
        active
          ? "border-accent bg-accent/10 text-ink-primary"
          : "border-line-subtle bg-surface-sunken text-ink-secondary hover:border-line-strong"
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Live-Vorschau */}
      <div className="max-w-[280px]">
        <div className="rounded-md overflow-hidden bg-white border border-line-subtle shadow-sm">
          {header}
          <div className="px-3 py-3 flex flex-col gap-1.5">
            <div className="h-1 w-full rounded-sm" style={{ backgroundColor: TEXT_GRAY }} />
            <div className="h-1 w-4/5 rounded-sm" style={{ backgroundColor: TEXT_GRAY }} />
            <div className="h-2 w-1/3 rounded-sm mt-1" style={{ backgroundColor: ac }} />
          </div>
          <div
            className="px-3 py-2.5 flex flex-col items-center gap-1"
            style={{ backgroundColor: "#fafafa", borderTop: "1px solid #e5e7eb" }}
          >
            {inFooter && <LogoBar />}
            <div className="h-0.5 w-1/2 rounded-sm" style={{ backgroundColor: "#e5e7eb" }} />
          </div>
        </div>
      </div>

      {/* Regler 1: Logo-Position */}
      <div>
        <div className="text-xs font-medium text-ink-secondary mb-1.5">Logo-Position</div>
        <div className="flex flex-wrap gap-1.5">
          <Pill active={logoPosition === "left"} onClick={() => onLogoPosition("left")}>
            Links
          </Pill>
          <Pill active={logoPosition === "right"} onClick={() => onLogoPosition("right")}>
            Rechts
          </Pill>
          <Pill active={logoPosition === "center"} onClick={() => onLogoPosition("center")}>
            Mittig
          </Pill>
          <Pill active={logoPosition === "footer"} onClick={() => onLogoPosition("footer")}>
            Footer
          </Pill>
        </div>
      </div>

      {/* Regler 2: Kopf-Stil */}
      <div>
        <div className="text-xs font-medium text-ink-secondary mb-1.5">Kopf-Stil</div>
        <div className="flex flex-wrap gap-1.5">
          <Pill active={headerStyle === "line"} onClick={() => onHeaderStyle("line")}>
            Schlichte Linie
          </Pill>
          <Pill active={headerStyle === "banner"} onClick={() => onHeaderStyle("banner")}>
            Akzent-Banner
          </Pill>
        </div>
      </div>
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
  const [loginLayout, setLoginLayout] = useState<LoginLayout>("centered");
  const [mailLogoPosition, setMailLogoPosition] =
    useState<MailLogoPosition>("left");
  const [mailHeaderStyle, setMailHeaderStyle] =
    useState<MailHeaderStyle>("line");
  const [loginOverlay, setLoginOverlay] = useState<string | null>(null);
  const [loginOverlayBlur, setLoginOverlayBlur] = useState(0);

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
        setLoginLayout(appearance.loginLayout);
        setMailLogoPosition(appearance.mailLogoPosition);
        setMailHeaderStyle(appearance.mailHeaderStyle);
        setLoginOverlay(appearance.loginOverlayColor);
        setLoginOverlayBlur(appearance.loginOverlayBlur ?? 0);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Konnte nicht laden");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Letzten gespeicherten Stand in einer Ref festhalten, damit der
  // Unmount-Cleanup immer den aktuellsten Wert sieht — ohne bei jeder
  // Änderung neu zu feuern.
  const savedRef = useRef<Appearance | null>(null);
  savedRef.current = appearance;

  // NUR beim Verlassen der Seite die zuletzt gespeicherten Werte
  // wiederherstellen — falls eine Live-Vorschau lief, die nicht
  // gespeichert wurde. Leeres Dependency-Array ist hier entscheidend:
  // mit [appearance] würde der Cleanup beim Speichern feuern und den
  // frisch angewandten Stand mit dem alten überschreiben (das Studio
  // sprang dann optisch zurück, bis man neu lud).
  useEffect(() => {
    return () => {
      const a = savedRef.current;
      if (a) {
        applyStudioAccent(a.studioAccentColor);
        applyStudioTheme(a.studioTheme);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function uploadAsset(kind: AppearanceAssetKind, file: File) {
    setUploadingKind(kind);
    setError(null);
    try {
      const init = await api.initAppearanceAssetUpload({
        kind,
        contentType: file.type,
        sizeBytes: file.size,
        filename: file.name,
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

      // Der Worker konvertiert das Original asynchron zu WebP. Bei
      // Formaten, die der Browser nicht direkt anzeigt (JP2/RAW/TIFF/
      // HEIC), würde sonst kurz ein "Bild fehlt"-Platzhalter erscheinen.
      // Wir warten daher auf die optimierte Variante und lassen so lange
      // den Lade-Zustand stehen (uploadingKind wird erst im finally
      // zurückgesetzt).
      if (!isOptimized(assetUrlForKind(appearance, kind))) {
        let current = appearance;
        for (let i = 0; i < 8; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          try {
            const fresh = (await api.getAppearance()).appearance;
            current = fresh;
            if (isOptimized(assetUrlForKind(fresh, kind))) break;
          } catch {
            // transienter Fehler — weiter versuchen
          }
        }
        setAppearance(current);
      }
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
        loginLayout,
        loginOverlayColor: loginOverlay,
        loginOverlayBlur: loginOverlayBlur || null,
        mailLogoPosition,
        mailHeaderStyle,
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

      <div className="px-6 sm:px-8 lg:px-12 py-6 space-y-6 max-w-5xl">
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
                  accept={LOGO_ACCEPT}
                  hint="Erscheint oben in der Seitenleiste. Helle/weiße Variante empfohlen."
                  uploading={uploadingKind === "studioLogo"}
                  inputRef={studioLogoRef}
                  onPick={() => studioLogoRef.current?.click()}
                  onFile={(f) => uploadAsset("studioLogo", f)}
                  onRemove={() => removeAsset("studioLogo")}
                  previewTone="dark"
                />
                <AssetField
                  label="Logo (heller Modus)"
                  imageUrl={appearance.studioLogoLightUrl}
                  accept={LOGO_ACCEPT}
                  hint="Optional. Dunkle Variante für den hellen Grundton. Leer = das normale Logo."
                  uploading={uploadingKind === "studioLogoLight"}
                  inputRef={studioLogoLightRef}
                  onPick={() => studioLogoLightRef.current?.click()}
                  onFile={(f) => uploadAsset("studioLogoLight", f)}
                  onRemove={() => removeAsset("studioLogoLight")}
                  previewTone="light"
                />
              </div>
            </Section>

            {/* ============ LOGIN-SEITE ============ */}
            <Section
              title="Login-Seite"
              description="Die Seite, auf der du (und dein Team) euch anmeldet."
            >
              <Field
                label="Layout"
                hint="Wie die Anmeldeseite aufgebaut ist. Logo, Bild und Begrüßung bleiben gleich — nur die Anordnung ändert sich."
              >
                <LoginLayoutPicker value={loginLayout} onChange={setLoginLayout} />
              </Field>

              <div className="grid sm:grid-cols-2 gap-4">
                <AssetField
                  label="Logo"
                  imageUrl={appearance.loginLogoUrl}
                  accept={LOGO_ACCEPT}
                  hint="Erscheint über dem Login-Formular."
                  uploading={uploadingKind === "loginLogo"}
                  inputRef={loginLogoRef}
                  onPick={() => loginLogoRef.current?.click()}
                  onFile={(f) => uploadAsset("loginLogo", f)}
                  onRemove={() => removeAsset("loginLogo")}
                  previewTone="dark"
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
                accept={PHOTO_ACCEPT}
                hint="Großflächiges Bild hinter dem Login. PNG/JPEG/WEBP, max. 10 MB."
                uploading={uploadingKind === "loginBackground"}
                inputRef={loginBgRef}
                onPick={() => loginBgRef.current?.click()}
                onFile={(f) => uploadAsset("loginBackground", f)}
                onRemove={() => removeAsset("loginBackground")}
                previewHeight="large"
              />

              {appearance.loginBackgroundUrl && (
                <>
                  <Field
                    label="Vorschau"
                    hint="So wirken Farbüberlagerung und Glas-Effekt über dem Hintergrundbild."
                  >
                    <div className="relative w-full aspect-[16/9] rounded-md overflow-hidden bg-surface-sunken">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={appearance.loginBackgroundUrl}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                      {(loginOverlay || loginOverlayBlur > 0) && (
                        <div
                          className="absolute inset-0 pointer-events-none"
                          style={{
                            backgroundColor: loginOverlay ?? undefined,
                            backdropFilter: loginOverlayBlur
                              ? `blur(${loginOverlayBlur}px)`
                              : undefined,
                            WebkitBackdropFilter: loginOverlayBlur
                              ? `blur(${loginOverlayBlur}px)`
                              : undefined,
                          }}
                        />
                      )}
                    </div>
                  </Field>
                  <Field
                    label="Farbüberlagerung"
                    hint="Farbfläche über dem Hintergrundbild — hebt das Login-Formular hervor und verbessert die Lesbarkeit. Farbe und Transparenz frei wählbar."
                  >
                    <OverlayField
                      value={loginOverlay}
                      onChange={setLoginOverlay}
                    />
                  </Field>
                  <Field
                    label="Weichzeichnen (Glas-Effekt)"
                    hint="Zeichnet das Hintergrundbild hinter der Farbfläche weich — wie der Glas-Effekt bei Menüs und Dialogen."
                  >
                    <BlurLevelPicker
                      value={loginOverlayBlur}
                      onChange={setLoginOverlayBlur}
                    />
                  </Field>
                </>
              )}

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
                accept={LOGO_ACCEPT}
                hint={
                  mailHeaderStyle === "banner" &&
                  mailLogoPosition !== "footer"
                    ? "Liegt auf dem farbigen Banner — helle/weiße Variante empfohlen."
                    : "Erscheint im Kopf bzw. Footer der E-Mails. Dunkle Variante empfohlen (heller Hintergrund)."
                }
                uploading={uploadingKind === "emailLogo"}
                inputRef={emailLogoRef}
                onPick={() => emailLogoRef.current?.click()}
                onFile={(f) => uploadAsset("emailLogo", f)}
                onRemove={() => removeAsset("emailLogo")}
                previewTone="light"
                previewBgColor={
                  mailHeaderStyle === "banner" &&
                  mailLogoPosition !== "footer"
                    ? studioAccent || loginAccent
                    : null
                }
              />
              <Field
                label="Layout"
                hint="Aufbau der E-Mails an deine Kunden. Deine Akzentfarbe wird für Linie/Banner, Buttons und Zitate übernommen. Kein Dark-Mode — die Mail-Programme dunkeln selbst ab."
              >
                <MailLayoutControls
                  logoPosition={mailLogoPosition}
                  onLogoPosition={setMailLogoPosition}
                  headerStyle={mailHeaderStyle}
                  onHeaderStyle={setMailHeaderStyle}
                  accent={studioAccent || loginAccent}
                />
              </Field>
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
