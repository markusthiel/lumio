"use client";

/**
 * Lumio Frontend — ZIP Download Button
 *
 * Zwei orthogonale Achsen für die Anforderung:
 *
 *   kind:    "all" | "selection" | "picked"  — was rein soll
 *   variant: "original" | "web"              — welche Bytes davon
 *
 * "all":       die ganze Galerie
 * "selection": Likes + Picks aus Collaboration-Mode (server-seitig)
 * "picked":    ad-hoc-Warenkorb, fileIds kommen vom Client (localStorage)
 *
 * Der Button stellt EINE Kombination dar (z.B. "Auswahl als Web-Version").
 * Die Customer-Hero rendert mehrere davon nebeneinander.
 *
 * Naming-Note: das Component-Prop hieß früher "variant" und meinte
 * all/selection. Mit der Einführung der Download-Variante (original/web)
 * hätte das zu Verwechslungen geführt — also umbenannt zu "kind", und
 * "variant" gehört jetzt zur Bytes-Auswahl.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ZipStatus } from "@/lib/api";
import { useT } from "@/lib/i18n";

type Kind = "all" | "selection" | "picked";
type Variant = "original" | "web";

/** Kompakte, menschenlesbare Größe (z.B. "6,4 GB"). Basis 1024. */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024))
  );
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i >= 3 ? 1 : 0)} ${units[i]}`;
}

interface Props {
  slug: string;
  kind: Kind;
  variant: Variant;
  /** Anzahl Files in der Auswahl (für kind=selection|picked, sonst 0) */
  count?: number;
  /** File-IDs für kind="picked" — werden im Body an die API geschickt. */
  fileIds?: string[];
  /** Disabled wenn z.B. keine Auswahl */
  disabled?: boolean;
  /** Visueller Stil: primary für die wichtige Aktion, ghost für die alternative */
  emphasis?: "primary" | "ghost";
}

export function ZipDownloadButton({
  slug,
  kind,
  variant,
  count = 0,
  fileIds,
  disabled = false,
  emphasis = "ghost",
}: Props) {
  const t = useT();
  const [zipId, setZipId] = useState<string | null>(null);
  const [status, setStatus] = useState<ZipStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [parts, setParts] = useState<
    { index: number; label: string | null; sizeBytes: number | null }[] | null
  >(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback(async () => {
    setError(null);
    setBuilding(true);
    setParts(null);
    try {
      const res =
        kind === "all"
          ? await api.requestZipAll(slug, variant)
          : kind === "selection"
          ? await api.requestZipSelection(slug, variant)
          : await api.requestZipPicked(slug, variant, fileIds ?? []);
      setZipId(res.id);
      setStatus(res.status);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : t("gallery.requestFailed");
      setError(
        msg.includes("no_selection") || msg.includes("no_valid_files")
          ? t("gallery.downloadEmpty")
          : msg.includes("originals_disabled")
          ? t("gallery.originalsDisabled")
          : msg.includes("downloads_disabled")
          ? t("gallery.downloadDisabled")
          : msg
      );
      setBuilding(false);
    }
  }, [kind, variant, slug, t, fileIds]);

  // Polling für Status. Holt bei jedem Tick den Detail-Status (inkl. der
  // Teil-Liste bei mehrteiligen Downloads) — auch der erste Tick läuft
  // sofort, damit ein bereits fertiger (gecachter) Download samt Teilen
  // ohne Verzögerung angezeigt wird.
  useEffect(() => {
    if (!zipId) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const res = await api.getZipStatus(slug, zipId);
        if (cancelled) return;
        setStatus(res.status);
        if (res.errorMessage) setError(res.errorMessage);
        setParts(
          res.parts && (res.partCount ?? 0) >= 2
            ? res.parts.map((p) => ({
                index: p.index,
                label: p.label,
                sizeBytes: p.sizeBytes,
              }))
            : null
        );
        if (res.status === "ready" || res.status === "failed") {
          setBuilding(false);
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
      } catch {
        // ignore — nächster Tick versucht's wieder
      }
    };

    void tick(); // sofort einmal
    if (!pollRef.current) {
      pollRef.current = setInterval(tick, 2_000);
    }

    return () => {
      cancelled = true;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [zipId, slug]);

  function reset() {
    setZipId(null);
    setParts(null);
    setStatus(null);
    setError(null);
    setBuilding(false);
  }

  // Label-Logik: Original-ZIPs sind die "Standard"-Erwartung und bekommen
  // die kürzeren Strings ("Alle herunterladen"). Web-ZIPs werden klar
  // gelabelt ("Alle als Web-Version"), damit der Kunde versteht, dass das
  // eine reduzierte Auflösung ist, ohne dass er klickt und überrascht wird.
  const label =
    kind === "all"
      ? variant === "web"
        ? t("gallery.downloadAllWeb")
        : t("gallery.downloadAll")
      : kind === "picked"
      ? variant === "web"
        ? t("gallery.downloadPickedWeb", { count })
        : t("gallery.downloadPicked", { count })
      : variant === "web"
      ? t("gallery.downloadSelectionWeb", { count })
      : t("gallery.downloadSelection", { count });

  // Stylings — primary heller/auffälliger Hintergrund, ghost dezenter Rand
  const idleClass =
    emphasis === "primary"
      ? "bg-white/12 border border-white/25 hover:bg-white/20 hover:border-white/40"
      : "bg-white/5 border border-white/15 hover:bg-white/15 hover:border-white/30";

  if (status === "ready" && zipId) {
    // Mehrteilig: eine Liste mit einem Download-Button pro Teil. Jeder Teil
    // ist einzeln (neu-)ladbar — bricht ein Download ab, muss nur dieser
    // Teil erneut geholt werden.
    if (parts && parts.length > 1) {
      return (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-white/60">
            {t("gallery.zipParts", { total: parts.length })}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {parts.map((p) => (
              <a
                key={p.index}
                href={api.zipDownloadUrl(slug, zipId, p.index)}
                className="text-ui-sm h-8 px-3 inline-flex items-center gap-1.5 rounded bg-green-600/80 text-white hover:bg-green-600 transition-colors duration-motion"
              >
                ↓ {p.label ?? t("gallery.zipPart", { index: p.index, total: parts.length })}
                {p.sizeBytes != null && (
                  <span className="text-white/70">
                    ({formatBytes(p.sizeBytes)})
                  </span>
                )}
              </a>
            ))}
          </div>
        </div>
      );
    }
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
      className={`text-ui-sm h-8 px-3 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-motion ${idleClass}`}
      title={error ?? undefined}
    >
      {label}
    </button>
  );
}
