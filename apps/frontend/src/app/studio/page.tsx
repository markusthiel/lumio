"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type ApiUser } from "@/lib/api";

export default function StudioPage() {
  const router = useRouter();
  const [user, setUser] = useState<ApiUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then(({ user }) => setUser(user))
      .catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
  }, [router]);

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
              Hallo {user.name ?? user.email}
            </h1>
          </div>
          <button
            onClick={handleLogout}
            className="text-sm px-3 py-1.5 rounded-md border border-slate-300 hover:bg-slate-100 transition"
          >
            Logout
          </button>
        </header>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-lg border border-slate-200 p-5 bg-white">
            <div className="text-xs text-slate-500 uppercase tracking-wider">
              Galerien
            </div>
            <div className="text-3xl font-semibold mt-1">0</div>
            <div className="text-xs text-slate-400 mt-1">
              Upload-UI kommt im nächsten Sprint
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 p-5 bg-white">
            <div className="text-xs text-slate-500 uppercase tracking-wider">
              Rolle
            </div>
            <div className="text-3xl font-semibold mt-1 capitalize">
              {user.role}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 p-5 bg-white">
            <div className="text-xs text-slate-500 uppercase tracking-wider">
              2FA
            </div>
            <div className="text-3xl font-semibold mt-1">
              {user.totpEnabled ? "An" : "Aus"}
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 p-5 bg-slate-50">
          <h2 className="text-sm font-medium mb-2">Auth-Status</h2>
          <pre className="text-xs text-slate-600 overflow-x-auto">
            {JSON.stringify(user, null, 2)}
          </pre>
        </section>
      </div>
    </main>
  );
}
