"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  type PublicFile,
  type PublicGalleryMeta,
  type MySelection,
  type Comment,
} from "@/lib/api";
import { VideoPlayer } from "./VideoPlayer";
import { ZipDownloadButton } from "./ZipDownloadButton";
import { Slideshow } from "./Slideshow";
import { GalleryHero } from "./GalleryHero";
import { ShareButton } from "./ShareButton";
import { useT } from "@/lib/i18n";
import { useReveal } from "@/lib/useReveal";

interface Props {
  meta: PublicGalleryMeta;
  slug: string;
  files: PublicFile[];
  mySelections: Record<string, MySelection>;
  finalizedAt: string | null;
  canSelect: boolean;
  onSelectionChange: (fileId: string, sel: MySelection) => void;
  onFinalize: () => void | Promise<void>;
}

type FilterMode = "all" | "liked" | "red" | "yellow" | "green";

export function GalleryView({
  meta,
  slug,
  files,
  mySelections,
  finalizedAt,
  canSelect,
  onSelectionChange,
  onFinalize,
}: Props) {
  const t = useT();
  const [filter, setFilter] = useState<FilterMode>("all");
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [slideshowIdx, setSlideshowIdx] = useState<number | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  // Auswahl-Interaktion ist nur möglich, wenn (a) die Galerie überhaupt im
  // collaboration-Modus ist und (b) der Visitor einen Access-Token hat,
  // der canSelect erlaubt. Ohne (b) wäre jeder Like-Versuch eine 403-Falle
  // gewesen und der Kunde hätte sich gefragt, warum nach Reload alles weg
  // ist. Wir bündeln das als interactive-Boolean und blenden die Auswahl-UI
  // aus, wenn es nicht passt.
  const interactive = meta.mode === "collaboration" && canSelect;

  const filtered = useMemo(() => {
    if (filter === "all") return files;
    return files.filter((f) => {
      const sel = mySelections[f.id];
      if (!sel) return false;
      if (filter === "liked") return sel.liked;
      return sel.color === filter;
    });
  }, [files, mySelections, filter]);

  const stats = useMemo(() => {
    const sels = Object.values(mySelections);
    return {
      total: files.length,
      liked: sels.filter((s) => s.liked).length,
      red: sels.filter((s) => s.color === "red").length,
      yellow: sels.filter((s) => s.color === "yellow").length,
      green: sels.filter((s) => s.color === "green").length,
    };
  }, [files, mySelections]);

  return (
    <>
      {/* Hero — kann personalisiert sein (Hero-Bild, Logo, Welcome-
          Markdown, Overlay-Farbe). Wenn keine Customization gesetzt
          ist, sieht's aus wie der bisherige minimale Hero. */}
      <GalleryHero meta={meta}>
        <div className="text-ui-xs opacity-50 mt-6 flex items-center gap-3 flex-wrap uppercase tracking-[0.12em]">
          <span>
            {stats.total} {t("gallery.files")}
          </span>
          {/* "Liked"-Counter — zeigt entweder nur den Stand oder, wenn der
              Photograph ein Auswahllimit gesetzt hat, "X von Y". Bei
              erreichtem Limit hebt sich das Element farblich ab, damit
              der Kunde sofort sieht: ich kann gerade nichts mehr dazu
              tun ohne erst was abzuwählen. */}
          {meta.mode === "collaboration" &&
            (stats.liked > 0 || meta.selectionLimit !== null) && (
              <>
                <span className="opacity-30">·</span>
                <span
                  className={
                    meta.selectionLimit !== null &&
                    stats.liked >= meta.selectionLimit
                      ? "text-brand-accent"
                      : ""
                  }
                >
                  {meta.selectionLimit !== null ? (
                    <>
                      {t("gallery.likedOutOf", {
                        liked: stats.liked,
                        limit: meta.selectionLimit,
                      })}
                    </>
                  ) : (
                    <>
                      {stats.liked} {t("gallery.liked")}
                    </>
                  )}
                </span>
              </>
            )}
          {finalizedAt && (
            <>
              <span className="opacity-30">·</span>
              <span className="text-semantic-success">
                {t("gallery.finalized")}
              </span>
            </>
          )}
          {/* Read-only-Hinweis: Galerie wäre eigentlich Collaboration-Mode,
              aber dieser Visitor hat keinen Access-Token mit Auswahl-Recht.
              Ohne diesen Hinweis würde der Kunde glauben, das UI sei kaputt:
              Klick aufs Herz, kurz Like-Icon, Reload, weg. */}
          {meta.mode === "collaboration" && !canSelect && (
            <>
              <span className="opacity-30">·</span>
              <span className="text-ink-tertiary normal-case tracking-normal">
                {t("gallery.viewOnlyHint")}
              </span>
            </>
          )}
        </div>
      </GalleryHero>

      {/* Sticky-Toolbar — verbleibt am oberen Rand beim Scrollen.
          Backdrop-blur sorgt für saubere Trennung über den Bildern. */}
      <div
        className="sticky top-0 z-20 backdrop-blur-md border-y border-white/5"
        style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-12 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex gap-1.5 flex-wrap">
            {interactive && stats.total > 0 ? (
              <>
                <FilterChip
                  active={filter === "all"}
                  onClick={() => setFilter("all")}
                  label={t("gallery.filterAll", { count: stats.total })}
                />
                <FilterChip
                  active={filter === "liked"}
                  onClick={() => setFilter("liked")}
                  label={`♥ ${stats.liked}`}
                />
                <FilterChip
                  active={filter === "green"}
                  onClick={() => setFilter("green")}
                  label={`${stats.green}`}
                  dot="bg-green-500"
                />
                <FilterChip
                  active={filter === "yellow"}
                  onClick={() => setFilter("yellow")}
                  label={`${stats.yellow}`}
                  dot="bg-yellow-500"
                />
                <FilterChip
                  active={filter === "red"}
                  onClick={() => setFilter("red")}
                  label={`${stats.red}`}
                  dot="bg-red-500"
                />
              </>
            ) : (
              <span className="text-ui-xs opacity-50 uppercase tracking-[0.12em] self-center">
                {meta.mode === "presentation"
                  ? t("gallery.modePresentation")
                  : ""}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {stats.total > 0 && (
              <button
                onClick={() => setSlideshowIdx(0)}
                className="text-ui-sm px-3 h-8 rounded inline-flex items-center gap-1.5 bg-white/5 border border-white/15 text-white/85 hover:bg-white/15 hover:border-white/30 hover:text-white transition-colors duration-motion"
                title={t("gallery.slideshowStartTitle")}
              >
                <PlayMiniIcon />
                <span>{t("gallery.slideshowStart")}</span>
              </button>
            )}
            {interactive &&
              stats.liked > 0 &&
              !finalizedAt && (
                <button
                  onClick={async () => {
                    setFinalizing(true);
                    try {
                      await onFinalize();
                    } finally {
                      setFinalizing(false);
                    }
                  }}
                  disabled={finalizing}
                  className="text-ui-sm px-3 h-8 rounded inline-flex items-center bg-brand-accent text-neutral-950 font-medium hover:opacity-90 disabled:opacity-50 transition-opacity duration-motion"
                >
                  {finalizing ? t("gallery.finalizing") : t("gallery.finalize")}
                </button>
              )}
            {meta.downloadEnabled && stats.total > 0 && (
              <>
                {meta.downloadOriginalsEnabled && (
                  <ZipDownloadButton
                    slug={slug}
                    kind="all"
                    variant="original"
                    emphasis="primary"
                  />
                )}
                <ZipDownloadButton
                  slug={slug}
                  kind="all"
                  variant="web"
                  emphasis={meta.downloadOriginalsEnabled ? "ghost" : "primary"}
                />
                {interactive && stats.liked > 0 && (
                  <>
                    {meta.downloadOriginalsEnabled && (
                      <ZipDownloadButton
                        slug={slug}
                        kind="selection"
                        variant="original"
                        count={stats.liked}
                        emphasis="primary"
                      />
                    )}
                    <ZipDownloadButton
                      slug={slug}
                      kind="selection"
                      variant="web"
                      count={stats.liked}
                      emphasis={
                        meta.downloadOriginalsEnabled ? "ghost" : "primary"
                      }
                    />
                  </>
                )}
              </>
            )}
            {/* Teilen-Button steht ganz rechts in der Toolbar — Kunden
                können die Galerie per Web-Share-API teilen (mobil
                meistens nativ, sonst Clipboard-Fallback). Die OG-Tags
                im Page-Layout sorgen für die schöne Vorschau im
                Empfänger-Client. */}
            <ShareButton title={meta.title} />
          </div>
        </div>
      </div>

      {/* Grid */}
      <section className="px-4 sm:px-6 md:px-12 pt-6 pb-16 max-w-7xl mx-auto">
        {filtered.length === 0 ? (
          <div className="text-center py-32 opacity-50 text-ui">
            {filter === "all"
              ? t("gallery.noFiles")
              : t("gallery.noFilesForFilter")}
          </div>
        ) : meta.gridLayout === "equal" ? (
          /* Equal-Grid: alle Tiles quadratisch, fixe Spaltenzahl.
             Sehr clean für Portrait-Sessions wo die Tiles eh
             ähnliche Ausrichtung haben. */
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {filtered.map((f, i) => (
              <GalleryTile
                key={f.id}
                file={f}
                index={i}
                sel={mySelections[f.id]}
                mode="equal"
                onOpen={() =>
                  setLightboxIdx(files.findIndex((ff) => ff.id === f.id))
                }
              />
            ))}
          </div>
        ) : meta.gridLayout === "justified" ? (
          /* Justified-Grid (Flickr-Style): flex-wrap-Reihen, Bilder
             skalieren sich mit flex-grow so dass jede Reihe gleich
             hoch wird. Trick: jedes Tile bekommt eine Basis-Breite
             proportional zu seinem Aspect-Ratio, dann growen alle
             auf die Reihen-Breite hoch. Ist nicht 100% optimal wie
             ein JS-Justified-Algorithmus (z.B. flickr-justified-
             gallery), aber pure CSS und ohne Layout-Shift.

             Wichtig: die Tile-Komponente macht im Justified-Mode
             KEIN aspect-ratio mehr — die Höhe kommt aus der Reihe,
             die Breite aus flex-basis. */
          <div className="flex flex-wrap gap-2 sm:gap-3">
            {filtered.map((f, i) => (
              <GalleryTile
                key={f.id}
                file={f}
                index={i}
                sel={mySelections[f.id]}
                mode="justified"
                onOpen={() =>
                  setLightboxIdx(files.findIndex((ff) => ff.id === f.id))
                }
              />
            ))}
            {/* Spacer-Element: nimmt überschüssige Platz in der letzten
                Reihe so dass die echten Tiles nicht auf 100% Breite
                aufgepumpt werden. Ohne den würde das letzte Bild
                allein in der Reihe sehr breit gezogen. */}
            <i className="grow-[10] block" aria-hidden="true" />
          </div>
        ) : (
          /* Masonry (Default) via CSS columns. Vorteile gegenüber
             JS-Masonry: kein Layout-Shift, kein zusätzliches JS,
             Reihenfolge folgt der DOM-Reihenfolge. */
          <div className="columns-2 sm:columns-3 lg:columns-4 gap-3 [column-fill:_balance]">
            {filtered.map((f, i) => (
              <GalleryTile
                key={f.id}
                file={f}
                index={i}
                sel={mySelections[f.id]}
                mode="masonry"
                onOpen={() =>
                  setLightboxIdx(files.findIndex((ff) => ff.id === f.id))
                }
              />
            ))}
          </div>
        )}
      </section>

      {/* Lightbox */}
      {lightboxIdx !== null && (
        <Lightbox
          files={files}
          index={lightboxIdx}
          slug={slug}
          meta={meta}
          interactive={interactive}
          mySelections={mySelections}
          onClose={() => setLightboxIdx(null)}
          onNavigate={(i) => setLightboxIdx(i)}
          onSelectionChange={onSelectionChange}
        />
      )}

      {/* Slideshow — Fullscreen-Auto-Play. Bewusst NICHT an die Lightbox-
          Selektion gebunden — die Slideshow zeigt immer die volle Galerie
          in DOM-Reihenfolge, nicht den aktuellen Filter. Ein gefiltertes
          Slideshow-Behaviour wäre nett-to-have, würde aber den UX-Mental-
          Model unklarer machen ("warum sehe ich nur 3 Bilder?"). */}
      {slideshowIdx !== null && (
        <Slideshow
          files={files}
          startIndex={slideshowIdx}
          transition={meta.slideshowTransition}
          onClose={() => setSlideshowIdx(null)}
        />
      )}
    </>
  );
}

function PlayMiniIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden>
      <path d="M2.5 1.5v7l6-3.5-6-3.5z" />
    </svg>
  );
}

