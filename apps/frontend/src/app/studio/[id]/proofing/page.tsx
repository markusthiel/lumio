"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, type ProofingSummary, type GalleryFile } from "@/lib/api";
import { PageHeader } from "@/components/studio/PageHeader";
import { ProofingFileDetail } from "@/components/studio/ProofingFileDetail";
import { AutoTagsToolbar } from "@/components/studio/AutoTagsToolbar";
import { useT } from "@/lib/i18n";

export default function ProofingPage() {
  const t = useT();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [data, setData] = useState<ProofingSummary | null>(null);
  const [files, setFiles] = useState<GalleryFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailFile, setDetailFile] = useState<GalleryFile | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // Beide parallel: Summary für die Statistik-Karten, gallery
        // detail für die Files-Liste mit Thumbnails.
        const [summary, galleryDetail] = await Promise.all([
          api.getProofingSummary(id),
          api.getGallery(id),
        ]);
        setData(summary);
        setFiles(galleryDetail.gallery.files);
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
      <div className="flex items-center justify-center h-screen text-ui text-ink-tertiary">
        Lädt…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="px-6 sm:px-8 py-6">
        <div className="text-ui text-semantic-danger bg-semantic-danger/10 border border-semantic-danger/30 rounded-sm px-3 py-2 max-w-3xl">
          {error ?? "Galerie nicht gefunden."}
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "Studio", href: "/studio" },
          { label: data.gallery.title, href: `/studio/${data.gallery.id}` },
          { label: "Auswahl-Übersicht" },
        ]}
        title="Auswahl-Übersicht"
        description={data.gallery.title}
      />

      <div className="px-6 sm:px-8 py-6 space-y-6 max-w-6xl">
        {/* KI-Tagging-Toolbar — Re-Tag + Bulk-Accept. Versteckt sich
            kommentarlos wenn das Feature ai_tagging fuer den Tenant aus
            ist. */}
        <AutoTagsToolbar galleryId={id} />

        {/* Files-Grid mit Kunden-Auswahl-Indikatoren. Klick öffnet das
            File-Detail mit Annotation-Editor. */}
        {files.length > 0 && (
          <section>
            <h2 className="text-ui-md font-medium mb-3">
              {t("annotation.studioDetail.imagesCount")} ({files.length})
            </h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
              {files.map((f) => {
                // Aggregierte Customer-Info aus dem Summary (falls vorhanden)
                const fileStats = data.files.find((s) => s.fileId === f.id);
                const hasLike = fileStats?.liked;
                const colorTag = fileStats?.label;
                return (
                  <button
                    key={f.id}
                    onClick={() => setDetailFile(f)}
                    className="relative aspect-square rounded overflow-hidden bg-surface-sunken border border-line-subtle hover:border-accent transition-colors duration-motion group"
                    title={f.originalFilename}
                    style={{
                      // Offscreen-Tiles skipt der Browser komplett —
                      // hilft enorm bei 500+ Bildern in der Übersicht.
                      contentVisibility: "auto",
                      containIntrinsicSize: "120px 120px",
                    }}
                  >
                    {f.thumbUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={f.thumbUrl}
                        alt={f.originalFilename}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full" />
                    )}
                    {/* Customer-Auswahl-Indikatoren oben rechts */}
                    <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
                      {colorTag && (
                        <span
                          className={`w-3 h-3 rounded-full border border-white/40 ${colorBg(colorTag)}`}
                          aria-label={`Farbe: ${colorTag}`}
                        />
                      )}
                      {hasLike && (
                        <span
                          className="w-4 h-4 rounded-full bg-amber-400 text-neutral-900 text-[10px] inline-flex items-center justify-center"
                          aria-label="In Auswahl"
                        >
                          ★
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

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
          <section className="rounded-md border border-line-subtle bg-surface-raised p-4">
            <h2 className="text-ui-md font-medium mb-3">Farb-Tags</h2>
            <div className="flex flex-wrap gap-3">
              {Object.entries(data.totals.byLabel).map(([label, count]) => (
                <div
                  key={label}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-sunken border border-line-subtle"
                >
                  <span
                    className={`w-3 h-3 rounded-full ${colorBg(label)}`}
                  />
                  <span className="text-sm">{label}</span>
                  <span className="text-xs text-ink-tertiary">{count}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Pro Access */}
        {data.perAccess.length > 0 && (
          <section className="rounded-lg border border-line-subtle bg-surface-raised">
            <h2 className="text-sm font-medium px-4 py-3 border-b border-line-subtle">
              Beteiligung pro Share-Link
            </h2>
            <table className="w-full text-sm">
              <thead className="bg-surface-sunken text-xs text-ink-tertiary">
                <tr>
                  <th className="text-left px-4 py-2">Bezeichnung</th>
                  <th className="text-right px-4 py-2">Picks/Likes</th>
                  <th className="text-right px-4 py-2">Likes</th>
                  <th className="text-right px-4 py-2">Kommentare</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
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
        <section className="rounded-lg border border-line-subtle bg-surface-raised p-4">
          <h2 className="text-sm font-medium mb-1">Exporte</h2>
          <p className="text-xs text-ink-tertiary mb-3">
            CSV für Tabellenkalkulation, XMP-Sidecars für Lightroom Classic
            oder Capture One. Lege die XMPs neben deine Original-RAWs, dann
            in Lightroom <em>Metadaten → Aus Datei lesen</em>.
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={api.csvExportUrl(data.gallery.id)}
              className="text-sm px-3 py-1.5 rounded bg-accent text-accent-contrast hover:bg-accent-hover"
              download
            >
              CSV herunterladen
            </a>
            <a
              href={api.xmpExportUrl(data.gallery.id)}
              className="text-sm px-3 py-1.5 rounded bg-accent text-accent-contrast hover:bg-accent-hover"
              download
            >
              XMP-Sidecars (ZIP)
            </a>
          </div>
          <div className="text-xs text-ink-tertiary mt-3 leading-relaxed">
            <strong>Hinweis zu Farb-Tags:</strong> Lightroom erkennt
            Farb-Labels anhand des aktiven Label-Sets. Stelle in Lightroom
            unter <em>Metadaten → Farbbeschriftungs-Sets</em> auf
            „Lightroom-Standard" (englisch) — Lumio schreibt „Red"/„Yellow"/
            „Green". Bei deutschem Label-Set („Rot"/„Gelb"/„Grün") werden
            die Sterne erkannt, die Farben nicht.
          </div>
        </section>

        {/* Files-Liste */}
        <section className="rounded-lg border border-line-subtle bg-surface-raised">
          <h2 className="text-sm font-medium px-4 py-3 border-b border-line-subtle">
            Dateien
            {data.fileCountTotal > data.files.length && (
              <span className="text-xs text-ink-tertiary font-normal ml-2">
                — zeigt {data.files.length} von {data.fileCountTotal}
              </span>
            )}
          </h2>
          <table className="w-full text-sm">
            <thead className="bg-surface-sunken text-xs text-ink-tertiary">
              <tr>
                <th className="text-left px-4 py-2">Datei</th>
                <th className="text-center px-4 py-2">Rating</th>
                <th className="text-center px-4 py-2">Label</th>
                <th className="text-center px-4 py-2">Liked</th>
                <th className="text-left px-4 py-2">Teams</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
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
                      <span className="text-amber-400">★</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-tertiary">
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
                    className="px-4 py-6 text-center text-sm text-ink-tertiary"
                  >
                    Noch keine Auswahl von Kunden.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>

      {/* File-Detail-Modal als Fullscreen-Overlay */}
      {detailFile && (
        <ProofingFileDetail
          galleryId={id}
          file={detailFile}
          onClose={() => setDetailFile(null)}
        />
      )}
    </>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line-subtle bg-surface-raised p-4">
      <div className="text-xs text-ink-tertiary uppercase tracking-wider">
        {label}
      </div>
      <div className="text-3xl font-semibold mt-1">{value}</div>
    </div>
  );
}

function colorBg(label: string): string {
  switch (label.toLowerCase()) {
    case "red":
      return "bg-semantic-danger/100";
    case "yellow":
      return "bg-yellow-500";
    case "green":
      return "bg-semantic-success/100";
    default:
      return "bg-ink-tertiary";
  }
}
