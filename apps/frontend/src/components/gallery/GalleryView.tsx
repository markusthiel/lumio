"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type PublicFile,
  type PublicGalleryMeta,
  type MySelection,
  type Comment,
} from "@/lib/api";
import { VideoPlayer } from "./VideoPlayer";
import { ZipDownloadButton } from "./ZipDownloadButton";

interface Props {
  meta: PublicGalleryMeta;
  slug: string;
  files: PublicFile[];
  mySelections: Record<string, MySelection>;
  onSelectionChange: (fileId: string, sel: MySelection) => void;
}

type FilterMode = "all" | "liked" | "red" | "yellow" | "green";

export function GalleryView({
  meta,
  slug,
  files,
  mySelections,
  onSelectionChange,
}: Props) {
  const [filter, setFilter] = useState<FilterMode>("all");
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

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
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold">{meta.title}</h1>
          {meta.description && (
            <p className="text-sm opacity-60 mt-1 max-w-2xl">
              {meta.description}
            </p>
          )}
          <div className="text-xs opacity-50 mt-3">
            {stats.total} Files · {stats.liked} liked
          </div>
        </div>

        {meta.downloadEnabled && stats.total > 0 && (
          <div className="flex flex-wrap gap-2">
            <ZipDownloadButton slug={slug} variant="all" />
            {meta.mode === "collaboration" && stats.liked > 0 && (
              <ZipDownloadButton
                slug={slug}
                variant="selection"
                count={stats.liked}
              />
            )}
          </div>
        )}
      </div>

      {/* Filter-Toolbar */}
      {meta.mode === "collaboration" && stats.total > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          <FilterChip
            active={filter === "all"}
            onClick={() => setFilter("all")}
            label={`Alle (${stats.total})`}
          />
          <FilterChip
            active={filter === "liked"}
            onClick={() => setFilter("liked")}
            label={`♥ ${stats.liked}`}
          />
          <FilterChip
            active={filter === "green"}
            onClick={() => setFilter("green")}
            label={`● ${stats.green}`}
            dot="bg-green-500"
          />
          <FilterChip
            active={filter === "yellow"}
            onClick={() => setFilter("yellow")}
            label={`● ${stats.yellow}`}
            dot="bg-yellow-500"
          />
          <FilterChip
            active={filter === "red"}
            onClick={() => setFilter("red")}
            label={`● ${stats.red}`}
            dot="bg-red-500"
          />
        </div>
      )}

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-20 opacity-50 text-sm">
          {filter === "all"
            ? "Noch keine Dateien."
            : "Keine Dateien mit diesem Filter."}
        </div>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
          {filtered.map((f) => (
            <GalleryTile
              key={f.id}
              file={f}
              sel={mySelections[f.id]}
              onOpen={() =>
                setLightboxIdx(files.findIndex((ff) => ff.id === f.id))
              }
            />
          ))}
        </ul>
      )}

      {/* Lightbox */}
      {lightboxIdx !== null && (
        <Lightbox
          files={files}
          index={lightboxIdx}
          slug={slug}
          meta={meta}
          mySelections={mySelections}
          onClose={() => setLightboxIdx(null)}
          onNavigate={(i) => setLightboxIdx(i)}
          onSelectionChange={onSelectionChange}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Tile
// -----------------------------------------------------------------------------
function GalleryTile({
  file,
  sel,
  onOpen,
}: {
  file: PublicFile;
  sel: MySelection | undefined;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        onClick={onOpen}
        className="block w-full aspect-square overflow-hidden rounded bg-white/5 relative group focus:outline-none focus:ring-2 focus:ring-brand-accent"
      >
        {file.thumbUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={file.thumbUrl}
            alt={file.filename}
            loading="lazy"
            className="w-full h-full object-cover transition group-hover:scale-[1.02]"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs opacity-40">
            {file.kind}
          </div>
        )}

        {/* Video-Indikator */}
        {file.kind === "video" && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-10 h-10 bg-black/60 rounded-full flex items-center justify-center text-white text-lg drop-shadow">
              ▶
            </div>
          </div>
        )}

        {/* RAW-Indikator */}
        {file.kind === "raw" && (
          <div className="absolute bottom-1.5 right-1.5 text-[9px] font-mono uppercase bg-black/60 text-white px-1.5 py-0.5 rounded">
            RAW
          </div>
        )}

        {/* Selection-Indikatoren */}
        <div className="absolute top-1.5 left-1.5 flex gap-1">
          {sel?.color && (
            <span
              className={`block w-3 h-3 rounded-full border border-white/40 ${
                sel.color === "red"
                  ? "bg-red-500"
                  : sel.color === "yellow"
                  ? "bg-yellow-500"
                  : "bg-green-500"
              }`}
            />
          )}
        </div>
        {sel?.liked && (
          <div className="absolute top-1.5 right-1.5 text-red-400 drop-shadow text-base">
            ♥
          </div>
        )}
      </button>
    </li>
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
      className={`text-xs px-3 py-1.5 rounded-full border transition flex items-center gap-1.5 ${
        active
          ? "bg-white text-neutral-950 border-white"
          : "border-white/20 hover:border-white/40 opacity-80"
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
  mySelections,
  onClose,
  onNavigate,
  onSelectionChange,
}: {
  files: PublicFile[];
  index: number;
  slug: string;
  meta: PublicGalleryMeta;
  mySelections: Record<string, MySelection>;
  onClose: () => void;
  onNavigate: (idx: number) => void;
  onSelectionChange: (fileId: string, sel: MySelection) => void;
}) {
  const file = files[index];
  const sel = mySelections[file.id] ?? {
    color: null,
    rating: null,
    liked: false,
  };
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [showComments, setShowComments] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [commentPending, setCommentPending] = useState(false);

  // Tastatur-Navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && index > 0) onNavigate(index - 1);
      else if (e.key === "ArrowRight" && index < files.length - 1)
        onNavigate(index + 1);
      else if (e.key === " " && meta.mode === "collaboration") {
        e.preventDefault();
        void toggleLike();
      } else if (
        ["1", "2", "3"].includes(e.key) &&
        meta.mode === "collaboration"
      ) {
        const color =
          e.key === "1" ? "red" : e.key === "2" ? "yellow" : "green";
        void setColor(color as "red" | "yellow" | "green");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, files, onClose, onNavigate, sel.liked, sel.color]);

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
      const next: MySelection = { ...sel, ...patch };
      // Optimistic update
      onSelectionChange(file.id, next);
      try {
        await api.setSelection(slug, file.id, next);
      } catch (err) {
        console.error(err);
      }
    },
    [sel, file.id, slug, onSelectionChange]
  );

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

  const downloadUrl =
    meta.downloadEnabled ? api.publicDownloadUrl(slug, file.id) : null;

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      {/* Top Bar */}
      <div className="flex items-center justify-between p-3 border-b border-white/10 text-sm">
        <button
          onClick={onClose}
          className="px-3 py-1.5 rounded hover:bg-white/10"
          aria-label="Schließen"
        >
          ✕ Schließen
        </button>
        <div className="opacity-60 text-xs">
          {index + 1} / {files.length}
        </div>
        <div className="flex items-center gap-2">
          {meta.commentsEnabled && (
            <button
              onClick={() => setShowComments((s) => !s)}
              className={`px-3 py-1.5 rounded text-xs ${
                showComments ? "bg-white/20" : "hover:bg-white/10"
              }`}
            >
              Kommentare
            </button>
          )}
          {downloadUrl && (
            <a
              href={downloadUrl}
              className="px-3 py-1.5 rounded text-xs hover:bg-white/10"
            >
              ↓ Download
            </a>
          )}
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex overflow-hidden">
        {/* Bild */}
        <div className="flex-1 flex items-center justify-center relative">
          <button
            disabled={index === 0}
            onClick={() => onNavigate(index - 1)}
            className="absolute left-2 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/5 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed text-2xl"
            aria-label="Vorheriges Bild"
          >
            ‹
          </button>
          <button
            disabled={index === files.length - 1}
            onClick={() => onNavigate(index + 1)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/5 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed text-2xl"
            aria-label="Nächstes Bild"
          >
            ›
          </button>

          {file.kind === "video" && file.hlsUrl ? (
            <VideoPlayer
              src={file.hlsUrl}
              poster={file.previewUrl ?? file.thumbUrl}
              className="max-h-full max-w-full"
            />
          ) : file.previewUrl || file.webUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={file.webUrl ?? file.previewUrl ?? ""}
              alt={file.filename}
              className="max-h-full max-w-full object-contain"
              draggable={false}
            />
          ) : (
            <div className="opacity-50 text-sm">
              Vorschau noch nicht verfügbar.
            </div>
          )}
        </div>

        {/* Sidebar (Kommentare) */}
        {showComments && meta.commentsEnabled && (
          <aside className="w-80 border-l border-white/10 flex flex-col">
            <div className="p-4 border-b border-white/10 text-sm font-medium">
              Kommentare
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {comments === null ? (
                <div className="text-xs opacity-50">Lädt…</div>
              ) : comments.length === 0 ? (
                <div className="text-xs opacity-50">Noch keine Kommentare.</div>
              ) : (
                comments.map((c) => (
                  <div key={c.id} className="text-sm">
                    <div className="text-xs opacity-60 mb-0.5">
                      {c.authorLabel}
                      {c.authorIsStudio && (
                        <span className="ml-1 text-[10px] bg-brand-accent/30 px-1 rounded">
                          Studio
                        </span>
                      )}
                    </div>
                    <div className="whitespace-pre-wrap">{c.body}</div>
                  </div>
                ))
              )}
            </div>
            <form
              onSubmit={postComment}
              className="border-t border-white/10 p-3 space-y-2"
            >
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Kommentar schreiben…"
                rows={2}
                className="w-full bg-white/5 border border-white/20 rounded p-2 text-sm placeholder:opacity-40 focus:outline-none focus:ring-1 focus:ring-brand-accent"
              />
              <button
                type="submit"
                disabled={commentPending || !newComment.trim()}
                className="w-full text-xs px-3 py-1.5 rounded bg-brand-accent text-neutral-950 font-medium disabled:opacity-50"
              >
                {commentPending ? "Sende…" : "Senden"}
              </button>
            </form>
          </aside>
        )}
      </div>

      {/* Bottom toolbar — Proofing */}
      {meta.mode === "collaboration" && (
        <div className="border-t border-white/10 p-3 flex items-center justify-center gap-2">
          <button
            onClick={() => setColor("red")}
            className={`w-9 h-9 rounded-full border-2 transition ${
              sel.color === "red"
                ? "bg-red-500 border-white"
                : "bg-red-500/40 border-transparent hover:bg-red-500/70"
            }`}
            aria-label="Rot markieren"
            title="Rot (Taste 1)"
          />
          <button
            onClick={() => setColor("yellow")}
            className={`w-9 h-9 rounded-full border-2 transition ${
              sel.color === "yellow"
                ? "bg-yellow-500 border-white"
                : "bg-yellow-500/40 border-transparent hover:bg-yellow-500/70"
            }`}
            aria-label="Gelb markieren"
            title="Gelb (Taste 2)"
          />
          <button
            onClick={() => setColor("green")}
            className={`w-9 h-9 rounded-full border-2 transition ${
              sel.color === "green"
                ? "bg-green-500 border-white"
                : "bg-green-500/40 border-transparent hover:bg-green-500/70"
            }`}
            aria-label="Grün markieren"
            title="Grün (Taste 3)"
          />
          <div className="w-px h-6 bg-white/20 mx-2" />
          <button
            onClick={toggleLike}
            className={`px-4 h-9 rounded-full border-2 transition flex items-center gap-2 ${
              sel.liked
                ? "bg-red-500 border-white text-white"
                : "border-white/30 hover:border-white/60"
            }`}
            aria-label="Like"
            title="Like (Leertaste)"
          >
            <span>♥</span>
            <span className="text-xs">Like</span>
          </button>
        </div>
      )}
    </div>
  );
}
