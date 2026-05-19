"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ZipStatus } from "@/lib/api";
import { useT } from "@/lib/i18n";

type Variant = "all" | "selection";

interface Props {
  slug: string;
  variant: Variant;
  /** Anzahl Files in der Auswahl (für selection-Variante, sonst 0) */
  count?: number;
  /** Disabled wenn z.B. keine Auswahl */
  disabled?: boolean;
}

export function ZipDownloadButton({
  slug,
  variant,
  count = 0,
  disabled = false,
}: Props) {
  const t = useT();
  const [zipId, setZipId] = useState<string | null>(null);
  const [status, setStatus] = useState<ZipStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback(async () => {
    setError(null);
    setBuilding(true);
    try {
      const res =
        variant === "all"
          ? await api.requestZipAll(slug)
          : await api.requestZipSelection(slug);
      setZipId(res.id);
      setStatus(res.status);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : t("gallery.requestFailed");
      setError(
        msg.includes("no_selection")
          ? t("gallery.downloadEmpty")
          : msg.includes("downloads_disabled")
          ? t("gallery.downloadDisabled")
          : msg
      );
      setBuilding(false);
    }
  }, [variant, slug, t]);

  // Polling für Status
  useEffect(() => {
    if (!zipId || status === "ready" || status === "failed") {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await api.getZipStatus(slug, zipId);
        setStatus(res.status);
        if (res.errorMessage) setError(res.errorMessage);
        if (res.status === "ready" || res.status === "failed") {
          setBuilding(false);
        }
      } catch {
        // ignore — nächster Tick versucht's wieder
      }
    }, 2_000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [zipId, status, slug]);

  function reset() {
    setZipId(null);
    setStatus(null);
    setError(null);
    setBuilding(false);
  }

  const label =
    variant === "all"
      ? t("gallery.downloadAll")
      : t("gallery.downloadSelection", { count });

  if (status === "ready" && zipId) {
    return (
      <a
        href={api.zipDownloadUrl(slug, zipId)}
        className="text-ui-sm h-8 px-3 inline-flex items-center rounded bg-green-600/80 text-white hover:bg-green-600 transition-colors duration-motion"
        onClick={() => setTimeout(reset, 800)}
      >
        ↓ {t("gallery.zipDownload")}
      </a>
    );
  }

  if (building || status === "pending" || status === "building") {
    return (
      <button
        disabled
        className="text-ui-sm h-8 px-3 rounded bg-white/5 border border-white/15 cursor-wait flex items-center gap-2"
      >
        <span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
        {t("gallery.zipBuilding")}
      </button>
    );
  }

  if (status === "failed") {
    return (
      <button
        onClick={start}
        className="text-ui-sm h-8 px-3 rounded border border-red-400/50 text-red-200 hover:bg-red-500/10 transition-colors duration-motion"
        title={error ?? t("gallery.downloadRetry")}
      >
        ⚠ {t("gallery.zipRetry")}
      </button>
    );
  }

  return (
    <button
      onClick={start}
      disabled={disabled}
      className="text-ui-sm h-8 px-3 rounded bg-white/5 border border-white/15 hover:bg-white/15 hover:border-white/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-motion"
      title={error ?? undefined}
    >
      {label}
    </button>
  );
}
