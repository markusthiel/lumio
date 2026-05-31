"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, type GalleryTemplate } from "@/lib/api";
import { PageHeader } from "@/components/studio/PageHeader";
import { Button } from "@/components/ui";
import { useT } from "@/lib/i18n";

export default function TemplatesPage() {
  const t = useT();
  const router = useRouter();
  const [templates, setTemplates] = useState<GalleryTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    try {
      const res = await api.listTemplates();
      setTemplates(res.templates);
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-ui text-ink-tertiary">
        Lädt…
      </div>
    );
  }

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: t("nav.studio"), href: "/studio" },
          { label: t("nav.templates") },
        ]}
        title={t("templates.pageTitle")}
        description={t("templates.pageSubtitle")}
        actions={
          <Button variant="primary" onClick={() => setShowCreate(true)}>{t("templates.newTemplateBtn")}</Button>
        }
      />

      <div className="px-6 sm:px-8 lg:px-12 py-6 space-y-6 max-w-5xl">
        {templates.length === 0 ? (
          <div className="rounded-md border border-dashed border-line-subtle bg-surface-sunken p-12 text-center">
            <div className="text-ink-tertiary text-ui">
              Noch keine Templates angelegt.
            </div>
            <p className="text-ui-xs text-ink-tertiary mt-2 max-w-md mx-auto">
              Templates sparen Zeit beim Anlegen wiederkehrender
              Galerie-Typen wie Hochzeit, Newborn oder Portrait —
              alle Settings werden als Defaults übernommen.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-4 text-sm font-medium text-accent hover:underline"
            >
              Erstes Template erstellen →
            </button>
          </div>
        ) : (
          <ul className="space-y-3">
            {templates.map((tpl) => (
              <li key={tpl.id}>
                <Link
                  href={`/studio/templates/${tpl.id}`}
                  className="block rounded-lg border border-line-subtle bg-surface-raised hover:border-line-strong hover:shadow-sm transition p-4"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{tpl.name}</div>
                      {tpl.description && (
                        <div className="text-xs text-ink-tertiary mt-0.5">
                          {tpl.description}
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-ink-tertiary font-mono uppercase tracking-wider">
                      {tpl.mode}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
                    <Badge on={tpl.downloadEnabled}>Download</Badge>
                    <Badge on={tpl.watermarkEnabled}>Watermark</Badge>
                    <Badge on={tpl.commentsEnabled}>{t("templates.comments")}</Badge>
                    <Badge on={tpl.ratingsEnabled}>Ratings</Badge>
                    {tpl.defaultExpiryDays && (
                      <span className="px-1.5 py-0.5 rounded bg-surface-sunken text-ink-secondary">
                        {tpl.defaultExpiryDays} {t("templates.days")}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showCreate && (
        <CreateTemplateDialog
          onClose={() => setShowCreate(false)}
          onCreated={(t) => {
            setShowCreate(false);
            router.push(`/studio/templates/${t.id}`);
          }}
        />
      )}
    </>
  );
}

function Badge({
  on,
  children,
}: {
  on: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`px-1.5 py-0.5 rounded ${
        on
          ? "bg-semantic-success/15 text-semantic-success"
          : "bg-surface-sunken text-ink-tertiary line-through"
      }`}
    >
      {children}
    </span>
  );
}

function CreateTemplateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (t: GalleryTemplate) => void;
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
      const { template } = await api.createTemplate({ name });
      onCreated(template);
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
        <h2 className="text-lg font-semibold">{t("templates.newTemplate")}</h2>
        <input
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="z.B. Hochzeit, Newborn, Portrait"
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
          >
            Abbrechen
          </button>
          <button
            type="submit"
            disabled={pending}
            className="text-sm px-3 py-2 rounded-md bg-accent text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
          >
            {pending ? "Wird erstellt…" : "Erstellen"}
          </button>
        </div>
      </form>
    </div>
  );
}
