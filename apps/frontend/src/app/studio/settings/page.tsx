"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, type TenantSettings, type BillingUsage, type UploadLimits } from "@/lib/api";
import { TwoFactorSection } from "@/components/studio/TwoFactorSection";
import { PasskeysSection } from "@/components/studio/PasskeysSection";
import { ApiTokensSection } from "@/components/studio/ApiTokensSection";
import { MotionSection } from "@/components/studio/MotionSection";
import { NotificationSettings } from "@/components/studio/NotificationSettings";
import { PageHeader } from "@/components/studio/PageHeader";
import { useT, useLocale } from "@/lib/i18n";

/** Kleine Status-Zeile mit farbigem Punkt + Label + Detail-Text.
 *  Für Custom-Domain DNS- und TLS-Status. */
function StatusRow({
  label,
  state,
  message,
}: {
  label: string;
  state: "ok" | "pending" | "warn";
  message: string;
}) {
  const colors = {
    ok: { dot: "bg-emerald-500", label: "text-emerald-700" },
    pending: { dot: "bg-amber-500 animate-pulse", label: "text-amber-700" },
    warn: { dot: "bg-red-500", label: "text-red-700" },
  }[state];
  const icon = state === "ok" ? "✓" : state === "pending" ? "⏳" : "⚠";
  return (
    <div className="flex items-start gap-2.5 text-xs">
      <span
        className={`shrink-0 w-2 h-2 rounded-full mt-1.5 ${colors.dot}`}
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <div className={`font-medium ${colors.label}`}>
          {icon} {label}
        </div>
        <div className="text-ink-secondary mt-0.5 leading-relaxed">
          {message}
        </div>
      </div>
    </div>
  );
}

