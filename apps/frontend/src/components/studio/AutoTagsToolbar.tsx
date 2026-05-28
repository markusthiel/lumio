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
import Link from "next/link";
import { api } from "@/lib/api";

export function AutoTagsToolbar({ galleryId }: { galleryId: string }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<"re-tag" | "bulk" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Threshold wird in localStorage persistiert (global, nicht pro Galerie —
  // der User entwickelt eine Praeferenz die fuer alle Galerien gilt).
  // Default 0.7 wenn noch nichts gesetzt.
  const [threshold, setThreshold] = useState(0.7);
  const [stats, setStats] = useState<{
    fileCount: number;
    taggedFiles: number;
    pendingSuggestions: number;
    accepted: number;
    rejected: number;
    lastTaggedAt: string | null;
  } | null>(null);

  // Threshold aus localStorage initial laden (nur client-side, daher
  // useEffect statt useState-initializer — sonst SSR-Hydration-Konflikt).
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("lumio.autotag.threshold");
      if (stored) {
        const v = parseFloat(stored);
        if (!isNaN(v) && v >= 0.05 && v <= 0.95) {
          setThreshold(v);
        }
      }
    } catch {
      // localStorage kann blockiert sein (private-mode / cookie-restrictions)
    }
  }, []);

  // Bei jedem Threshold-Change in localStorage schreiben
  function updateThreshold(v: number) {
    setThreshold(v);
    try {
      window.localStorage.setItem("lumio.autotag.threshold", String(v));
    } catch {
      // siehe oben
    }
  }

  async function refreshStats() {
    try {
      const r = await api.getGalleryAutoTagStats(galleryId);
      setStats(r);
    } catch {
      setStats(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    // Probe via dedizierten Status-Endpoint. Liefert 200 wenn Feature
    // aktiv, 404 sonst. Idempotent — keine Seiteneffekte.
    (async () => {
      try {
        await api.getAutoTagStatus();
        if (!cancelled) {
          setAvailable(true);
          await refreshStats();
        }
      } catch {
        if (!cancelled) setAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // Stats nach kurzem Delay neu laden — die ersten Tasks sollten
      // schnell durch sein wenn der Worker laeuft.
      setTimeout(() => void refreshStats(), 5000);
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
      await refreshStats();
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
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-ui-sm font-semibold">KI-Auto-Tagging</h2>
        <button
          type="button"
          onClick={() => void refreshStats()}
          className="text-xs text-ink-tertiary hover:text-ink-secondary"
          title="Status aktualisieren"
        >
          ↻ Status
        </button>
      </div>

      {stats && (
        <dl className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3 text-xs">
          <Stat label="Dateien" value={stats.fileCount} />
          <Stat
            label="Mit Tags"
            value={stats.taggedFiles}
            subtitle={
              stats.fileCount > 0
                ? `${Math.round((stats.taggedFiles / stats.fileCount) * 100)}%`
                : undefined
            }
          />
          <Stat label="Offene Vorschläge" value={stats.pendingSuggestions} highlight={stats.pendingSuggestions > 0} />
          <Stat label="Übernommen" value={stats.accepted} />
          <Stat label="Verworfen" value={stats.rejected} />
        </dl>
      )}

      <div className="flex flex-wrap gap-3 items-end">
        <button
          type="button"
          onClick={onReTag}
          disabled={!!busy}
          className="px-3 py-1.5 text-sm rounded bg-surface-sunken border border-line-subtle hover:bg-accent/8 disabled:opacity-50"
        >
          {busy === "re-tag" ? "Wird eingereiht…" : "Galerie neu taggen"}
        </button>

        {stats && stats.pendingSuggestions > 0 && (
          <Link
            href={`/studio/${galleryId}/auto-tags`}
            className="px-3 py-1.5 text-sm rounded bg-accent/15 border border-accent/40 text-accent hover:bg-accent/25 font-medium"
          >
            {stats.pendingSuggestions} Vorschläge ansehen →
          </Link>
        )}

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
            onChange={(e) => updateThreshold(parseFloat(e.target.value))}
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
        {stats?.lastTaggedAt && (
          <>
            {" · Letztes Tagging: "}
            {new Date(stats.lastTaggedAt).toLocaleString("de-DE")}
          </>
        )}
      </p>
    </section>
  );
}

function Stat({
  label,
  value,
  subtitle,
  highlight,
}: {
  label: string;
  value: number;
  subtitle?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        highlight
          ? "rounded border border-accent/30 bg-accent/8 px-2 py-1.5"
          : "rounded border border-line-subtle bg-surface-sunken px-2 py-1.5"
      }
    >
      <div className="text-ui-xs text-ink-tertiary">{label}</div>
      <div className="text-sm font-semibold tabular-nums">
        {value.toLocaleString("de-DE")}
        {subtitle && (
          <span className="ml-1 text-xs text-ink-tertiary font-normal">
            {subtitle}
          </span>
        )}
      </div>
    </div>
  );
}
