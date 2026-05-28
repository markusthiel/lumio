"use client";

/**
 * AutoTagsToolbar — Galerie-Level Aktionen fuer KI-Auto-Tagging
 *
 * Zwei Aktionen:
 *   1. Neu taggen — enqueued den Auto-Tag-Job fuer ALLE Files der
 *      Galerie. Sinnvoll wenn:
 *        - Tenant das Feature spaeter aktiviert hat → bestehende Files
 *          haben noch keine Tags
 *        - CLIP wurde nachgeruestet → neue semantic Tags moeglich
 *        - Vokabular wurde erweitert
 *
 *   2. Vorschlaege übernehmen — Bulk-Accept aller suggested AutoTags
 *      ueber einem Confidence-Threshold. Vermeidet manuelles
 *      Pro-File-Klicken.
 *
 * Selbst-versteckend: bei 404 (Feature aus) keine Anzeige. Wir probe
 * das via einem Dummy-Call (bulkAccept mit min=2.0 → akzeptiert nichts,
 * aber der 404-vs-200 verraet ob das Feature aktiv ist).
 *
 * Alternativ koennten wir einen dedizierten Healthcheck-Endpoint
 * machen — aber probe via existing endpoint ist weniger Code.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export function AutoTagsToolbar({ galleryId }: { galleryId: string }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<"re-tag" | "bulk" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(0.7);

  useEffect(() => {
    let cancelled = false;
    // Probe: rufe re-tag mit einem nicht-existierenden Tag-Filter (geht
    // nicht direkt, also nutzen wir bulk-accept mit Threshold > 1 → safe,
    // accepted=0 erwartet). 404 wenn Feature aus.
    (async () => {
      try {
        await api.bulkAcceptAutoTags(galleryId, 2);
        if (!cancelled) setAvailable(true);
      } catch {
        if (!cancelled) setAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [galleryId]);

  if (!available) return null;

  async function onReTag() {
    setBusy("re-tag");
    setMessage(null);
    try {
      const r = await api.reTagGallery(galleryId);
      setMessage(
        `${r.enqueuedFiles} Datei${r.enqueuedFiles === 1 ? "" : "en"} zur Re-Analyse eingereiht. ` +
          `Vorschlaege erscheinen in ca. 1-2 Minuten.`
      );
    } catch (err) {
      setMessage(
        "Fehler: " + (err instanceof Error ? err.message : "unbekannt")
      );
    } finally {
      setBusy(null);
    }
  }

  async function onBulkAccept() {
    setBusy("bulk");
    setMessage(null);
    try {
      const r = await api.bulkAcceptAutoTags(galleryId, threshold);
      setMessage(
        r.accepted === 0
          ? "Keine Vorschlaege über dem Threshold gefunden."
          : `${r.accepted} Vorschlag${r.accepted === 1 ? "" : "e"} ` +
            `mit Confidence >= ${Math.round(threshold * 100)}% übernommen.`
      );
    } catch (err) {
      setMessage(
        "Fehler: " + (err instanceof Error ? err.message : "unbekannt")
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-md border border-line-subtle bg-surface-raised p-4">
      <h2 className="text-ui-sm font-semibold mb-3">KI-Auto-Tagging</h2>

      <div className="flex flex-wrap gap-3 items-end">
        <button
          type="button"
          onClick={onReTag}
          disabled={!!busy}
          className="px-3 py-1.5 text-sm rounded bg-surface-sunken border border-line-subtle hover:bg-accent/8 disabled:opacity-50"
        >
          {busy === "re-tag" ? "Wird eingereiht…" : "Galerie neu taggen"}
        </button>

        <div className="flex items-center gap-2">
          <label className="text-xs text-ink-tertiary">
            Confidence-Schwelle
          </label>
          <input
            type="range"
            min="0.1"
            max="0.95"
            step="0.05"
            value={threshold}
            onChange={(e) => setThreshold(parseFloat(e.target.value))}
            disabled={busy === "bulk"}
            className="w-32"
          />
          <span className="text-xs tabular-nums w-10 text-right">
            {Math.round(threshold * 100)}%
          </span>
          <button
            type="button"
            onClick={onBulkAccept}
            disabled={!!busy}
            className="px-3 py-1.5 text-sm rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {busy === "bulk"
              ? "Übernehme…"
              : "Vorschläge übernehmen"}
          </button>
        </div>
      </div>

      {message && (
        <p className="mt-2 text-xs text-ink-secondary">{message}</p>
      )}

      <p className="mt-2 text-xs text-ink-tertiary">
        Tipp: Niedrigere Schwelle = mehr Tags, weniger Präzision. Für
        Heuristik-Tags (Hochformat, Hell, …) reichen 70%, für KI-Modell-Tags
        (Brautpaar, Kuss, …) eher 20-30%.
      </p>
    </section>
  );
}