export default function StudioSettingsPage() {
  const router = useRouter();
  const t = useT();
  const { locale, setLocale } = useLocale();
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [uploadLimits, setUploadLimits] = useState<UploadLimits | null>(null);
  const [deployment, setDeployment] = useState<{
    mode: "single" | "multi";
    domainBase: string | null;
    publicIp: string | null;
  } | null>(null);
  const [customDomainStatus, setCustomDomainStatus] = useState<
    Awaited<ReturnType<typeof api.getCustomDomainStatus>> | null
  >(null);
  const [usage, setUsage] = useState<BillingUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugSaving, setSlugSaving] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [domain, setDomain] = useState("");
  // Per-File Upload-Limit in MiB. Leer = ENV-Default verwenden.
  const [maxUpload, setMaxUpload] = useState("");
  const [displayNameSaving, setDisplayNameSaving] = useState(false);
  const [displayNameSaved, setDisplayNameSaved] = useState(false);
  const [textSaving, setTextSaving] = useState(false);
  const [domainSaving, setDomainSaving] = useState(false);
  const [domainChecking, setDomainChecking] = useState(false);
  const [imageSaving, setImageSaving] = useState(false);
  const [maxUploadSaving, setMaxUploadSaving] = useState(false);
  const [zipPartLimits, setZipPartLimits] = useState<UploadLimits | null>(
    null
  );
  const [zipPart, setZipPart] = useState("");
  const [zipPartSaving, setZipPartSaving] = useState(false);
  const [kinds, setKinds] = useState<string[]>([]);
  const [kindsDefault, setKindsDefault] = useState<string[]>([]);
  const [allKinds, setAllKinds] = useState<string[]>([]);
  const [kindsSaving, setKindsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  async function load() {
    try {
      const res = await api.getTenantSettings();
      setSettings(res.tenant);
      setUploadLimits(res.uploadLimits);
      setZipPartLimits(res.zipPartLimits);
      setZipPart(
        res.tenant.zipPartMaxMib !== null
          ? String(res.tenant.zipPartMaxMib)
          : ""
      );
      setKindsDefault(res.allowedKinds.default);
      setAllKinds(res.allowedKinds.all);
      setKinds(
        res.tenant.uploadAllowedKinds
          ? res.tenant.uploadAllowedKinds
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : res.allowedKinds.default
      );
      setDeployment(res.deployment);
      setDisplayName(res.tenant.displayName ?? "");
      setSlug(res.tenant.slug);
      setText(res.tenant.watermarkText ?? "");
      setDomain(res.tenant.customDomain ?? "");
      setMaxUpload(
        res.tenant.maxUploadMib !== null
          ? String(res.tenant.maxUploadMib)
          : ""
      );
      try {
        const me = await api.me();
        setRole(me?.user?.role ?? null);
      } catch {
        // Rolle nicht ermittelbar — Slug-Sektion bleibt dann verborgen.
      }
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
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Custom-Domain-Status pollen — beim ersten Speichern weiß man nicht
  // ob DNS schon stimmt und Caddy ein Cert hat. Wir pollen alle 8s
  // solange Status nicht "fertig" ist (= DNS korrekt + TLS valid).
  // Sobald beides ok, stoppen. Bei configured=false (keine Domain
  // eingetragen) gar nicht erst pollen.
  useEffect(() => {
    if (!settings?.customDomain) {
      setCustomDomainStatus(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const s = await api.getCustomDomainStatus();
        if (cancelled) return;
        setCustomDomainStatus(s);
        // Weiter pollen wenn noch nicht alles gut ist
        const done =
          s.configured === false ||
          (s.configured === true && s.dns.correct && s.tls.status === "valid");
        if (!done) {
          timer = setTimeout(tick, 8000);
        }
      } catch {
        // Bei Fehler nicht weiter pollen — User sieht stale-Status oder
        // null und kann manuell auf Speichern klicken um neu zu triggern
      }
    }
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [settings?.customDomain]);

  async function saveDisplayName() {
    setDisplayNameSaving(true);
    setError(null);
    try {
      const res = await api.updateTenantSettings({
        // Leerer String wird vom Backend zu null transformiert (Fallback
        // auf den internen Namen). Wir senden den trimmed Wert oder null
        // damit unsere lokale 'changed?'-Logik mit dem Backend uebereinstimmt.
        displayName: displayName.trim() || null,
      });
      setSettings(res.tenant);
      setDisplayName(res.tenant.displayName ?? "");
      setDisplayNameSaved(true);
      setTimeout(() => setDisplayNameSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setDisplayNameSaving(false);
    }
  }

  async function saveSlug() {
    const cleaned = slug.trim().toLowerCase();
    if (!cleaned || cleaned === settings?.slug) return;
    setSlugSaving(true);
    setError(null);
    try {
      const res = await api.updateTenantSettings({ slug: cleaned });
      // Die bisherige Subdomain ist jetzt ungültig — auf die neue umziehen.
      // Dort muss neu eingeloggt werden (Session-Cookie ist host-gebunden).
      const base = deployment?.domainBase;
      if (base) {
        const proto =
          typeof window !== "undefined" ? window.location.protocol : "https:";
        window.location.href = `${proto}//${res.tenant.slug}.${base}/login`;
        return;
      }
      setSettings(res.tenant);
      setSlug(res.tenant.slug);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("settings.slugChangeError")
      );
      setSlugSaving(false);
    }
  }

  async function saveText() {
    setTextSaving(true);
    setError(null);
    try {
      const res = await api.updateTenantSettings({
        watermarkText: text.trim() || null,
      });
      setSettings(res.tenant);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
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
      // Nach dem Speichern direkt einen Status-Check anstossen
      if (domain.trim()) {
        void checkDomain();
      } else {
        setCustomDomainStatus(null);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("common.error");
      setError(
        msg.includes("domain_taken")
          ? t("settings.domainInUse")
          : msg
      );
    } finally {
      setDomainSaving(false);
    }
  }

  async function checkDomain() {
    setDomainChecking(true);
    try {
      const status = await api.getCustomDomainStatus();
      setCustomDomainStatus(status);
    } catch {
      setCustomDomainStatus(null);
    } finally {
      setDomainChecking(false);
    }
  }

  async function saveMaxUpload() {
    setMaxUploadSaving(true);
    setError(null);
    try {
      // Leer = null (zurück auf ENV-Default)
      const value =
        maxUpload.trim() === "" || isNaN(Number(maxUpload))
          ? null
          : Math.floor(Number(maxUpload));
      const res = await api.updateTenantSettings({ maxUploadMib: value });
      setSettings(res.tenant);
      // Input-Wert nach erfolgreichem Save aus der Server-Antwort
      // zurücksetzen (falls null-zurückgekommen)
      setMaxUpload(
        res.tenant.maxUploadMib !== null
          ? String(res.tenant.maxUploadMib)
          : ""
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("common.error");
      setError(
        msg.includes("exceeds_hard_cap")
          ? t("studio.uploadLimit.errorHardCap", {
              cap: uploadLimits?.hardCapMib ?? "?",
            })
          : msg
      );
    } finally {
      setMaxUploadSaving(false);
    }
  }

  async function saveZipPart() {
    setZipPartSaving(true);
    setError(null);
    try {
      // Leer = null (zurück auf ENV-Default 8 GiB)
      const value =
        zipPart.trim() === "" || isNaN(Number(zipPart))
          ? null
          : Math.floor(Number(zipPart));
      const res = await api.updateTenantSettings({ zipPartMaxMib: value });
      setSettings(res.tenant);
      setZipPart(
        res.tenant.zipPartMaxMib !== null
          ? String(res.tenant.zipPartMaxMib)
          : ""
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("common.error");
      setError(
        msg.includes("exceeds_hard_cap")
          ? t("studio.zipPart.errorHardCap", {
              cap: zipPartLimits?.hardCapMib ?? "?",
            })
          : msg
      );
    } finally {
      setZipPartSaving(false);
    }
  }

  function toggleKind(k: string) {
    setKinds((prev) =>
      prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]
    );
  }

  async function saveKinds() {
    setKindsSaving(true);
    setError(null);
    try {
      // Auswahl == Default -> null (Default erben), sonst explizite Liste.
      const sameAsDefault =
        kinds.length === kindsDefault.length &&
        kinds.every((k) => kindsDefault.includes(k));
      const res = await api.updateTenantSettings({
        uploadAllowedKinds: sameAsDefault ? null : kinds,
      });
      setSettings(res.tenant);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setKindsSaving(false);
    }
  }

  const kindLabel: Record<string, string> = {
    image: t("studio.uploadAllow.kindImage"),
    heic: t("studio.uploadAllow.kindHeic"),
    raw: t("studio.uploadAllow.kindRaw"),
    video: t("studio.uploadAllow.kindVideo"),
    pdf: t("studio.uploadAllow.kindPdf"),
    other: t("studio.uploadAllow.kindOther"),
  };

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
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setImageSaving(false);
    }
  }

  async function removeImage() {
    if (!confirm(t("settings.watermarkRemoveConfirm"))) return;
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
        {t("common.loading")}
      </div>
    );
  }
  if (!settings) {
    return (
      <div className="px-6 sm:px-8 lg:px-12 py-8">
        <div className="text-ui text-semantic-danger">
          {error ?? t("settings.loadError")}
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: t("nav.studio"), href: "/studio" },
          { label: t("settings.title") },
        ]}
        title={t("settings.title")}
        description={settings.name}
      />

      <div className="px-6 sm:px-8 lg:px-12 py-6 space-y-6 max-w-5xl">

        {error && (
          <div className="text-ui-sm text-semantic-danger bg-semantic-danger/10 border border-semantic-danger/30 rounded-sm px-3 py-2">
            {error}
          </div>
        )}

        {/* Studio-Identitaet: oeffentlicher Anzeigename. */}
        <section className="rounded-lg border border-line-subtle bg-surface-raised p-5 space-y-3">
          <div>
            <h2 className="text-sm font-medium">{t("settings.studioName")}</h2>
            <p className="text-xs text-ink-tertiary mt-0.5 leading-relaxed">
              {t("settings.studioNameDescPre")}{" "}
              <span className="font-mono text-ink-secondary">
                {settings.name}
              </span>{" "}
              {" "}{t("settings.studioNameDescPost")}
            </p>
          </div>
          <input
            type="text"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              setDisplayNameSaved(false);
            }}
            maxLength={120}
            placeholder={t("settings.studioNamePlaceholder", { name: settings.name })}
            className="w-full h-9 px-2.5 rounded bg-surface-sunken border border-line-subtle hover:border-line-strong focus:border-accent text-ui text-ink-primary focus:outline-none transition-colors duration-motion disabled:opacity-50"
          />
          <div className="flex justify-end items-center gap-2">
            {displayNameSaved && (
              <span className="text-ui-sm text-semantic-success">
                {t("settings.saved")}
              </span>
            )}
            <button
              onClick={saveDisplayName}
              disabled={
                displayNameSaving ||
                (displayName.trim() === (settings.displayName ?? ""))
              }
              className="text-sm px-3 py-1.5 rounded-md border border-line-subtle hover:bg-surface-sunken disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {displayNameSaving ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </section>

        {/* Studio-Adresse (Subdomain) — nur Multi-Mode + Owner. */}
        {deployment?.mode === "multi" &&
          role === "owner" &&
          deployment.domainBase && (
            <section className="rounded-lg border border-line-subtle bg-surface-raised p-5 space-y-3">
              <div>
                <h2 className="text-sm font-medium">{t("settings.studioAddress")}</h2>
                <p className="text-xs text-ink-tertiary mt-0.5 leading-relaxed">
                  {t("settings.studioAddressDesc")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={slug}
                  onChange={(e) =>
                    setSlug(e.target.value.toLowerCase().replace(/\s/g, ""))
                  }
                  maxLength={30}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className="flex-1 h-9 px-2.5 rounded bg-surface-sunken border border-line-subtle hover:border-line-strong focus:border-accent text-ui text-ink-primary focus:outline-none transition-colors duration-motion disabled:opacity-50"
                />
                <span className="text-ui-sm text-ink-tertiary font-mono whitespace-nowrap">
                  .{deployment.domainBase}
                </span>
              </div>
              <div className="rounded-sm bg-semantic-warning/10 border border-semantic-warning/30 px-3 py-2 text-xs text-ink-secondary leading-relaxed">
                {t("settings.addressWarnPre")}{" "}
                <span className="font-mono">
                  {settings.slug}.{deployment.domainBase}
                </span>{" "}
                {" "}{t("settings.addressWarnPost")}
              </div>
              <div className="flex justify-end">
                <button
                  onClick={saveSlug}
                  disabled={
                    slugSaving ||
                    !slug.trim() ||
                    slug.trim().toLowerCase() === settings.slug
                  }
                  className="text-sm px-3 py-1.5 rounded-md border border-line-subtle hover:bg-surface-sunken disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {slugSaving ? t("settings.changing") : t("settings.changeAddress")}
                </button>
              </div>
            </section>
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

        {/* Studio-URL — nur im Multi-Mode mit echter Tenant-Subdomain.
            Single-Mode-Self-Hoster sehen das nicht (slug ist 'default'
            und Subdomain ist bei ihnen kein Konzept — sie nutzen ihre
            eigene Domain direkt). Wenn LUMIO_DOMAIN_BASE nicht gesetzt
            ist, koennen wir keine sinnvolle URL bauen, daher auch hidden. */}
        {deployment?.mode === "multi" &&
          settings.slug !== "default" &&
          deployment.domainBase && (
            <section className="rounded-lg border border-line-subtle bg-surface-raised p-5 space-y-3">
              <h2 className="text-sm font-medium">{t("settings.studioUrl")}</h2>
              <p className="text-xs text-ink-tertiary">
                {t("settings.studioUrlDesc")}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <code className="text-sm font-mono bg-surface-sunken px-3 py-2 rounded-md flex-1 min-w-0 truncate">
                  https://{settings.slug}.{deployment.domainBase}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(
                      `https://${settings.slug}.${deployment.domainBase}`
                    );
                  }}
                  className="text-sm px-3 py-2 rounded-md border border-line-subtle hover:bg-surface-sunken"
                >{t("settings.copy")}</button>
              </div>
              {settings.customDomain && (
                <div className="pt-2 border-t border-line-subtle">
                  <p className="text-xs text-ink-tertiary mb-2">
                    {t("settings.ownDomainConfigured")}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-sm font-mono bg-surface-sunken px-3 py-2 rounded-md flex-1 min-w-0 truncate">
                      https://{settings.customDomain}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(
                          `https://${settings.customDomain}`
                        );
                      }}
                      className="text-sm px-3 py-2 rounded-md border border-line-subtle hover:bg-surface-sunken"
                    >{t("settings.copy")}</button>
                  </div>
                </div>
              )}
            </section>
          )}

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
                <h2 className="text-sm font-medium">{t("settings.customDomain")}</h2>
                {!planAllows && (
                  <Link
                    href="/studio/billing"
                    className="text-ui-xs px-2 py-1 rounded bg-accent/15 text-accent hover:bg-accent/25"
                  >
                    {t("settings.planFrom")}
                  </Link>
                )}
              </div>
              <p className="text-xs text-ink-tertiary">
                {t("settings.customDomainDescFull")}
              </p>

              {/* Konkrete DNS-Setup-Anweisungen mit echter Server-IP */}
              {deployment?.publicIp && (
                <div className="text-xs bg-surface-sunken rounded p-3 space-y-1.5">
                  <div className="font-medium text-ink-secondary">
                    {t("settings.dnsRecordLabel")}
                  </div>
                  <div className="font-mono">
                    <span className="text-ink-tertiary">Type:</span>{" "}
                    <span className="text-ink-primary">A</span>
                    {"  "}
                    <span className="text-ink-tertiary">{t("settings.dnsValue")}</span>{" "}
                    <span className="text-ink-primary">
                      {deployment.publicIp}
                    </span>
                  </div>
                  <div className="text-ink-tertiary">
                    {t("settings.dnsCnameAlt")}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <input
                  value={domain}
                  onChange={(e) => setDomain(e.target.value.toLowerCase())}
                  placeholder={t("settings.domainPlaceholder")}
                  disabled={!planAllows}
                  className="flex-1 rounded-md border border-line-subtle px-3 py-2 text-sm font-mono disabled:cursor-not-allowed disabled:bg-surface-sunken"
                />
                <button
                  onClick={saveDomain}
                  disabled={domainSaving || !planAllows}
                  className="text-sm px-3 py-2 rounded-md bg-accent text-accent-contrast hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {domainSaving ? t("common.saving") : t("common.save")}
                </button>
                {settings.customDomain && (
                  <button
                    onClick={checkDomain}
                    disabled={domainChecking}
                    className="text-sm px-3 py-2 rounded-md border border-line-subtle hover:bg-surface-sunken disabled:opacity-50"
                  >
                    {domainChecking ? t("settings.checking") : t("settings.checkNow")}
                  </button>
                )}
              </div>

              {/* Status-Anzeige nach dem Speichern: DNS + TLS-Cert */}
              {settings.customDomain &&
                customDomainStatus?.configured === true && (
                  <div className="space-y-2 pt-1">
                    <StatusRow
                      label={t("settings.dnsResolution")}
                      state={
                        customDomainStatus.dns.correct
                          ? "ok"
                          : customDomainStatus.dns.resolved.length === 0
                          ? "pending"
                          : "warn"
                      }
                      message={
                        customDomainStatus.dns.correct
                          ? t("settings.dnsCorrect", { domain: customDomainStatus.domain, ip: customDomainStatus.expectedIp ?? "" })
                          : customDomainStatus.dns.resolved.length === 0
                          ? customDomainStatus.dns.error
                            ? t("settings.dnsNotResolvableErr", { error: customDomainStatus.dns.error })
                            : t("settings.dnsNotResolvable")
                          : t("settings.dnsWrong", { actual: customDomainStatus.dns.resolved.join(", "), expected: customDomainStatus.expectedIp ?? "" })
                      }
                    />
                    <StatusRow
                      label={t("settings.tlsCert")}
                      state={
                        customDomainStatus.tls.status === "valid"
                          ? "ok"
                          : customDomainStatus.tls.status === "invalid"
                          ? "warn"
                          : "pending"
                      }
                      message={
                        customDomainStatus.tls.status === "valid"
                          ? t("settings.tlsValid")
                          : customDomainStatus.tls.status === "no_dns"
                          ? t("settings.tlsNoDns")
                          : customDomainStatus.tls.status === "pending"
                          ? t("settings.tlsPending")
                          : t("settings.tlsInvalid", { detail: customDomainStatus.tls.detail ?? t("settings.unknownError") })
                      }
                    />
                  </div>
                )}
            </section>
          );
        })()}

        {/* Upload-Limit pro File */}
        <section className="rounded-lg border border-line-subtle bg-surface-raised p-5 space-y-3">
          <h2 className="text-sm font-medium">
            {t("studio.uploadLimit.heading")}
          </h2>
          <p className="text-xs text-ink-tertiary">
            {t("studio.uploadLimit.description", {
              default: uploadLimits?.defaultMib ?? "?",
              cap: uploadLimits?.hardCapMib ?? "?",
            })}
          </p>
          <div className="flex items-end gap-2">
            <label className="flex-1">
              <span className="text-xs text-ink-secondary">
                {t("studio.uploadLimit.field")}
              </span>
              <input
                type="number"
                min="1"
                max={uploadLimits?.hardCapMib ?? undefined}
                value={maxUpload}
                onChange={(e) => setMaxUpload(e.target.value)}
                placeholder={
                  uploadLimits
                    ? `${t("studio.uploadLimit.defaultPlaceholder", { default: uploadLimits.defaultMib })}`
                    : ""
                }
                className="w-full mt-1 bg-surface-canvas border border-line-subtle rounded px-3 py-2 text-ink-primary focus:outline-none focus:border-accent transition-colors duration-motion"
              />
            </label>
            <button
              onClick={saveMaxUpload}
              disabled={maxUploadSaving}
              className="h-10 px-4 rounded bg-accent text-accent-contrast text-ui-sm font-medium disabled:opacity-50 hover:bg-accent-hover transition-colors duration-motion"
            >
              {maxUploadSaving ? t("common.saving") : t("common.save")}
            </button>
          </div>
          {settings && uploadLimits && (
            <div className="text-xs text-ink-tertiary">
              {t("studio.uploadLimit.effective", {
                value: settings.maxUploadMib ?? uploadLimits.defaultMib,
              })}
              {settings.maxUploadMib === null && (
                <span className="ml-1 italic">
                  ({t("studio.uploadLimit.usingDefault")})
                </span>
              )}
            </div>
          )}
        </section>

        {/* Max. Größe pro Download-Paket (Teil-ZIP) */}
        <section className="rounded-lg border border-line-subtle bg-surface-raised p-5 space-y-3">
          <h2 className="text-sm font-medium">
            {t("studio.zipPart.heading")}
          </h2>
          <p className="text-xs text-ink-tertiary">
            {t("studio.zipPart.description", {
              default: zipPartLimits ? Math.round(zipPartLimits.defaultMib / 1024) : "?",
              cap: zipPartLimits ? Math.round(zipPartLimits.hardCapMib / 1024) : "?",
            })}
          </p>
          <div className="flex items-end gap-2">
            <label className="flex-1">
              <span className="text-xs text-ink-secondary">
                {t("studio.zipPart.field")}
              </span>
              <input
                type="number"
                min="1"
                max={zipPartLimits?.hardCapMib ?? undefined}
                value={zipPart}
                onChange={(e) => setZipPart(e.target.value)}
                placeholder={
                  zipPartLimits
                    ? `${t("studio.zipPart.defaultPlaceholder", { default: zipPartLimits.defaultMib })}`
                    : ""
                }
                className="w-full mt-1 bg-surface-canvas border border-line-subtle rounded px-3 py-2 text-ink-primary focus:outline-none focus:border-accent transition-colors duration-motion"
              />
            </label>
            <button
              onClick={saveZipPart}
              disabled={zipPartSaving}
              className="h-10 px-4 rounded bg-accent text-accent-contrast text-ui-sm font-medium disabled:opacity-50 hover:bg-accent-hover transition-colors duration-motion"
            >
              {zipPartSaving ? t("common.saving") : t("common.save")}
            </button>
          </div>
          {settings && zipPartLimits && (
            <div className="text-xs text-ink-tertiary">
              {t("studio.zipPart.effective", {
                value: settings.zipPartMaxMib ?? zipPartLimits.defaultMib,
              })}
              {settings.zipPartMaxMib === null && (
                <span className="ml-1 italic">
                  ({t("studio.zipPart.usingDefault")})
                </span>
              )}
            </div>
          )}
        </section>

        {/* Erlaubte Dateitypen */}
        <section className="rounded-lg border border-line-subtle bg-surface-raised p-5 space-y-3">
          <h2 className="text-sm font-medium">
            {t("studio.uploadAllow.heading")}
          </h2>
          <p className="text-xs text-ink-tertiary">
            {t("studio.uploadAllow.description")}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {allKinds.map((k) => (
              <label
                key={k}
                className="flex items-center gap-2 text-ui-sm text-ink-secondary"
              >
                <input
                  type="checkbox"
                  checked={kinds.includes(k)}
                  onChange={() => toggleKind(k)}
                  className="accent-accent"
                />
                {kindLabel[k] ?? k}
              </label>
            ))}
          </div>
          <p className="text-xs text-ink-tertiary italic">
            {t("studio.uploadAllow.note")}
          </p>
          <button
            onClick={saveKinds}
            disabled={kindsSaving || kinds.length === 0}
            className="h-10 px-4 rounded bg-accent text-accent-contrast text-ui-sm font-medium disabled:opacity-50 hover:bg-accent-hover transition-colors duration-motion"
          >
            {kindsSaving ? t("common.saving") : t("common.save")}
          </button>
        </section>

        {/* Watermark-Text */}
        <section className="rounded-lg border border-line-subtle bg-surface-raised p-5 space-y-3">
          <h2 className="text-sm font-medium">{t("settings.watermarkText")}</h2>
          <p className="text-xs text-ink-tertiary">
            {t("settings.watermarkTextDesc")}
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
              {textSaving ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </section>

        {/* Watermark-Bild */}
        <section className="rounded-lg border border-line-subtle bg-surface-raised p-5 space-y-3">
          <h2 className="text-sm font-medium">{t("settings.watermarkImage")}</h2>
          <p className="text-xs text-ink-tertiary">
            {t("settings.watermarkImageDesc")}
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
                {t("common.remove")}
              </button>
            </div>
          ) : (
            <div className="text-xs text-ink-tertiary">
              {t("settings.noWatermarkImage")}
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
                ? t("settings.uploading")
                : settings.watermarkImageKey
                ? t("settings.replaceImage")
                : t("settings.uploadImage")}
            </button>
            <span className="text-xs text-ink-tertiary ml-2">
              {t("settings.imageMaxHint")}
            </span>
          </div>

          <div className="text-xs text-ink-tertiary bg-semantic-warning/10 border border-semantic-warning/30 rounded p-2">
            <strong>{t("settings.noteLabel")}</strong> {t("settings.watermarkHintPre")}
            <em> watermarkEnabled</em> {t("settings.watermarkHintPost")}
          </div>
        </section>

        <NotificationSettings
          canEdit={role === "owner" || role === "admin"}
        />
      </div>
    </>
  );
}
