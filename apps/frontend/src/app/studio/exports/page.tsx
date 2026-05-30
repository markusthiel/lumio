"use client";

/**
 * Lumio Studio — Datenexport-Seite
 *
 * Zwei Spalten / zwei Sektionen:
 *
 *   1. "Neuen Export starten"
 *      - Komplett-Export (alle Galerien) — ein Button
 *      - Pro-Galerie-Export — Dropdown mit Galerie-Liste + Button
 *
 *   2. Liste laufender + abgeschlossener Exports
 *      Jeder Eintrag zeigt Status + Erstellt-Datum + Click öffnet
 *      Detail-Page mit allen Items + Download-Buttons.
 *
 * Re-Render-Strategie: bei Klick auf "Export erstellen" laden wir die
 * Liste neu und navigieren zur Detail-Page. Auf der Detail-Page
 * polled das UI alle 3 s solange Status != 'ready'.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { api, type Gallery } from "@/lib/api";
import { PageHeader } from "@/components/studio/PageHeader";
import { Button } from "@/components/ui";

interface ExportListItem {
  id: string;
  source: "studio" | "studio_all" | "super_admin";
  status: "pending" | "building" | "ready" | "expired";
  itemCount: number;
  expiresAt: string;
  createdAt: string;
}

const SOURCE_LABEL: Record<string, string> = {
  studio: "Einzelne Galerie",
  studio_all: "Alle Galerien",
  super_admin: "Support-Anforderung",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Wartet",
  building: "Wird erstellt",
  ready: "Fertig",
  expired: "Abgelaufen",
};

export default function ExportsPage() {
  const [exports, setExports] = useState<ExportListItem[]>([]);
  const [galleries, setGalleries] = useState<Gallery[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGalleryId, setSelectedGalleryId] = useState("");
  const [creating, setCreating] = useState<null | "single" | "all">(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [exportRes, galleryRes] = await Promise.all([
        api.listExports(),
        api.listGalleries(),
      ]);
      setExports(exportRes.exports);
      setGalleries(galleryRes.galleries);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-Refresh wenn mindestens ein Export noch laeuft (pending/building).
  // Spaeter, wenn alles 'ready' ist, hoeren wir auf. Spart unnoetige
  // Backend-Calls und ist nett zu User-Akku auf Mobilgeraeten.
  useEffect(() => {
    const hasActive = exports.some(
      (e) => e.status === "pending" || e.status === "building"
    );
    if (!hasActive) return;
    const t = setInterval(() => {
      void load();
    }, 5000);
    return () => clearInterval(t);
  }, [exports, load]);

  async function startGalleryExport() {
    if (!selectedGalleryId) return;
    setCreating("single");
    setError(null);
    try {
      await api.createGalleryExport(selectedGalleryId);
      setSelectedGalleryId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Starten");
    } finally {
      setCreating(null);
    }
  }

  async function startTenantExport() {
    setCreating("all");
    setError(null);
    try {
      await api.createTenantExport();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Starten");
    } finally {
      setCreating(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Datenexport"
        description="Lädt Originaldateien + Metadaten (Tags, Auswahl, Kommentare) als ZIP-Archiv. Pro Galerie ein ZIP. Downloads sind 30 Tage verfügbar."
      />
      <div className="px-6 sm:px-8 lg:px-12 py-6 max-w-5xl">

      {error && (
        <div className="mb-4 rounded-md border border-semantic-danger/30 bg-semantic-danger/8 px-4 py-3 text-ui-sm text-semantic-danger">
          {error}
        </div>
      )}

      {/* Sektion 1: Neuen Export starten */}
      <section className="rounded-md border border-line-subtle bg-surface-raised p-5 mb-6 space-y-5">
        <h2 className="text-ui-md font-medium text-ink-primary">
          Neuen Export starten
        </h2>

        <div className="space-y-2">
          <div className="text-ui-sm text-ink-primary">Einzelne Galerie</div>
          <div className="flex gap-2">
            <select
              value={selectedGalleryId}
              onChange={(e) => setSelectedGalleryId(e.target.value)}
              disabled={creating !== null}
              className="flex-1 h-9 px-2.5 rounded bg-surface-sunken border border-line-subtle hover:border-line-strong focus:border-accent text-ui text-ink-primary focus:outline-none transition-colors duration-motion disabled:opacity-50"
            >
              <option value="">– Galerie wählen –</option>
              {galleries.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
            <Button
              variant="primary"
              size="sm"
              onClick={startGalleryExport}
              disabled={!selectedGalleryId || creating !== null}
            >
              {creating === "single" ? "Starte…" : "Export starten"}
            </Button>
          </div>
        </div>

        <div className="border-t border-line-subtle pt-5 space-y-2">
          <div className="text-ui-sm text-ink-primary">
            Alle Galerien auf einmal
          </div>
          <div className="text-ui-xs text-ink-tertiary mb-2">
            Erstellt für jede Galerie ein eigenes ZIP. Praktisch für regelmäßige
            Sicherungen oder zum Mitnehmen.
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={startTenantExport}
            disabled={creating !== null || galleries.length === 0}
          >
            {creating === "all"
              ? "Starte…"
              : `Alle ${galleries.length} Galerien exportieren`}
          </Button>
        </div>
      </section>

      {/* Sektion 2: Liste der Exports */}
      <section className="rounded-md border border-line-subtle bg-surface-raised p-5">
        <h2 className="text-ui-md font-medium text-ink-primary mb-3">
          Bisherige Exports
        </h2>
        {loading && exports.length === 0 ? (
          <div className="text-ui-sm text-ink-tertiary py-6 text-center">
            Wird geladen…
          </div>
        ) : exports.length === 0 ? (
          <div className="text-ui-sm text-ink-tertiary py-6 text-center">
            Noch keine Exports erstellt.
          </div>
        ) : (
          <ul className="divide-y divide-line-subtle">
            {exports.map((e) => (
              <li key={e.id} className="py-3">
                <Link
                  href={`/studio/exports/${e.id}`}
                  className="flex items-center justify-between gap-3 hover:bg-surface-sunken -mx-2 px-2 py-1 rounded transition-colors duration-motion"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-ui-sm text-ink-primary">
                      {SOURCE_LABEL[e.source] ?? e.source} · {e.itemCount}{" "}
                      {e.itemCount === 1 ? "Galerie" : "Galerien"}
                    </div>
                    <div className="text-ui-xs text-ink-tertiary mt-0.5">
                      {new Date(e.createdAt).toLocaleString("de-DE")}
                      {e.status === "ready" && (
                        <>
                          {" "}
                          · läuft ab am{" "}
                          {new Date(e.expiresAt).toLocaleDateString("de-DE")}
                        </>
                      )}
                    </div>
                  </div>
                  <StatusBadge status={e.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      </div>
    </>
  );
}

function StatusBadge({ status }: { status: ExportListItem["status"] }) {
  const cls =
    status === "ready"
      ? "bg-semantic-success/10 text-semantic-success border-semantic-success/30"
      : status === "expired"
      ? "bg-surface-sunken text-ink-tertiary border-line-subtle"
      : "bg-semantic-warning/10 text-semantic-warning border-semantic-warning/30";
  return (
    <span
      className={`text-ui-xs px-2 py-0.5 rounded-xs border whitespace-nowrap ${cls}`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
