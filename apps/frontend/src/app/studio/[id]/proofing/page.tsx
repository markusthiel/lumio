"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, type ProofingSummary } from "@/lib/api";

export default function ProofingPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [data, setData] = useState<ProofingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.getProofingSummary(id);
        setData(res);
      } catch (err) {
        if (err instanceof Error && err.message.includes("401")) {
          router.replace("/login");
          return;
        }
        setError(err instanceof Error ? err.message : "Fehler");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, router]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-slate-500">Lädt…</div>
      </main>
    );
  }
  if (error || !data) {
    return (
      <main className="min-h-screen p-8">
        <div className="max-w-3xl mx-auto">
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error ?? "Galerie nicht gefunden."}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="border-b border-slate-200 pb-4">
          <div className="text-xs">
            <Link
              href={`/studio/${data.gallery.id}`}
              className="text-slate-500 hover:text-slate-900"
            >
              ← Galerie
            </Link>
          </div>
          <h1 className="text-2xl font-semibold mt-2">
            Auswahl-Übersicht
          </h1>
          <p className="text-sm text-slate-500">
            {data.gallery.title}
          </p>
        </header>

        {/* Top-Stats */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Dateien" value={data.totals.fileCount} />
          <StatCard label="Mit Like" value={data.totals.withLike} />
          <StatCard label="Mit Rating" value={data.totals.withRating} />
          <StatCard
            label="Farb-Tags gesamt"
            value={Object.values(data.totals.byLabel).reduce(
              (sum, n) => sum + n,
              0
            )}
          />
        </section>

        {/* Label-Verteilung */}
        {Object.keys(data.totals.byLabel).length > 0 && (
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-medium mb-3">Farb-Tags</h2>
            <div className="flex flex-wrap gap-3">
              {Object.entries(data.totals.byLabel).map(([label, count]) => (
                <div
                  key={label}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200"
                >
                  <span
                    className={`w-3 h-3 rounded-full ${colorBg(label)}`}
                  />
                  <span className="text-sm">{label}</span>
                  <span className="text-xs text-slate-500">{count}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Pro Access */}
        {data.perAccess.length > 0 && (
          <section className="rounded-lg border border-slate-200 bg-white">
            <h2 className="text-sm font-medium px-4 py-3 border-b border-slate-100">
              Beteiligung pro Share-Link
            </h2>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="text-left px-4 py-2">Bezeichnung</th>
                  <th className="text-right px-4 py-2">Picks/Likes</th>
                  <th className="text-right px-4 py-2">Likes</th>
                  <th className="text-right px-4 py-2">Kommentare</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.perAccess.map((a) => (
                  <tr key={a.label}>
                    <td className="px-4 py-2">{a.label}</td>
                    <td className="text-right px-4 py-2">{a.picks}</td>
                    <td className="text-right px-4 py-2">{a.likes}</td>
                    <td className="text-right px-4 py-2">{a.comments}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* Export-Aktionen */}
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-medium mb-1">Exporte</h2>
          <p className="text-xs text-slate-500 mb-3">
            CSV für Tabellenkalkulation, XMP-Sidecars für Lightroom Classic
            oder Capture One. Lege die XMPs neben deine Original-RAWs, dann
            in Lightroom <em>Metadaten → Aus Datei lesen</em>.
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={api.csvExportUrl(data.gallery.id)}
              className="text-sm px-3 py-1.5 rounded bg-slate-900 text-white hover:bg-slate-800"
              download
            >
              CSV herunterladen
            </a>
            <a
              href={api.xmpExportUrl(data.gallery.id)}
              className="text-sm px-3 py-1.5 rounded bg-slate-900 text-white hover:bg-slate-800"
              download
            >
              XMP-Sidecars (ZIP)
            </a>
          </div>
          <div className="text-xs text-slate-500 mt-3 leading-relaxed">
            <strong>Hinweis zu Farb-Tags:</strong> Lightroom erkennt
            Farb-Labels anhand des aktiven Label-Sets. Stelle in Lightroom
            unter <em>Metadaten → Farbbeschriftungs-Sets</em> auf
            „Lightroom-Standard" (englisch) — Lumio schreibt „Red"/„Yellow"/
            „Green". Bei deutschem Label-Set („Rot"/„Gelb"/„Grün") werden
            die Sterne erkannt, die Farben nicht.
          </div>
        </section>

        {/* Files-Liste */}
        <section className="rounded-lg border border-slate-200 bg-white">
          <h2 className="text-sm font-medium px-4 py-3 border-b border-slate-100">
            Dateien
            {data.fileCountTotal > data.files.length && (
              <span className="text-xs text-slate-500 font-normal ml-2">
                — zeigt {data.files.length} von {data.fileCountTotal}
              </span>
            )}
          </h2>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="text-left px-4 py-2">Datei</th>
                <th className="text-center px-4 py-2">Rating</th>
                <th className="text-center px-4 py-2">Label</th>
                <th className="text-center px-4 py-2">Liked</th>
                <th className="text-left px-4 py-2">Teams</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.files.map((f) => (
                <tr key={f.fileId}>
                  <td className="px-4 py-2 font-mono text-xs">{f.filename}</td>
                  <td className="text-center px-4 py-2">
                    {f.rating !== null ? "★".repeat(f.rating) : "—"}
                  </td>
                  <td className="text-center px-4 py-2">
                    {f.label ? (
                      <span
                        className={`inline-block w-4 h-4 rounded-full ${colorBg(
                          f.label
                        )}`}
                        title={f.label}
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="text-center px-4 py-2">
                    {f.liked ? (
                      <span className="text-red-500">♥</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500">
                    {f.perAccess.length === 0
                      ? "—"
                      : f.perAccess.map((a) => a.accessLabel).join(", ")}
                  </td>
                </tr>
              ))}
              {data.files.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-6 text-center text-sm text-slate-500"
                  >
                    Noch keine Auswahl von Kunden.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500 uppercase tracking-wider">
        {label}
      </div>
      <div className="text-3xl font-semibold mt-1">{value}</div>
    </div>
  );
}

function colorBg(label: string): string {
  switch (label.toLowerCase()) {
    case "red":
      return "bg-red-500";
    case "yellow":
      return "bg-yellow-500";
    case "green":
      return "bg-green-500";
    default:
      return "bg-slate-400";
  }
}
