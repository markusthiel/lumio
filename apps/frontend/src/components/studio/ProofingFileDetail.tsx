"use client";

/**
 * ProofingFileDetail — Detail-Ansicht eines einzelnen Files im
 * Studio-Proofing-Tab.
 *
 * Zeigt das große Bild mit allen Annotationen (Customer + Studio)
 * und einer Studio-Editor-Schicht, mit der das Studio eigene
 * Markierungen drauf zeichnen kann. Plus eine Sidebar mit der
 * Comment-Liste.
 *
 * Im Gegensatz zur Customer-Lightbox ist hier:
 *   - author='studio' → Strokes werden gestrichelt gerendert
 *   - Keine Like/Color-UI, kein Slideshow-Button
 *   - Studio sieht IMMER alle Comments (auch Customer-zu-Customer-
 *     Replies, falls die existieren — heute nicht möglich, aber
 *     defensiv designed)
 *   - Speichern explizit via Button, nicht via Auto-Save beim
 *     Wechseln. Studio-Annotationen sind kuratierter, der User
 *     soll bewusst auf "Speichern" drücken.
 */

import { useEffect, useState } from "react";
import {
  api,
  type Comment,
  type GalleryFile,
} from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useImageZoom } from "@/lib/useImageZoom";
import {
  AnnotationOverlay,
  AnnotationToolbar,
  type AnnotationStroke,
  type AnnotationTool,
  type AnnotationColor,
  type AnnotationData,
} from "@/components/annotation/AnnotationOverlay";
import { AutoTagsSection } from "@/components/studio/AutoTagsSection";
import { FileTagsSection } from "@/components/studio/FileTagsSection";
import { VideoMarkup } from "@/components/gallery/VideoMarkup";

interface Props {
  galleryId: string;
  file: GalleryFile;
  onClose: () => void;
}