// -----------------------------------------------------------------------------
// Tile — IntersectionObserver für Reveal-Animation
// -----------------------------------------------------------------------------
function GalleryTile({
  file,
  index,
  sel,
  mode,
  onOpen,
}: {
  file: PublicFile;
  index: number;
  sel: MySelection | undefined;
  mode: "masonry" | "justified" | "equal";
  onOpen: () => void;
}) {
  const { ref, revealed } = useReveal<HTMLDivElement>();
  // Aspect-Ratio aus den File-Dimensionen, mit sicherem Fallback.
  // Wir geben dem Tile-Container die echte Höhe (im masonry/equal-Modus),
  // damit der Reveal nicht erst nach Bild-Load springt.
  const aspectStr =
    file.width && file.height ? `${file.width} / ${file.height}` : "1 / 1";
  const aspectRatio =
    file.width && file.height ? file.width / file.height : 1;

  // Reveal-Distanz wird per CSS-Var gesteuert (motion-Setting),
  // hier nur das Delay je nach Index. Cap bei 24, sonst gefühlt zu lang.
  const delay = `${Math.min(index, 24) * 30}ms`;

  // Wrapper-Styling pro Mode.
  let wrapperClass: string;
  let wrapperStyle: React.CSSProperties = {
    opacity: revealed ? 1 : 0,
    transform: revealed
      ? "translateY(0)"
      : "translateY(var(--motion-reveal-y, 8px))",
    transition:
      "opacity var(--motion-reveal, 280ms) var(--motion-ease) " +
      delay +
      ", transform var(--motion-reveal, 280ms) var(--motion-ease) " +
      delay,
  };

  if (mode === "justified") {
    // Justified: feste Reihen-Höhe (ca. 200-260px je nach Viewport),
    // Breite proportional zum Aspect-Ratio, flex-grow erlaubt das
    // Aufpumpen pro Reihe.
    wrapperClass = "relative overflow-hidden rounded";
    wrapperStyle = {
      ...wrapperStyle,
      height: "240px",
      // flex-basis = height * aspect = die "natürliche" Breite
      // für diese Höhe. flex-grow lässt CSS die Bilder pro Reihe
      // aufstrecken bis die Reihe voll ist.
      flexBasis: `${240 * aspectRatio}px`,
      flexGrow: aspectRatio,
    };
  } else if (mode === "equal") {
    // Equal: quadratisch, object-cover macht den Rest.
    wrapperClass = "relative overflow-hidden rounded aspect-square";
  } else {
    // Masonry (Default)
    wrapperClass = "mb-3 break-inside-avoid";
  }

  return (
    <div ref={ref} className={wrapperClass} style={wrapperStyle}>
      <button
        onClick={onOpen}
        className="block w-full h-full overflow-hidden rounded bg-white/5 relative group focus:outline-none"
        style={mode === "masonry" ? { aspectRatio: aspectStr } : undefined}
      >
        {file.thumbUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={file.thumbUrl}
            alt={file.filename}
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-motion ease-out group-hover:scale-[1.02]"
            draggable={false}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-ui-xs opacity-40">
            {file.kind}
          </div>
        )}

        {/* Video-Indikator */}
        {file.kind === "video" && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-12 h-12 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center text-white text-lg drop-shadow">
              ▶
            </div>
          </div>
        )}

        {/* Format-Indikator für RAW + HEIC. Beide kommen aus
            Pro/Smartphone-Workflows, in beiden Fällen rendert Lumio dem
            Kunden eine Web-Variante (WebP) — das Original wäre auf
            Windows ohne Codec eh schwierig. Das Badge ist Information,
            nicht Warnung. */}
        {(file.kind === "raw" || file.kind === "heic") && (
          <div className="absolute bottom-2 right-2 text-ui-xs font-mono uppercase bg-black/60 backdrop-blur-sm text-white px-1.5 py-0.5 rounded-xs">
            {file.kind === "raw" ? "RAW" : "HEIC"}
          </div>
        )}

        {/* Selection-Indikatoren */}
        {sel?.color && (
          <div className="absolute top-2 left-2">
            <span
              className={`block w-3 h-3 rounded-full ring-2 ring-white/60 ${
                sel.color === "red"
                  ? "bg-red-500"
                  : sel.color === "yellow"
                  ? "bg-yellow-500"
                  : "bg-green-500"
              }`}
            />
          </div>
        )}
        {sel?.liked && (
          <div className="absolute top-2 right-2 text-red-400 text-lg drop-shadow-lg">
            ♥
          </div>
        )}
      </button>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  dot,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  dot?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-ui-xs h-7 px-3 rounded-full border transition-colors duration-motion ease-out flex items-center gap-1.5 ${
        active
          ? "bg-white text-neutral-950 border-white"
          : "border-white/15 hover:border-white/35 opacity-80 hover:opacity-100"
      }`}
    >
      {dot && <span className={`w-2 h-2 rounded-full ${dot}`} />}
      {label}
    </button>
  );
}

// -----------------------------------------------------------------------------
// Lightbox
// -----------------------------------------------------------------------------
function Lightbox({
  files,
  index,
  slug,
  meta,
  interactive,
  mySelections,
  onClose,
  onNavigate,
  onSelectionChange,
}: {
  files: PublicFile[];
  index: number;
  slug: string;
  meta: PublicGalleryMeta;
  interactive: boolean;
  mySelections: Record<string, MySelection>;
  onClose: () => void;
  onNavigate: (idx: number) => void;
  onSelectionChange: (fileId: string, sel: MySelection) => void;
}) {
  const t = useT();
  const file = files[index];
  const sel = mySelections[file.id] ?? {
    color: null,
    rating: null,
    liked: false,
  };
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [showComments, setShowComments] = useState(false);
  const [showHints, setShowHints] = useState(true);
  const [newComment, setNewComment] = useState("");
  const [commentPending, setCommentPending] = useState(false);
  const [limitMessage, setLimitMessage] = useState<string | null>(null);

  // Tastatur-Navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && index > 0) onNavigate(index - 1);
      else if (e.key === "ArrowRight" && index < files.length - 1)
        onNavigate(index + 1);
      else if (e.key === " " && interactive) {
        e.preventDefault();
        void toggleLike();
      } else if (
        ["1", "2", "3"].includes(e.key) &&
        interactive
      ) {
        const color =
          e.key === "1" ? "red" : e.key === "2" ? "yellow" : "green";
        void setColor(color as "red" | "yellow" | "green");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, files, onClose, onNavigate, sel.liked, sel.color, interactive]);

  // Keyboard-Hints nach 5s ausblenden, damit sie nicht stören
  useEffect(() => {
    const id = setTimeout(() => setShowHints(false), 5000);
    return () => clearTimeout(id);
  }, []);

  // Kommentare lazy laden
  useEffect(() => {
    if (!showComments) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.listComments(slug, file.id);
        if (!cancelled) setComments(res.comments);
      } catch {
        if (!cancelled) setComments([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showComments, slug, file.id]);

  const updateSelection = useCallback(
    async (patch: Partial<MySelection>) => {
      // Wir merken uns den vorherigen Stand, damit wir bei Server-Fehler
      // sauber zurückrollen können. Optimistic-Update bleibt, sonst fühlt
      // sich der Like-Klick zäh an — aber bei selection_limit_reached
      // setzen wir den UI-State zurück und zeigen einen kurzen Hinweis.
      const previous: MySelection = { ...sel };
      const next: MySelection = { ...sel, ...patch };
      onSelectionChange(file.id, next);
      try {
        await api.setSelection(slug, file.id, next);
      } catch (err) {
        // Rollback
        onSelectionChange(file.id, previous);
        if (err instanceof ApiError && err.code === "selection_limit_reached") {
          // Limit ist in meta.selectionLimit bekannt — der Server schickt's
          // im Body auch nochmal, aber wir nehmen die UI-Wahrheit.
          setLimitMessage(
            t("gallery.selectionLimitReached", {
              limit: meta.selectionLimit ?? 0,
            })
          );
        } else {
          console.error(err);
        }
      }
    },
    [sel, file.id, slug, onSelectionChange, meta.selectionLimit, t]
  );

  // Limit-Hinweis nach 3s ausblenden
  useEffect(() => {
    if (!limitMessage) return;
    const id = setTimeout(() => setLimitMessage(null), 3000);
    return () => clearTimeout(id);
  }, [limitMessage]);

  async function toggleLike() {
    await updateSelection({ liked: !sel.liked });
  }
  async function setColor(c: "red" | "yellow" | "green") {
    await updateSelection({ color: sel.color === c ? null : c });
  }

  async function postComment(e: React.FormEvent) {
    e.preventDefault();
    if (!newComment.trim()) return;
    setCommentPending(true);
    try {
      const res = await api.postComment(slug, file.id, newComment);
      setComments((prev) => [...(prev ?? []), res.comment]);
      setNewComment("");
    } catch (err) {
      console.error(err);
    } finally {
      setCommentPending(false);
    }
  }

  // Zwei mögliche Download-Varianten: Original (volle Auflösung) und Web
  // (2560px webp). Wenn der Studio "downloadOriginalsEnabled=false" gesetzt
  // hat, wird Original ausgegraut/weggelassen und nur Web steht zur Wahl.
  const originalDownloadUrl =
    meta.downloadEnabled && meta.downloadOriginalsEnabled
      ? api.publicDownloadUrl(slug, file.id, "original")
      : null;
  const webDownloadUrl = meta.downloadEnabled
    ? api.publicDownloadUrl(slug, file.id, "web")
    : null;

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col animate-fade-in">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-3 sm:px-5 py-2.5 border-b border-white/5 text-ui-sm">
        <button
          onClick={onClose}
          className="h-8 px-2 rounded inline-flex items-center gap-1.5 text-white/80 hover:text-white hover:bg-white/10 transition-colors duration-motion"
          aria-label={t("gallery.close")}
        >
          <span className="text-base leading-none">✕</span>
          <span className="hidden sm:inline">{t("gallery.close")}</span>
        </button>
        <div className="text-ui-xs text-white/50 font-mono">
          {index + 1} / {files.length}
        </div>
        <div className="flex items-center gap-1">
          {meta.commentsEnabled && (
            <button
              onClick={() => setShowComments((s) => !s)}
              className={`h-8 px-3 rounded text-ui-xs transition-colors duration-motion ${
                showComments
                  ? "bg-white/15 text-white"
                  : "text-white/70 hover:text-white hover:bg-white/10"
              }`}
            >
              {t("gallery.comments")}
            </button>
          )}
          {originalDownloadUrl && (
            <a
              href={originalDownloadUrl}
              className="h-8 px-3 rounded text-ui-xs inline-flex items-center text-white/70 hover:text-white hover:bg-white/10 transition-colors duration-motion"
              title={
                file.kind === "heic"
                  ? t("gallery.downloadHeicHint")
                  : t("gallery.downloadOriginalHint")
              }
            >
              ↓ {t("gallery.downloadOriginal")}
              {file.kind === "heic" && (
                <span className="ml-1.5 font-mono text-[10px] opacity-70">
                  HEIC
                </span>
              )}
            </a>
          )}
          {webDownloadUrl && (
            <a
              href={webDownloadUrl}
              className="h-8 px-3 rounded text-ui-xs inline-flex items-center text-white/70 hover:text-white hover:bg-white/10 transition-colors duration-motion"
              title={t("gallery.downloadWebHint")}
            >
              ↓ {t("gallery.downloadWeb")}
            </a>
          )}
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex items-center justify-center relative">
          <button
            disabled={index === 0}
            onClick={() => onNavigate(index - 1)}
            className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/5 hover:bg-white/20 disabled:opacity-20 disabled:cursor-not-allowed text-2xl text-white/80 flex items-center justify-center transition-colors duration-motion"
            aria-label={t("gallery.previous")}
          >
            ‹
          </button>
          <button
            disabled={index === files.length - 1}
            onClick={() => onNavigate(index + 1)}
            className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/5 hover:bg-white/20 disabled:opacity-20 disabled:cursor-not-allowed text-2xl text-white/80 flex items-center justify-center transition-colors duration-motion"
            aria-label={t("gallery.next")}
          >
            ›
          </button>

          {file.kind === "video" && file.hlsUrl ? (
            <VideoPlayer
              src={file.hlsUrl}
              poster={file.previewUrl ?? file.thumbUrl}
              sprite={file.sprite}
              className="max-h-full max-w-full"
            />
          ) : file.previewUrl || file.webUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={file.webUrl ?? file.previewUrl ?? ""}
              alt={file.filename}
              className="max-h-full max-w-full object-contain animate-fade-in"
              draggable={false}
              key={file.id} /* erzwingt re-mount → fade bei Wechsel */
            />
          ) : (
            <div className="opacity-50 text-ui">
              {t("gallery.previewMissing")}
            </div>
          )}

          {/* Keyboard-Hint-Overlay — verschwindet nach 5s */}
          {showHints && interactive && (
            <div
              className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-black/60 backdrop-blur-sm rounded-full text-ui-xs text-white/70 flex items-center gap-3 pointer-events-none animate-fade-in"
              style={{ transition: "opacity 600ms ease-out" }}
            >
              <span><Kbd>←</Kbd> <Kbd>→</Kbd> {t("gallery.hintNavigate")}</span>
              <span><Kbd>Space</Kbd> ♥</span>
              <span><Kbd>1</Kbd><Kbd>2</Kbd><Kbd>3</Kbd> ●</span>
              <span><Kbd>Esc</Kbd> ✕</span>
            </div>
          )}

          {/* Limit-Reached-Toast: erscheint wenn der Server einen Like
              wegen erreichtem Auswahllimit ablehnt. Sitzt höher als der
              Hint, damit beide bei Bedarf gleichzeitig lesbar bleiben. */}
          {limitMessage && (
            <div
              className="absolute bottom-16 left-1/2 -translate-x-1/2 px-4 py-2 bg-semantic-warning/95 text-surface-canvas rounded text-ui-sm font-medium pointer-events-none animate-fade-in shadow-lg"
              role="status"
            >
              {limitMessage}
            </div>
          )}
        </div>

        {/* Sidebar (Kommentare) */}
        {showComments && meta.commentsEnabled && (
          <aside className="w-80 border-l border-white/5 flex flex-col bg-black/50 backdrop-blur-sm">
            <div className="px-4 py-3 border-b border-white/5 text-ui-sm font-medium text-white/90">
              {t("gallery.comments")}
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {comments === null ? (
                <div className="text-ui-xs opacity-50">{t("gallery.commentsLoading")}</div>
              ) : comments.length === 0 ? (
                <div className="text-ui-xs opacity-50">{t("gallery.commentsEmpty")}</div>
              ) : (
                comments.map((c) => (
                  <div key={c.id} className="text-ui">
                    <div className="text-ui-xs opacity-60 mb-0.5">
                      {c.authorLabel}
                      {c.authorIsStudio && (
                        <span className="ml-1.5 text-[10px] bg-brand-accent/30 text-brand-accent px-1.5 py-0.5 rounded-xs">
                          {t("gallery.commentStudioBadge")}
                        </span>
                      )}
                    </div>
                    <div className="whitespace-pre-wrap leading-relaxed">{c.body}</div>
                  </div>
                ))
              )}
            </div>
            <form
              onSubmit={postComment}
              className="border-t border-white/5 p-3 space-y-2"
            >
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder={t("gallery.commentPlaceholder")}
                rows={2}
                className="w-full bg-white/5 border border-white/15 rounded p-2 text-ui placeholder:opacity-40 focus:outline-none focus:border-brand-accent transition-colors duration-motion"
              />
              <button
                type="submit"
                disabled={commentPending || !newComment.trim()}
                className="w-full text-ui-xs h-8 rounded bg-brand-accent text-neutral-950 font-medium disabled:opacity-50 transition-opacity duration-motion"
              >
                {commentPending ? t("gallery.commentSending") : t("gallery.commentSend")}
              </button>
            </form>
          </aside>
        )}
      </div>

      {/* Bottom toolbar — Proofing. Nur bei aktivem Auswahl-Recht. */}
      {interactive && (
        <div className="border-t border-white/5 px-3 py-3 flex items-center justify-center gap-2">
          <ColorPill
            color="red"
            active={sel.color === "red"}
            onClick={() => setColor("red")}
            label={t("gallery.markRed")}
            title={t("gallery.markRedTitle")}
          />
          <ColorPill
            color="yellow"
            active={sel.color === "yellow"}
            onClick={() => setColor("yellow")}
            label={t("gallery.markYellow")}
            title={t("gallery.markYellowTitle")}
          />
          <ColorPill
            color="green"
            active={sel.color === "green"}
            onClick={() => setColor("green")}
            label={t("gallery.markGreen")}
            title={t("gallery.markGreenTitle")}
          />
          <div className="w-px h-6 bg-white/15 mx-2" />
          <button
            onClick={toggleLike}
            className={`h-9 px-4 rounded-full border transition-all duration-motion ease-out flex items-center gap-2 ${
              sel.liked
                ? "bg-red-500/90 border-red-400 text-white"
                : "border-white/20 text-white/70 hover:text-white hover:border-white/50"
            }`}
            aria-label={t("gallery.like")}
            title={t("gallery.likeTitle")}
          >
            <span className="text-base leading-none">♥</span>
            <span className="text-ui-xs">{t("gallery.like")}</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** Kleiner Helfer für die Color-Pills. Bewusst klein gehalten — sonst stehlen
    sie den Bildern die Aufmerksamkeit. */
function ColorPill({
  color,
  active,
  onClick,
  label,
  title,
}: {
  color: "red" | "yellow" | "green";
  active: boolean;
  onClick: () => void;
  label: string;
  title: string;
}) {
  const bg = {
    red: active ? "bg-red-500" : "bg-red-500/30 hover:bg-red-500/55",
    yellow: active ? "bg-yellow-500" : "bg-yellow-500/30 hover:bg-yellow-500/55",
    green: active ? "bg-green-500" : "bg-green-500/30 hover:bg-green-500/55",
  }[color];
  return (
    <button
      onClick={onClick}
      className={`w-9 h-9 rounded-full transition-all duration-motion ease-out ${bg} ${
        active ? "ring-2 ring-white/70" : ""
      }`}
      aria-label={label}
      title={title}
    />
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="font-mono px-1 py-0.5 mx-px text-[10px] rounded border border-white/20 bg-white/5">
      {children}
    </kbd>
  );
}
