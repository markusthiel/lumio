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
import { useT } from "@/lib/i18n";

export function AutoTagsToolbar({ galleryId }: { galleryId: string }) {
  const t = useT();
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
        t("autoTags.reTagQueued", { n: r.enqueuedFiles, fileWord: t(r.enqueuedFiles === 1 ? "autoTags.file" : "autoTags.files") })
      );
      // Stats nach kurzem Delay neu laden — die ersten Tasks sollten
      // schnell durch sein wenn der Worker laeuft.
      setTimeout(() => void refreshStats(), 5000);
    } catch (err) {
      setMessage(
        t("autoTags.errorPrefix") + (err instanceof Error ? err.message : t("autoTags.unknown"))
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
          ? t("autoTags.noneAboveThreshold")
          : t("autoTags.bulkAccepted", { n: r.accepted, word: t(r.accepted === 1 ? "autoTags.suggestion" : "autoTags.suggestions"), pct: Math.round(threshold * 100) })
      );
      await refreshStats();
    } catch (err) {
      setMessage(
        t("autoTags.errorPrefix") + (err instanceof Error ? err.message : t("autoTags.unknown"))
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-md border border-line-subtle bg-surface-raised p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-ui-sm font-semibold">{t("autoTags.title")}</h2>
        <button
          type="button"
          onClick={() => void refreshStats()}
          className="text-xs text-ink-tertiary hover:text-ink-secondary"
          title={t("autoTags.refreshStatus")}
        >{t("autoTags.refreshLabel")}</button>
      </div>

      {stats && (
        <dl className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3 text-xs">
          <Stat label={t("autoTags.statFiles")} value={stats.fileCount} />
          <Stat
            label={t("autoTags.statTagged")}
            value={stats.taggedFiles}
            subtitle={
              stats.fileCount > 0
                ? `${Math.round((stats.taggedFiles / stats.fileCount) * 100)}%`
                : undefined
            }
          />
          <Stat label={t("autoTags.statPending")} value={stats.pendingSuggestions} highlight={stats.pendingSuggestions > 0} />
          <Stat label={t("autoTags.statAccepted")} value={stats.accepted} />
          <Stat label={t("autoTags.statRejected")} value={stats.rejected} />
        </dl>
      )}

      <div className="flex flex-wrap gap-3 items-end">
        <button
          type="button"
          onClick={onReTag}
          disabled={!!busy}
          className="px-3 py-1.5 text-sm rounded bg-surface-sunken border border-line-subtle hover:bg-accent/8 disabled:opacity-50"
        >
          {busy === "re-tag" ? t("autoTags.queuing") : t("autoTags.reTag")}
        </button>

        {stats && stats.pendingSuggestions > 0 && (
          <Link
            href={`/studio/${galleryId}/auto-tags`}
            className="px-3 py-1.5 text-sm rounded bg-accent/15 border border-accent/40 text-accent hover:bg-accent/25 font-medium"
          >
            {t("autoTags.viewSuggestions", { n: stats.pendingSuggestions })}
          </Link>
        )}

        <div className="flex items-center gap-2">
          <label className="text-xs text-ink-tertiary">{t("autoTags.confidenceThreshold")}</label>
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
              ? t("autoTags.accepting")
              : t("autoTags.acceptSuggestions")}
          </button>
        </div>
      </div>

      {message && (
        <p className="mt-2 text-xs text-ink-secondary">{message}</p>
      )}

      <p className="mt-2 text-xs text-ink-tertiary">
        {t("autoTags.tip")}
        {stats?.lastTaggedAt && (
          <>
            {t("autoTags.lastTagging")}
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
