"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, type ApiUser, type Gallery } from "@/lib/api";
import { useT } from "@/lib/i18n";

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

  async function handleLogout() {
    await api.logout();
    router.push("/login");
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-slate-500">Lädt…</div>
      </main>
    );
  }
  if (!user) return null;

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex items-center justify-between border-b border-slate-200 pb-4">
          <div>
            <div className="text-xs font-medium text-brand-accent uppercase tracking-wider">
              Lumio · Studio
            </div>
            <h1 className="text-2xl font-semibold">
              {user.name ?? user.email}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreate(true)}
              className="text-sm px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800 transition"
            >
              {t("studio.newGallery")}
            </button>
            <Link
              href="/studio/settings"
              className="text-sm px-3 py-1.5 rounded-md border border-slate-300 hover:bg-slate-100 transition"
            >
              {t("nav.settings")}
            </Link>
            <button
              onClick={handleLogout}
              className="text-sm px-3 py-1.5 rounded-md border border-slate-300 hover:bg-slate-100 transition"
            >
              {t("nav.logout")}
            </button>
          </div>
        </header>

        {galleries.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-slate-200 p-12 text-center">
            <div className="text-slate-500 text-sm">
              {t("studio.noGalleries")}
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-3 text-sm font-medium text-brand-accent hover:underline"
            >
              {t("studio.firstGallery")}
            </button>
          </div>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {galleries.map((g) => (
              <li key={g.id}>
                <Link
                  href={`/studio/${g.id}`}
                  className="block rounded-lg border border-slate-200 bg-white hover:border-slate-400 hover:shadow-sm transition p-5"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="font-medium truncate">{g.title}</h2>
                    <StatusBadge status={g.status} />
                  </div>
                  {g.description && (
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                      {g.description}
                    </p>
                  )}
                  <div className="text-xs text-slate-400 mt-3 flex items-center gap-3">
                    <span>{g.fileCount ?? 0} Files</span>
                    <span>·</span>
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
    </main>
  );
}

function StatusBadge({ status }: { status: Gallery["status"] }) {
  const styles: Record<Gallery["status"], string> = {
    draft: "bg-slate-100 text-slate-600",
    live: "bg-green-100 text-green-700",
    archived: "bg-amber-100 text-amber-700",
  };
  return (
    <span
      className={`text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded ${styles[status]}`}
    >
      {status}
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
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<"collaboration" | "presentation">(
    "collaboration"
  );
  const [downloadEnabled, setDownloadEnabled] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
        className="w-full max-w-md bg-white rounded-lg p-6 space-y-4"
      >
        <h2 className="text-lg font-semibold">Neue Galerie</h2>

        <div className="space-y-1">
          <label htmlFor="title" className="text-sm font-medium">
            Titel
          </label>
          <input
            id="title"
            required
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent"
            placeholder="z.B. Hochzeit Müller-Schmidt 2026"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="desc" className="text-sm font-medium">
            Beschreibung <span className="text-slate-400">(optional)</span>
          </label>
          <textarea
            id="desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="mode" className="text-sm font-medium">
            Modus
          </label>
          <select
            id="mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-accent"
          >
            <option value="collaboration">
              Collaboration (Auswahl, Kommentare)
            </option>
            <option value="presentation">Presentation (nur Anzeige)</option>
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={downloadEnabled}
            onChange={(e) => setDownloadEnabled(e.target.checked)}
            className="rounded border-slate-300"
          />
          Download für Kunden erlauben
        </label>

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
