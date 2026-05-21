"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, type TenantSettings, type BillingUsage } from "@/lib/api";
import { TwoFactorSection } from "@/components/studio/TwoFactorSection";
import { PasskeysSection } from "@/components/studio/PasskeysSection";
import { ApiTokensSection } from "@/components/studio/ApiTokensSection";
import { MotionSection } from "@/components/studio/MotionSection";
import { PageHeader } from "@/components/studio/PageHeader";
import { useT, useLocale } from "@/lib/i18n";

export default function StudioSettingsPage() {
  const router = useRouter();
  const t = useT();
  const { locale, setLocale } = useLocale();
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [usage, setUsage] = useState<BillingUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [domain, setDomain] = useState("");
  const [textSaving, setTextSaving] = useState(false);
  const [domainSaving, setDomainSaving] = useState(false);
  const [imageSaving, setImageSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  async function load() {
    try {
      const res = await api.getTenantSettings();
      setSettings(res.tenant);
      setText(res.tenant.watermarkText ?? "");
      setDomain(res.tenant.customDomain ?? "");
      // Billing-Usage parallel — wenn Billing nicht aktiv ist
      // (Self-Hosted ohne BILLING_ENABLED) liefert das einen 404.
      // Wir setzen usage dann auf null und der Feature-Gate-Code
      // behandelt das als "alles erlaubt" (siehe planAllowsCustomDomain).
      try {
        const u = await api.getBillingUsage();
        setUsage(u);
      } catch {
        setUsage(null);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("401")) {
        router.replace("/login");
        return;
      }
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveText() {
    setTextSaving(true);
    setError(null);
    try {
      const res = await api.updateTenantSettings({
        watermarkText: text.trim() || null,
      });
      setSettings(res.tenant);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setTextSaving(false);
    }
  }

  async function saveDomain() {
    setDomainSaving(true);
    setError(null);
    try {
      const res = await api.updateTenantSettings({
        customDomain: domain.trim() || null,
      });
      setSettings(res.tenant);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Fehler";
      setError(
        msg.includes("domain_taken")
          ? "Diese Domain ist bereits in Benutzung."
          : msg
      );
    } finally {
      setDomainSaving(false);
    }
  }

  async function uploadImage(file: File) {
    setImageSaving(true);
    setError(null);
    try {
      const init = await api.initWatermarkImageUpload({
        contentType: file.type,
        sizeBytes: file.size,
      });
      // Direkt zu S3
      const put = await fetch(init.uploadUrl, {
        method: "PUT",
        headers: init.headers,
        body: file,
      });
      if (!put.ok) {
        throw new Error(`Upload fehlgeschlagen: HTTP ${put.status}`);
      }
      await api.completeWatermarkImageUpload(init.key);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setImageSaving(false);
    }
  }

  async function removeImage() {
    if (!confirm("Watermark-Bild wirklich entfernen?")) return;
    setImageSaving(true);
    try {
      await api.deleteWatermarkImage();
      await load();
    } finally {
      setImageSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-ui text-ink-tertiary">
        Lädt…
      </div>
    );
  }
  if (!settings) {
    return (
      <div className="px-6 sm:px-8 py-8">
        <div className="text-ui text-semantic-danger">
          {error ?? "Settings konnten nicht geladen werden."}
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "Studio", href: "/studio" },
          { label: t("settings.title") },
        ]}
        title={t("settings.title")}
        description={settings.name}
      />

      <div className="px-6 sm:px-8 py-6 space-y-6 max-w-4xl">

        {error && (
          <div className="text-ui-sm text-semantic-danger bg-semantic-danger/10 border border-semantic-danger/30 rounded-sm px-3 py-2">
            {error}
          </div>
        )}

        {/* Locale */}
        <section className="rounded-md border border-line-subtle bg-surface-raised p-5 flex items-center justify-between">
          <div>
            <h2 className="text-ui-md font-medium text-ink-primary">Language / Sprache</h2>
            <p className="text-xs text-ink-tertiary mt-0.5">
              Studio interface language.
            </p>
          </div>
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value as "en" | "de")}
            className="text-sm rounded-md border border-line-subtle px-2 py-1 bg-surface-raised"
          >
            <option value="en">English</option>
            <option value="de">Deutsch</option>
          </select>
        </section>

        {/* Motion / Animationen */}
        <MotionSection />

        {/* 2FA */}
        <TwoFactorSection />

        {/* Passkeys */}
        <PasskeysSection />

        {/* API-Tokens für Plugins / CLI */}
        <ApiTokensSection />

        {/* Branding-Link */}
        <section className="rounded-lg border border-line-subtle bg-surface-raised p-5 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium">{t("settings.branding")}</h2>
            <p className="text-xs text-ink-tertiary mt-0.5">
              {t("settings.brandingDesc")}
            </p>
          </div>
          <Link
            href="/studio/brandings"
            className="text-sm px-3 py-1.5 rounded-md border border-line-subtle hover:bg-surface-sunken"
          >
            {t("settings.manage")}
          </Link>
        </section>

        {/* Templates-Link */}
        <section className="rounded-lg border border-line-subtle bg-surface-raised p-5 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium">{t("settings.templates")}</h2>
            <p className="text-xs text-ink-tertiary mt-0.5">
              {t("settings.templatesDesc")}
            </p>
          </div>
          <Link
            href="/studio/templates"
            className="text-sm px-3 py-1.5 rounded-md border border-line-subtle hover:bg-surface-sunken"
          >
            {t("settings.manage")}
          </Link>
        </section>

        {/* Custom Domain — Feature-Gate: nur ab Studio-Plan. Wir lassen
            die Section sichtbar (damit der User weiß dass das Feature
            existiert), grayen sie aber komplett aus wenn der Plan das
            nicht erlaubt. usage===null heißt Billing ist nicht aktiv
            (Self-Hosted) → alles erlaubt. */}
        {(() => {
          const planAllows =
            usage === null ||
            usage.plan.customDomains === null ||
            usage.plan.customDomains > 0;
          return (
            <section
              className={`rounded-lg border bg-surface-raised p-5 space-y-3 ${
                planAllows ? "border-line-subtle" : "border-line-subtle opacity-60"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-medium">Custom Domain</h2>
                {!planAllows && (
                  <Link
                    href="/studio/billing"
                    className="text-ui-xs px-2 py-1 rounded bg-accent/15 text-accent hover:bg-accent/25"
                  >
                    Ab Studio-Plan
                  </Link>
                )}
              </div>
              <p className="text-xs text-ink-tertiary">
                Eigene Domain für deine Galerien — z.B.{" "}
                <code className="bg-surface-sunken px-1 rounded">bilder.mein-studio.de</code>.
                Richte einen CNAME oder A-Record auf die Lumio-Instanz, dann
                trage die Domain hier ein. Galerien sind unter
                <code className="bg-surface-sunken px-1 mx-1 rounded">
                  https://deine-domain/g/&lt;slug&gt;
                </code>
                erreichbar.
              </p>
              <div className="flex gap-2">
                <input
                  value={domain}
                  onChange={(e) => setDomain(e.target.value.toLowerCase())}
                  placeholder="z.B. bilder.mein-studio.de"
                  disabled={!planAllows}
                  className="flex-1 rounded-md border border-line-subtle px-3 py-2 text-sm font-mono disabled:cursor-not-allowed disabled:bg-surface-sunken"
                />
                <button
                  onClick={saveDomain}
                  disabled={domainSaving || !planAllows}
                  className="text-sm px-3 py-2 rounded-md bg-accent text-accent-contrast hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {domainSaving ? "Speichert…" : "Speichern"}
                </button>
              </div>
              {settings.customDomain && (
                <div className="text-xs text-ink-tertiary bg-semantic-warning/10 border border-semantic-warning/30 rounded p-2">
                  <strong>Hinweis:</strong> DNS-Änderungen können bis zu 48h
                  dauern, bis sie überall propagiert sind. Stelle sicher, dass
                  ein TLS-Zertifikat für diese Domain bereitsteht (Caddy
                  regelt das automatisch, wenn die Domain auf den Server
                  zeigt).
                </div>
              )}
            </section>
          );
        })()}

        {/* Watermark-Text */}
        <section className="rounded-lg border border-line-subtle bg-surface-raised p-5 space-y-3">
          <h2 className="text-sm font-medium">Wasserzeichen — Text</h2>
          <p className="text-xs text-ink-tertiary">
            Wird als wiederholtes diagonales Muster über Vorschaubilder gelegt,
            wenn eine Galerie auf <em>watermarkEnabled</em> steht und kein
            Bild-Wasserzeichen hochgeladen ist. Leer = Studio-Name wird
            verwendet.
          </p>
          <div className="flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={settings.name}
              maxLength={200}
              className="flex-1 rounded-md border border-line-subtle px-3 py-2 text-sm"
            />
            <button
              onClick={saveText}
              disabled={textSaving}
              className="text-sm px-3 py-2 rounded-md bg-accent text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
            >
              {textSaving ? "Speichert…" : "Speichern"}
            </button>
          </div>
        </section>

        {/* Watermark-Bild */}
        <section className="rounded-lg border border-line-subtle bg-surface-raised p-5 space-y-3">
          <h2 className="text-sm font-medium">Wasserzeichen — Bild</h2>
          <p className="text-xs text-ink-tertiary">
            PNG oder JPEG, transparenter Hintergrund empfohlen. Wird mit 35 %
            Opazität mittig über die Vorschau gelegt — bei aktiviertem
            Wasserzeichen statt des Text-Musters.
          </p>

          {settings.watermarkImageKey ? (
            <div className="flex items-center justify-between bg-surface-sunken border border-line-subtle rounded px-3 py-2">
              <div className="text-xs font-mono truncate">
                {settings.watermarkImageKey.split("/").pop()}
              </div>
              <button
                onClick={removeImage}
                disabled={imageSaving}
                className="text-xs text-red-600 hover:underline disabled:opacity-50"
              >
                Entfernen
              </button>
            </div>
          ) : (
            <div className="text-xs text-ink-tertiary">
              Kein Wasserzeichen-Bild hochgeladen.
            </div>
          )}

          <div>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadImage(f);
                if (e.target) e.target.value = "";
              }}
            />
            <button
              onClick={() => fileInput.current?.click()}
              disabled={imageSaving}
              className="text-sm px-3 py-2 rounded-md border border-line-subtle hover:bg-surface-sunken disabled:opacity-50"
            >
              {imageSaving
                ? "Lädt hoch…"
                : settings.watermarkImageKey
                ? "Bild ersetzen"
                : "Bild hochladen"}
            </button>
            <span className="text-xs text-ink-tertiary ml-2">
              Max. 20 MiB · PNG/JPEG
            </span>
          </div>

          <div className="text-xs text-ink-tertiary bg-semantic-warning/10 border border-semantic-warning/30 rounded p-2">
            <strong>Hinweis:</strong> Eine Änderung wirkt erst, wenn das
            Wasserzeichen einer Galerie neu generiert wird. Schalte
            <em> watermarkEnabled</em> aus und wieder an, oder warte auf den
            nächsten Upload.
          </div>
        </section>
      </div>
    </>
  );
}
