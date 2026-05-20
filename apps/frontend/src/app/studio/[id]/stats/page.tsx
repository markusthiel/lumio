"use client";

/**
 * Studio /studio/[id]/stats
 *
 * Vier Sektionen:
 *   1) Visits-Sparkline (letzte 30 Tage) + Anonym-Block + Pro-Access-Tabelle
 *   2) Top-Files nach Likes
 *   3) Downloads über Zeit + Aufschlüsselung nach Typ
 *
 * Visualisierung bewusst minimal: SVG-Sparklines statt Chart-Library.
 * Wir laden recharts nicht, das wäre für vier kleine Sparklines viel
 * Bundle für wenig. Wenn das Tooling später wächst (Heatmaps, Filter-
 * Picker, etc.), kann eine Library nachgezogen werden — die jetzige
 * Sparkline-Komponente ist ~30 Zeilen und tut für „Trend erkennen"
 * völlig.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, type GalleryStats } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { PageHeader } from "@/components/studio/PageHeader";

export default function StatsPage() {
  const params = useParams<{ id: string }>();
  const t = useT();
  const [stats, setStats] = useState<GalleryStats | null>(null);
  const [galleryTitle, setGalleryTitle] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Galerie-Titel für den Breadcrumb (eigener Call, weil
        // /stats nur Stats liefert). Beide parallel.
        const [statsRes, galleryRes] = await Promise.all([
          api.getGalleryStats(params.id),
          api.getGallery(params.id),
        ]);
        if (cancelled) return;
        setStats(statsRes);
        setGalleryTitle(galleryRes.gallery.title);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t("studio.statsError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id, t]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-ui text-ink-tertiary">
        {t("common.loading")}
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="px-6 sm:px-8 py-6">
        <div className="text-ui text-semantic-danger bg-semantic-danger/10 border border-semantic-danger/30 rounded-sm px-3 py-2 max-w-3xl">
          {error ?? t("studio.statsNotFound")}
        </div>
      </div>
    );
  }

  // Visits-Werte für das Chart vorbereiten — wir wollen Lücken
  // (Tage ohne Visit) als 0 zeigen, sonst springt der Chart zwischen
  // den Punkten. Wir bauen einen Tages-Index der letzten 30 Tage und
  // mappen die Daten rein.
  const days30 = buildLastNDays(30);
  const visitsMap = new Map(stats.dailyVisits.map((v) => [v.day.slice(0, 10), v.count]));
  const downloadsMap = new Map(
    stats.dailyDownloads.map((v) => [v.day.slice(0, 10), v.count])
  );
  const visitsSeries = days30.map((d) => visitsMap.get(d) ?? 0);
  const downloadsSeries = days30.map((d) => downloadsMap.get(d) ?? 0);

  const totalVisits = visitsSeries.reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "Studio", href: "/studio" },
          { label: galleryTitle, href: `/studio/${params.id}` },
          { label: t("studio.statsTitle") },
        ]}
        title={t("studio.statsTitle")}
        description={t("studio.statsDescription")}
      />

      <div className="px-6 sm:px-8 py-6 max-w-6xl space-y-6">
        {/* === Sektion 1: Visits === */}
        <section className="rounded-md border border-line-subtle bg-surface-raised p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-ui-md font-medium text-ink-primary">
              {t("studio.statsVisits")}
            </h2>
            <div className="text-ui-xs text-ink-tertiary uppercase tracking-[0.12em]">
              {t("studio.statsLast30Days")}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-5 items-end mb-5">
            <div>
              <Sparkline
                values={visitsSeries}
                labels={days30}
                accent="rgb(var(--accent))"
              />
            </div>
            <div className="text-right">
              <div className="text-display-sm font-medium text-ink-primary">
                {totalVisits}
              </div>
              <div className="text-ui-xs text-ink-tertiary uppercase tracking-[0.12em]">
                {t("studio.statsVisitsTotal")}
              </div>
            </div>
          </div>

          {/* Pro-Access-Tabelle */}
          {stats.accessStats.length === 0 && stats.anonymousVisits === 0 ? (
            <div className="text-ui-sm text-ink-tertiary py-4">
              {t("studio.statsNoVisitsYet")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-ui-sm">
                <thead>
                  <tr className="text-left text-ui-xs uppercase tracking-[0.12em] text-ink-tertiary border-b border-line-subtle">
                    <th className="font-medium py-2 pr-4">{t("studio.statsAccessLabel")}</th>
                    <th className="font-medium py-2 px-3 text-right">{t("studio.statsAccessVisits")}</th>
                    <th className="font-medium py-2 px-3 text-right">{t("studio.statsAccessLikes")}</th>
                    <th className="font-medium py-2 px-3 text-right">{t("studio.statsAccessComments")}</th>
                    <th className="font-medium py-2 pl-3 text-right">{t("studio.statsAccessFinalized")}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.accessStats.map((a) => (
                    <tr key={a.accessId} className="border-b border-line-subtle/50">
                      <td className="py-2 pr-4 text-ink-primary">{a.label}</td>
                      <td className="py-2 px-3 text-right font-mono text-ink-secondary">{a.visits}</td>
                      <td className="py-2 px-3 text-right font-mono text-ink-secondary">{a.likes}</td>
                      <td className="py-2 px-3 text-right font-mono text-ink-secondary">{a.comments}</td>
                      <td className="py-2 pl-3 text-right">
                        {a.finalized ? (
                          <span className="text-semantic-success text-ui-xs">✓</span>
                        ) : (
                          <span className="text-ink-tertiary text-ui-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {stats.anonymousVisits > 0 && (
                    <tr>
                      <td className="py-2 pr-4 text-ink-tertiary italic">
                        {t("studio.statsAnonymous")}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-ink-tertiary">
                        {stats.anonymousVisits}
                      </td>
                      <td className="py-2 px-3 text-right text-ink-tertiary">—</td>
                      <td className="py-2 px-3 text-right text-ink-tertiary">—</td>
                      <td className="py-2 pl-3 text-right text-ink-tertiary">—</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* === Sektion 2: Top-Files === */}
        <section className="rounded-md border border-line-subtle bg-surface-raised p-5">
          <h2 className="text-ui-md font-medium text-ink-primary mb-4">
            {t("studio.statsTopFiles")}
          </h2>
          {stats.topLikedFiles.length === 0 ? (
            <div className="text-ui-sm text-ink-tertiary py-4">
              {t("studio.statsNoLikesYet")}
            </div>
          ) : (
            <ol className="space-y-1.5">
              {stats.topLikedFiles.map((f, i) => (
                <li
                  key={f.fileId}
                  className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 px-2 py-1.5 rounded hover:bg-surface-sunken"
                >
                  <span className="text-ui-xs text-ink-tertiary font-mono w-6 text-right">
                    {i + 1}
                  </span>
                  <span className="text-ui text-ink-primary truncate">
                    {f.filename}
                  </span>
                  {(f.kind === "raw" || f.kind === "heic") && (
                    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded-xs bg-surface-sunken text-ink-tertiary">
                      {f.kind === "raw" ? "RAW" : "HEIC"}
                    </span>
                  )}
                  <span className="text-ui-sm font-mono text-ink-secondary tabular-nums">
                    ♥ {f.likes}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* === Sektion 3: Downloads === */}
        <section className="rounded-md border border-line-subtle bg-surface-raised p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-ui-md font-medium text-ink-primary">
              {t("studio.statsDownloads")}
            </h2>
            <div className="text-ui-xs text-ink-tertiary uppercase tracking-[0.12em]">
              {t("studio.statsLast30Days")}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-5 items-end mb-5">
            <div>
              <Sparkline
                values={downloadsSeries}
                labels={days30}
                accent="rgb(var(--semantic-success))"
              />
            </div>
            <div className="text-right">
              <div className="text-display-sm font-medium text-ink-primary">
                {stats.downloadsTotal}
              </div>
              <div className="text-ui-xs text-ink-tertiary uppercase tracking-[0.12em]">
                {t("studio.statsDownloadsTotal")}
              </div>
            </div>
          </div>

          {stats.downloadsByKind.length > 0 && (
            <div className="flex flex-wrap gap-3 text-ui-sm">
              {stats.downloadsByKind.map((d) => (
                <div
                  key={d.kind}
                  className="px-3 py-1.5 rounded bg-surface-sunken border border-line-subtle"
                >
                  <span className="text-ink-tertiary uppercase text-ui-xs tracking-[0.12em] mr-2">
                    {d.kind === "zip"
                      ? "ZIP"
                      : d.kind === "single"
                      ? t("studio.statsDownloadSingle")
                      : d.kind === "rendition"
                      ? t("studio.statsDownloadRendition")
                      : d.kind}
                  </span>
                  <span className="font-mono text-ink-primary">{d.count}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="text-ui-xs text-ink-tertiary">
          <Link
            href={`/studio/${params.id}`}
            className="hover:text-ink-primary transition-colors duration-motion"
          >
            ← {t("studio.statsBackToGallery")}
          </Link>
        </div>
      </div>
    </>
  );
}

// -----------------------------------------------------------------------------
// Sparkline — kleines SVG-Linien-Chart ohne externe Library.
// values: numerische Reihe; labels: Tagesschlüssel für Tooltip (YYYY-MM-DD).
// -----------------------------------------------------------------------------
function Sparkline({
  values,
  labels,
  accent,
}: {
  values: number[];
  labels: string[];
  accent: string;
}) {
  const W = 600;
  const H = 64;
  const padding = 4;
  const max = Math.max(1, ...values);
  // X-Koordinaten gleichmäßig verteilt; Y invertiert weil SVG-Koords
  // top-down sind.
  const points = values.map((v, i) => {
    const x = padding + ((W - 2 * padding) * i) / Math.max(1, values.length - 1);
    const y = H - padding - ((H - 2 * padding) * v) / max;
    return { x, y, v, label: labels[i] };
  });
  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");

  // Fläche unter der Kurve mit halbtransparentem Akzent — gibt der
  // Sparkline mehr Präsenz als nur eine Linie.
  const areaPath = `M${padding},${H - padding} L${points
    .map((p) => `${p.x},${p.y}`)
    .join(" L")} L${W - padding},${H - padding} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-16"
      preserveAspectRatio="none"
      aria-hidden
    >
      <path d={areaPath} fill={accent} fillOpacity="0.12" />
      <polyline
        points={polyline}
        fill="none"
        stroke={accent}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Achs-Linie unten, dezent */}
      <line
        x1={padding}
        x2={W - padding}
        y1={H - padding}
        y2={H - padding}
        stroke="rgb(var(--line-subtle))"
        strokeWidth="1"
      />
    </svg>
  );
}

function buildLastNDays(n: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
    // YYYY-MM-DD ohne Zeitzone-Kuriositäten: ISO-Datum aus UTC
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
