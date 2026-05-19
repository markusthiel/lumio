"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, type BrandingDetail } from "@/lib/api";

export default function BrandingsPage() {
  const router = useRouter();
  const [brandings, setBrandings] = useState<BrandingDetail[]>([]);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    try {
      const res = await api.listBrandings();
      setBrandings(res.brandings);
      setDefaultId(res.defaultBrandingId);
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
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="border-b border-slate-200 pb-4">
          <div className="text-xs">
            <Link href="/studio" className="text-slate-500 hover:text-slate-900">
              ← Studio
            </Link>
          </div>
          <div className="flex items-end justify-between mt-2">
            <div>
              <h1 className="text-2xl font-semibold">Branding</h1>
              <p className="text-sm text-slate-500">
                Logo, Farben und Schrift für deine Kunden-Galerien.
              </p>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="text-sm px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800"
            >
              Neues Profil
            </button>
          </div>
        </header>

        {brandings.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-slate-200 p-12 text-center">
            <div className="text-slate-500 text-sm">
              Noch keine Branding-Profile angelegt.
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-3 text-sm font-medium text-brand-accent hover:underline"
            >
              Erstes Profil erstellen →
            </button>
          </div>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {brandings.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/studio/brandings/${b.id}`}
                  className="block rounded-lg border border-slate-200 bg-white hover:border-slate-400 hover:shadow-sm transition overflow-hidden"
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
                        <span className="text-[10px] font-medium uppercase tracking-wider bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                          Default
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
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
    </main>
  );
}

function ColorSwatch({ color }: { color: string }) {
  return (
    <span
      className="inline-block w-4 h-4 rounded border border-slate-200"
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
        <h2 className="text-lg font-semibold">Neues Branding-Profil</h2>
        <input
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="z.B. Standard, Hochzeit, Newborn"
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
