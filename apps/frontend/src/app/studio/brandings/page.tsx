"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, type BrandingDetail, type BillingUsage } from "@/lib/api";
import { PageHeader } from "@/components/studio/PageHeader";
import { Button } from "@/components/ui";
import { useT } from "@/lib/i18n";

export default function BrandingsPage() {
  const t = useT();
  const router = useRouter();
  const [brandings, setBrandings] = useState<BrandingDetail[]>([]);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [usage, setUsage] = useState<BillingUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    try {
      const res = await api.listBrandings();
      setBrandings(res.brandings);
      setDefaultId(res.defaultBrandingId);
      // Billing-Usage parallel — wenn nicht aktiv (Self-Hosted), null
      try {
        const u = await api.getBillingUsage();
        setUsage(u);
      } catch {
        setUsage(null);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("401")) {
        router.replace("/login");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Plan-Limit-Check für "Neues Branding erstellen". usage===null bei
  // Self-Hosted ohne Billing → immer erlaubt. Sonst: maximal so viele
  // Brandings wie der Plan erlaubt (Solo=0, Studio=1, Pro=5).
  const brandingsAllowed =
    usage === null || brandings.length < usage.plan.brandings;
  const brandingsMin =
    usage === null
      ? "studio"
      : usage.plan.brandings === 0
      ? "studio"
      : "pro";

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-ui text-ink-tertiary">{t("common.loading")}</div>
    );
  }

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: t("brandingsList.breadcrumbStudio"), href: "/studio" },
          { label: t("brandingsList.breadcrumb") },
        ]}
        title={t("brandingsList.title")}
        description={t("brandingsList.description")}
        actions={
          brandingsAllowed ? (
            <Button variant="primary" onClick={() => setShowCreate(true)}>{t("brandingsList.newProfile")}</Button>
          ) : (
            <Link
              href="/studio/billing"
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-accent/15 text-accent hover:bg-accent/25 text-ui-sm font-medium transition-colors duration-motion"
              title={t("brandingsList.planBadgeTitle", { plan: brandingsMin === "studio" ? "Studio" : "Pro" })}
            >
              <span>{t("brandingsList.planBadge", { plan: brandingsMin === "studio" ? "Studio" : "Pro" })}</span>
            </Link>
          )
        }
      />

      <div className="px-6 sm:px-8 lg:px-12 py-6 space-y-6 max-w-5xl">

        {/* Empty-State Variante anpassen: wenn der Plan kein Branding
            erlaubt, ist die "noch keine erstellt"-Hint irreführend. */}
        {brandings.length === 0 && brandingsAllowed ? (
          <div className="rounded-md border border-dashed border-line-subtle bg-surface-sunken p-12 text-center">
            <div className="text-ink-tertiary text-ui">{t("brandingsList.noProfiles")}</div>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-3 text-ui-sm font-medium text-accent hover:text-accent-hover transition-colors duration-motion"
            >{t("brandingsList.createFirst")}</button>
          </div>
        ) : brandings.length === 0 && !brandingsAllowed ? (
          <div className="rounded-md border border-dashed border-line-subtle bg-surface-sunken p-12 text-center">
            <div className="text-ink-secondary text-ui">
              {t("brandingsList.planRequired", { plan: brandingsMin === "studio" ? "Studio" : "Pro" })}
            </div>
            <Link
              href="/studio/billing"
              className="mt-3 inline-block text-ui-sm font-medium text-accent hover:text-accent-hover transition-colors duration-motion"
            >{t("brandingsList.viewPlan")}</Link>
          </div>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {brandings.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/studio/brandings/${b.id}`}
                  className="block rounded-lg border border-line-subtle bg-surface-raised hover:border-line-strong hover:shadow-sm transition overflow-hidden"
                >
                  <div
                    className="h-20 flex items-center justify-center"
                    style={{ backgroundColor: b.primaryColor }}
                  >
                    {b.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={b.logoUrl}
                        alt=""
                        className="h-12 max-w-[60%] object-contain"
                      />
                    ) : (
                      <span
                        className="text-lg font-medium"
                        style={{
                          color: b.accentColor,
                          fontFamily: b.fontFamily,
                        }}
                      >
                        {b.name}
                      </span>
                    )}
                  </div>
                  <div className="p-4 space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{b.name}</div>
                      {defaultId === b.id && (
                        <span className="text-[10px] font-medium uppercase tracking-wider bg-semantic-success/15 text-semantic-success px-1.5 py-0.5 rounded">{t("brandingsList.defaultBadge")}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-ink-tertiary">
                      <ColorSwatch color={b.primaryColor} />
                      <ColorSwatch color={b.accentColor} />
                      <span className="ml-2">{b.fontFamily}</span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showCreate && (
        <CreateBrandingDialog
          onClose={() => setShowCreate(false)}
          onCreated={(b) => {
            setShowCreate(false);
            router.push(`/studio/brandings/${b.id}`);
          }}
        />
      )}
    </>
  );
}

function ColorSwatch({ color }: { color: string }) {
  return (
    <span
      className="inline-block w-4 h-4 rounded border border-line-subtle"
      style={{ backgroundColor: color }}
      title={color}
    />
  );
}

function CreateBrandingDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (b: BrandingDetail) => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const { branding } = await api.createBranding({ name });
      onCreated(branding);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-surface-raised rounded-lg p-6 space-y-4"
      >
        <h2 className="text-lg font-semibold">{t("brandingsList.dialogTitle")}</h2>
        <input
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("brandingsList.namePlaceholder")}
          className="w-full rounded-md border border-line-subtle px-3 py-2 text-sm"
        />
        {error && (
          <div className="text-sm text-semantic-danger bg-semantic-danger/10 border border-semantic-danger/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-3 py-2 rounded-md border border-line-subtle hover:bg-surface-sunken"
          >{t("common.cancel")}</button>
          <button
            type="submit"
            disabled={pending}
            className="text-sm px-3 py-2 rounded-md bg-accent text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
          >
            {pending ? t("common.creating") : t("common.create")}
          </button>
        </div>
      </form>
    </div>
  );
}