export function ProofingFileDetail({ galleryId, file, onClose }: Props) {
  const t = useT();
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [strokes, setStrokes] = useState<AnnotationStroke[]>([]);
  const [saving, setSaving] = useState(false);
  // Kein Zeichen-Werkzeug vorausgewählt: so ist der Zoom (disabled bei
  // aktivem Tool) beim Öffnen sofort verfügbar — konsistent mit der
  // Kundengalerie, wo Zeichnen ebenfalls opt-in ist. Zum Annotieren
  // wählt das Studio in der Toolbar ein Werkzeug; dann ist Zoom aus.
  const [tool, setTool] = useState<AnnotationTool | null>(null);
  const [color, setColor] = useState<AnnotationColor>("red");
  const [newComment, setNewComment] = useState("");

  // Zoom + Pan, identisches Verhalten wie in der Customer-Lightbox.
  // Wenn ein Zeichen-Werkzeug aktiv ist (tool !== null), wird der Zoom
  // deaktiviert — sonst würde Maus-Drag versuchen zu pannen statt zu
  // zeichnen. Praxis: das Studio drückt 'Esc' oder klickt das aktive
  // Tool nochmal an um auf null zu setzen, dann ist Zoom+Pan verfügbar.
  // Reset bei File-Wechsel — sonst landet das Studio nach Klick auf
  // ein anderes Foto auf einem willkürlich gezoomten neuen Bild.
  const zoom = useImageZoom({ disabled: tool !== null });
  useEffect(() => {
    zoom.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id, tool]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target && (e.target as HTMLElement).tagName === "TEXTAREA") return;
      if (e.target && (e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoom.zoomIn();
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoom.zoomOut();
      } else if (e.key === "0") {
        e.preventDefault();
        zoom.reset();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  // Comments laden bei File-Wechsel
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.studioListComments(galleryId, file.id);
        if (!cancelled) setComments(res.comments);
      } catch {
        if (!cancelled) setComments([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [galleryId, file.id]);

  // Existierende Annotationen aus allen Comments extrahieren
  const existingAnnotations: AnnotationStroke[] = (() => {
    if (!comments) return [];
    const out: AnnotationStroke[] = [];
    for (const c of comments) {
      const data = c.annotation as AnnotationData | null | undefined;
      if (!data || data.version !== 1 || !Array.isArray(data.strokes)) continue;
      const tag: "customer" | "studio" = c.authorIsStudio
        ? "studio"
        : "customer";
      for (const s of data.strokes) {
        out.push({ ...s, author: tag });
      }
    }
    return out;
  })();

  async function saveAnnotation() {
    if (strokes.length === 0 && !newComment.trim()) return;
    setSaving(true);
    try {
      const input: { body: string; annotation?: unknown } = {
        body: newComment.trim(),
      };
      if (strokes.length > 0) {
        const annotation: AnnotationData = { version: 1, strokes };
        input.annotation = annotation;
      }
      await api.studioPostComment(galleryId, file.id, input);
      // Reload Comments + Reset
      const res = await api.studioListComments(galleryId, file.id);
      setComments(res.comments);
      setStrokes([]);
      setNewComment("");
    } catch (err) {
      // Stillschweigender Fehler in der Konsole — Studio kriegt sonst
      // einen toten Button, aber das ist Edge-Case
      console.error("[lumio-proofing] saveAnnotation", err);
    } finally {
      setSaving(false);
    }
  }

  const previewUrl = file.webUrl ?? file.thumbUrl;
  const isVideo = file.kind === "video";

  return (
    <div className="fixed inset-0 bg-surface-canvas z-50 flex flex-col">
      {/* Top-Bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-line-subtle">
        <button
          onClick={onClose}
          className="h-8 px-3 rounded text-ui-sm text-ink-secondary hover:text-ink-primary hover:bg-surface-overlay transition-colors duration-motion"
        >
          ✕ {t("annotation.studioDetail.close")}
        </button>
        <div className="text-ui-sm font-medium text-ink-primary truncate max-w-md">
          {file.originalFilename}
        </div>
        <div className="w-20" /> {/* Spacer für Symmetrie */}
      </div>

      {/* Main */}
      <div className="flex-1 flex overflow-hidden">
        {/* Bild + Annotation-Overlay */}
        <div className="flex-1 flex items-center justify-center relative bg-black/95 overflow-hidden">
          {isVideo ? (
            file.videoUrl ? (
              <div className="relative z-0 w-full h-full flex items-center justify-center p-4">
                <VideoMarkup
                  src={file.videoUrl}
                  srcType="mp4"
                  poster={previewUrl}
                  sprite={file.sprite ?? null}
                  className="w-full max-w-4xl"
                  comments={comments}
                  canAnnotate
                  author="studio"
                  onCreate={async ({ strokes: s, t: markT, body }) => {
                    await api.studioPostComment(galleryId, file.id, {
                      body,
                      annotation: { version: 2, strokes: s, t: markT },
                    });
                    const res = await api.studioListComments(
                      galleryId,
                      file.id
                    );
                    setComments(res.comments);
                  }}
                />
              </div>
            ) : (
              <div className="text-white/50">
                {t("annotation.studioDetail.videoUnavailable")}
              </div>
            )
          ) : previewUrl ? (
            /* Zoom-Container (absolute, inset-0) liefert die volle
               Hit-Area für Wheel/Pinch/Pan auch im schwarzen Bereich
               rechts/links neben dem Bild. Wenn ein Zeichen-Tool aktiv
               ist (tool !== null), wird der Zoom-Hook disabled — er
               liefert dann pass-through-Props und der Container ist
               event-mäßig transparent. Das Annotation-Overlay sitzt im
               transformierten Wrapper und skaliert geometrisch
               automatisch mit (viewBox 0 0 1 1, preserveAspectRatio
               none). displayScale=zoom.scale lässt die Strichbreite
               via sqrt(scale) gedämpft mit-skalieren. */
            <div
              ref={zoom.containerRef}
              {...zoom.containerProps}
              className="absolute inset-0 overflow-hidden flex items-center justify-center z-0"
            >
              <div
                className="relative inline-block max-h-[calc(100vh-180px)]"
                style={{ lineHeight: 0, ...zoom.style }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt={file.originalFilename}
                  className="max-h-[calc(100vh-180px)] max-w-full object-contain block"
                  draggable={false}
                />
                {/* Bei zoom>1 ohne aktives Zeichen-Tool: pointer-events
                    am Overlay deaktivieren, damit Drag im leeren
                    Bildbereich nicht am SVG hängen bleibt. Im
                    Zeichen-Modus (tool !== null) bleibt das Overlay
                    interaktiv — Zoom ist dann sowieso disabled. */}
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    pointerEvents:
                      zoom.zoomed && tool === null ? "none" : undefined,
                  }}
                >
                  <AnnotationOverlay
                    existing={existingAnnotations}
                    value={strokes}
                    onChange={setStrokes}
                    author="studio"
                    tool={tool}
                    color={color}
                    displayScale={zoom.scale}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="text-white/50">{t("annotation.studioDetail.noPreview")}</div>
          )}

          {/* Zoom-Controls oben rechts. Identisches Layout wie in der
              Customer-Lightbox — bewusste Konsistenz, sodass User die
              den Studio-Detail-View aus der Lightbox kennen die UI
              wiedererkennen. */}
          {previewUrl && !isVideo && (
            <div className="absolute top-3 right-3 z-30 flex items-center gap-1 bg-black/50 backdrop-blur-sm rounded-full p-1">
              {zoom.zoomed && (
                <span className="text-ui-xs text-white/80 px-2 tabular-nums select-none">
                  {Math.round(zoom.scale * 100)}%
                </span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  zoom.zoomOut();
                }}
                disabled={!zoom.zoomed}
                className="w-8 h-8 rounded-full hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed text-white/90 flex items-center justify-center transition-colors duration-motion"
                aria-label={t("gallery.zoomOut")}
                title={t("gallery.zoomOut")}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                >
                  <circle cx="7" cy="7" r="5" />
                  <path d="M4.5 7h5M11 11l3 3" />
                </svg>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  zoom.zoomIn();
                }}
                className="w-8 h-8 rounded-full hover:bg-white/10 text-white/90 flex items-center justify-center transition-colors duration-motion"
                aria-label={t("gallery.zoomIn")}
                title={t("gallery.zoomIn")}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                >
                  <circle cx="7" cy="7" r="5" />
                  <path d="M4.5 7h5M7 4.5v5M11 11l3 3" />
                </svg>
              </button>
              {zoom.zoomed && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    zoom.reset();
                  }}
                  className="h-8 px-2.5 rounded-full hover:bg-white/10 text-ui-xs text-white/90 transition-colors duration-motion"
                  aria-label={t("gallery.zoomReset")}
                  title={t("gallery.zoomReset")}
                >
                  1:1
                </button>
              )}
            </div>
          )}

          {/* Toolbar unten — nur für Bilder. Zeichen-Markierungen auf
              Videos sind (noch) nicht möglich, die Overlay-Logik ist
              bildbasiert. */}
          {!isVideo && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
              <AnnotationToolbar
                tool={tool}
                setTool={setTool}
                color={color}
                setColor={setColor}
                hasMine={strokes.length > 0}
                onUndo={() => setStrokes((arr) => arr.slice(0, -1))}
                onClear={() => setStrokes([])}
              />
            </div>
          )}
        </div>

        {/* Sidebar: Tags + Auto-Tags + Comments + Studio-Reply-Form */}
        <aside className="w-96 border-l border-line-subtle bg-surface-raised flex flex-col">
          {/* File-Tags — manuelles Tagging via TagPicker. Reload-Trigger
              setzt nicht das ganze File-Detail neu — wir wollen den
              State erhalten. */}
          <FileTagsSection fileId={file.id} />

          {/* KI-Vorschlaege — versteckt sich selbst wenn Feature aus */}
          <AutoTagsSection fileId={file.id} />

          <div className="px-4 py-3 border-b border-line-subtle text-ui-sm font-medium text-ink-primary">
            {t("annotation.studioDetail.commentsHeading")} ({comments?.length ?? 0})
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {comments === null ? (
              <div className="text-ui-sm text-ink-tertiary">
                {t("annotation.studioDetail.loading")}
              </div>
            ) : comments.length === 0 ? (
              <div className="text-ui-sm text-ink-tertiary text-center py-8">
                {t("annotation.studioDetail.noComments")}
              </div>
            ) : (
              comments.map((c) => (
                <div
                  key={c.id}
                  className={`rounded p-3 ${
                    c.authorIsStudio
                      ? "bg-accent/10 border border-accent/30"
                      : "bg-surface-sunken border border-line-subtle"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-ui-xs font-medium text-ink-primary">
                      {c.authorLabel}
                    </div>
                    <div className="text-ui-xs text-ink-tertiary">
                      {new Date(c.createdAt).toLocaleString("de-DE", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </div>
                  </div>
                  {c.body && (
                    <div className="text-ui-sm text-ink-secondary whitespace-pre-wrap">
                      {c.body}
                    </div>
                  )}
                  {!c.body &&
                    !!c.annotation &&
                    typeof c.annotation === "object" && (
                      <div className="text-ui-xs italic text-ink-tertiary">
                        {t("annotation.studioDetail.onlyAnnotation")}
                      </div>
                    )}
                </div>
              ))
            )}
          </div>

          {/* Studio-Reply-Bereich */}
          <div className="border-t border-line-subtle p-3 space-y-2">
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder={t("annotation.studioDetail.replyPlaceholder")}
              rows={2}
              maxLength={5000}
              className="w-full px-2 py-1.5 rounded border border-line-subtle bg-surface-sunken text-ui-sm text-ink-primary focus:border-accent focus:outline-none resize-none"
            />
            <div className="flex items-center justify-between gap-2">
              <div className="text-ui-xs text-ink-tertiary">
                {strokes.length > 0
                  ? t(
                      strokes.length === 1
                        ? "annotation.studioDetail.marksReady"
                        : "annotation.studioDetail.marksReadyPlural",
                      { n: strokes.length }
                    )
                  : isVideo
                  ? ""
                  : t("annotation.studioDetail.drawHint")}
              </div>
              <button
                onClick={saveAnnotation}
                disabled={
                  saving || (strokes.length === 0 && !newComment.trim())
                }
                className="h-8 px-3 rounded text-ui-sm bg-accent text-accent-contrast hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-motion"
              >
                {saving
                  ? t("annotation.studioDetail.saving")
                  : t("annotation.studioDetail.save")}
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
