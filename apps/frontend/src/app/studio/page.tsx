"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, type ApiUser, type Gallery, type GalleryTemplate } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { PageHeader } from "@/components/studio/PageHeader";
import { Button, Input, Textarea, Select } from "@/components/ui";

export default function StudioPage() {
  const router = useRouter();
  const t = useT();
  const [user, setUser] = useState<ApiUser | null>(null);
  const [galleries, setGalleries] = useState<Gallery[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const me = await api.me();
        setUser(me.user);
        const list = await api.listGalleries();
        setGalleries(list.galleries);
      } catch {
        router.replace("/login");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function refresh() {
    const list = await api.listGalleries();
    setGalleries(list.galleries);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-ui text-ink-tertiary">
        Lädt…
      </div>
    );
  }
  if (!user) return null;

  return (
    <>
      <PageHeader
        title="Galerien"
        description={user.name ? `Angemeldet als ${user.name}` : user.email}
        actions={
          <Button variant="primary" size="md" onClick={() => setShowCreate(true)}>
            {t("studio.newGallery")}
          </Button>
        }
      />

      <div className="px-6 sm:px-8 py-6">
        {galleries.length === 0 ? (
          <div className="rounded-md border border-dashed border-line-subtle bg-surface-sunken p-12 text-center">
            <p className="text-ink-tertiary text-ui">{t("studio.noGalleries")}</p>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="mt-3 text-ui-sm font-medium text-accent hover:text-accent-hover transition-colors duration-motion"
            >
              {t("studio.firstGallery")}
            </button>
          </div>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {galleries.map((g, i) => (
              <li
                key={g.id}
                className="animate-reveal"
                style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
              >
                <Link
                  href={`/studio/${g.id}`}
                  className="block rounded-md border border-line-subtle bg-surface-raised hover:border-line-strong hover:bg-surface-overlay transition-all duration-motion ease-out p-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-ui-md font-medium text-ink-primary truncate">
                      {g.title}
                    </h2>
                    <StatusBadge status={g.status} />
                  </div>
                  {g.description && (
                    <p className="text-ui-sm text-ink-tertiary mt-1.5 line-clamp-2">
                      {g.description}
                    </p>
                  )}
                  <div className="text-ui-xs text-ink-tertiary mt-4 flex items-center gap-2">
                    <span>{g.fileCount ?? 0} Files</span>
                    <span className="text-ink-tertiary/40">·</span>
                    <span className="capitalize">{g.mode}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showCreate && (
        <CreateGalleryDialog
          onClose={() => setShowCreate(false)}
          onCreated={(g) => {
            setShowCreate(false);
            router.push(`/studio/${g.id}`);
            void refresh();
          }}
        />
      )}
    </>
  );
}

function StatusBadge({ status }: { status: Gallery["status"] }) {
  const styles: Record<Gallery["status"], string> = {
    draft: "bg-surface-sunken text-ink-tertiary border-line-subtle",
    live: "bg-semantic-success/12 text-semantic-success border-semantic-success/30",
    archived: "bg-semantic-warning/12 text-semantic-warning border-semantic-warning/30",
  };
  const labels: Record<Gallery["status"], string> = {
    draft: "Entwurf",
    live: "Live",
    archived: "Archiv",
  };
  return (
    <span
      className={`text-ui-xs font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-xs border ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}

function CreateGalleryDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (g: Gallery) => void;
}) {
  const [templates, setTemplates] = useState<GalleryTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<"collaboration" | "presentation">(
    "collaboration"
  );
  const [downloadEnabled, setDownloadEnabled] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [descriptionDirty, setDescriptionDirty] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.listTemplates();
        setTemplates(res.templates);
      } catch {
        /* Templates sind optional */
      }
    })();
  }, []);

  function applyTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setMode(t.mode as typeof mode);
    setDownloadEnabled(t.downloadEnabled);
    if (!descriptionDirty && t.defaultDescription) {
      setDescription(t.defaultDescription);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const { gallery } = await api.createGallery({
        title,
        description: description || undefined,
        mode,
        downloadEnabled,
        templateId: templateId || undefined,
      });
      onCreated(gallery);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
        className="w-full max-w-md bg-surface-overlay border border-line-subtle rounded-md p-6 space-y-4 shadow-elev-3"
      >
        <h2 className="text-display-sm font-medium text-ink-primary">
          Neue Galerie
        </h2>

        {templates.length > 0 && (
          <Field
            label="Template"
            optionalLabel
            htmlFor="template"
            hint="Vorlage übernimmt Modus, Download-Setting und Beschreibung"
          >
            <Select
              id="template"
              value={templateId}
              onChange={(e) => applyTemplate(e.target.value)}
            >
              <option value="">— ohne Template —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Titel" htmlFor="title">
          <Input
            id="title"
            required
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="z.B. Hochzeit Müller-Schmidt 2026"
          />
        </Field>

        <Field label="Beschreibung" htmlFor="desc" optionalLabel>
          <Textarea
            id="desc"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setDescriptionDirty(true);
            }}
            rows={2}
          />
        </Field>

        <Field label="Modus" htmlFor="mode">
          <Select
            id="mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option value="collaboration">
              Collaboration (Auswahl, Kommentare)
            </option>
            <option value="presentation">Presentation (nur Anzeige)</option>
          </Select>
        </Field>

        <label className="flex items-center gap-2 text-ui text-ink-primary cursor-pointer">
          <input
            type="checkbox"
            checked={downloadEnabled}
            onChange={(e) => setDownloadEnabled(e.target.checked)}
            className="accent-accent"
          />
          Download für Kunden erlauben
        </label>

        {error && (
          <div className="text-ui-sm text-semantic-danger bg-semantic-danger/10 border border-semantic-danger/30 rounded-sm px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Wird erstellt…" : "Erstellen"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  optionalLabel,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  optionalLabel?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-ui-sm font-medium text-ink-primary block">
        {label}
        {optionalLabel && (
          <span className="text-ink-tertiary font-normal ml-1">(optional)</span>
        )}
      </label>
      {children}
      {hint && <p className="text-ui-xs text-ink-tertiary">{hint}</p>}
    </div>
  );
}
