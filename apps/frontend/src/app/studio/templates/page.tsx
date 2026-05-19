"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, type GalleryTemplate } from "@/lib/api";

export default function TemplatesPage() {
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
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-slate-500">Lädt…</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="border-b border-slate-200 pb-4">
          <div className="text-xs">
            <Link href="/studio" className="text-slate-500 hover:text-slate-900">
              ← Studio
            </Link>
          </div>
          <div className="flex items-end justify-between mt-2">
            <div>
              <h1 className="text-2xl font-semibold">Galerie-Templates</h1>
              <p className="text-sm text-slate-500">
                Wiederverwendbare Einstellungen für neue Galerien.
              </p>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="text-sm px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800"
            >
              Neues Template
            </button>
          </div>
        </header>

        {templates.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-slate-200 p-12 text-center">
            <div className="text-slate-500 text-sm">
              Noch keine Templates angelegt.
            </div>
            <p className="text-xs text-slate-400 mt-2 max-w-md mx-auto">
              Templates sparen Zeit beim Anlegen wiederkehrender
              Galerie-Typen wie Hochzeit, Newborn oder Portrait —
              alle Settings werden als Defaults übernommen.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-4 text-sm font-medium text-brand-accent hover:underline"
            >
              Erstes Template erstellen →
            </button>
          </div>
        ) : (
          <ul className="space-y-3">
            {templates.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/studio/templates/${t.id}`}
                  className="block rounded-lg border border-slate-200 bg-white hover:border-slate-400 hover:shadow-sm transition p-4"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{t.name}</div>
                      {t.description && (
                        <div className="text-xs text-slate-500 mt-0.5">
                          {t.description}
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 font-mono uppercase tracking-wider">
                      {t.mode}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
                    <Badge on={t.downloadEnabled}>Download</Badge>
                    <Badge on={t.watermarkEnabled}>Watermark</Badge>
                    <Badge on={t.commentsEnabled}>Kommentare</Badge>
                    <Badge on={t.ratingsEnabled}>Ratings</Badge>
                    {t.defaultExpiryDays && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                        {t.defaultExpiryDays} Tage
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
    </main>
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
          ? "bg-green-100 text-green-700"
          : "bg-slate-100 text-slate-400 line-through"
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
      setError(err instanceof Error ? err.message : "Fehler");
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
        className="w-full max-w-sm bg-white rounded-lg p-6 space-y-4"
      >
        <h2 className="text-lg font-semibold">Neues Galerie-Template</h2>
        <input
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="z.B. Hochzeit, Newborn, Portrait"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-3 py-2 rounded-md border border-slate-300 hover:bg-slate-100"
          >
            Abbrechen
          </button>
          <button
            type="submit"
            disabled={pending}
            className="text-sm px-3 py-2 rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {pending ? "Wird erstellt…" : "Erstellen"}
          </button>
        </div>
      </form>
    </div>
  );
}
