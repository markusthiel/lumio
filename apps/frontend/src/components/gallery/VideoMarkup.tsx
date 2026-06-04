"use client";

import { useMemo, useRef, useState } from "react";
import {
  VideoPlayer,
  type VideoPlayerHandle,
  type SpriteSheet,
} from "./VideoPlayer";
import {
  AnnotationOverlay,
  AnnotationToolbar,
  extractVideoMarkers,
  type AnnotationStroke,
  type AnnotationTool,
  type AnnotationColor,
} from "@/components/annotation/AnnotationOverlay";
import { useT } from "@/lib/i18n";

/**
 * VideoMarkup — annotierbarer Video-Player. Gemeinsam genutzt von der
 * Kundengalerie und dem Studio-Proofing.
 *
 * Markierungen sind zeitverankert (ein Zeit-Punkt, `t` Sekunden) und
 * werden als version-2-AnnotationData an einem Comment gespeichert.
 * Der Parent entscheidet via `onCreate`, über welche API persistiert
 * wird (Kunde: postComment, Studio: studioPostComment) und lädt danach
 * die Comments neu — die Marker-Ticks aktualisieren sich automatisch.
 *
 * Ablauf: „Markieren" pausiert das Video und friert die aktuelle Sekunde
 * als Marker-Zeit ein → Pfeil/Freihand aufs Standbild → Speichern.
 * Klick auf einen Tick springt dorthin, pausiert und zeigt die
 * Markierung als Overlay.
 */

type CommentLike = {
  id: string;
  annotation?: unknown;
  authorIsStudio?: boolean;
  body?: string;
};

const TICK_COLOR = {
  customer: "#38bdf8", // sky
  studio: "#f59e0b", // amber
};

export function VideoMarkup({
  src,
  poster,
  sprite,
  srcType,
  className,
  comments,
  canAnnotate,
  author,
  onCreate,
}: {
  src: string;
  poster?: string | null;
  sprite?: SpriteSheet | null;
  srcType?: "hls" | "mp4";
  className?: string;
  comments: CommentLike[] | null;
  canAnnotate: boolean;
  author: "customer" | "studio";
  onCreate: (input: {
    strokes: AnnotationStroke[];
    t: number;
    body: string;
  }) => Promise<void>;
}) {
  const t = useT();
  const playerRef = useRef<VideoPlayerHandle | null>(null);

  const markers = useMemo(() => extractVideoMarkers(comments), [comments]);

  // Draw-State: markT != null ⇒ wir sind im Zeichen-Modus, eingefroren
  // auf dieser Sekunde.
  const [markT, setMarkT] = useState<number | null>(null);
  const [tool, setTool] = useState<AnnotationTool | null>("arrow");
  const [color, setColor] = useState<AnnotationColor>("red");
  const [strokes, setStrokes] = useState<AnnotationStroke[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // Ausgewählter Marker (Anzeige-Modus, read-only Overlay)
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = markers.find((m) => m.id === selectedId) ?? null;

  const drawing = markT !== null;

  function startMarking() {
    const p = playerRef.current;
    if (!p) return;
    p.pause();
    setSelectedId(null);
    setMarkT(p.getCurrentTime());
    setTool("arrow");
    setStrokes([]);
    setNote("");
  }

  function cancelMarking() {
    setMarkT(null);
    setStrokes([]);
    setNote("");
  }

  async function save() {
    if (markT === null) return;
    if (strokes.length === 0 && !note.trim()) {
      cancelMarking();
      return;
    }
    setSaving(true);
    try {
      await onCreate({ strokes, t: markT, body: note.trim() });
      cancelMarking();
    } catch {
      /* Fehler werden vom Parent gehandhabt; UI bleibt im Draw-Modus,
       * damit der User nochmal speichern kann. */
    } finally {
      setSaving(false);
    }
  }

  function onMarkerClick(id: string) {
    if (drawing) return;
    playerRef.current?.pause();
    setSelectedId(id);
  }

  // Beim Abspielen die Marker-Anzeige ausblenden.
  function onPlayingChange(playing: boolean) {
    if (playing && selectedId) setSelectedId(null);
  }

  // Welches Overlay liegt über dem Frame?
  let overlay: React.ReactNode = undefined;
  if (drawing) {
    overlay = (
      <AnnotationOverlay
        value={strokes}
        onChange={setStrokes}
        author={author}
        tool={tool}
        color={color}
      />
    );
  } else if (selected) {
    overlay = (
      <AnnotationOverlay
        existing={selected.strokes}
        author={null}
        tool={null}
        color="red"
      />
    );
  }

  const tickMarkers = markers.map((m) => ({
    id: m.id,
    t: m.t,
    color: m.authorIsStudio ? TICK_COLOR.studio : TICK_COLOR.customer,
  }));

  return (
    <div className={`relative flex flex-col ${className ?? ""}`}>
      <VideoPlayer
        ref={playerRef}
        src={src}
        poster={poster}
        sprite={sprite}
        srcType={srcType}
        className="flex-1 min-h-0"
        markers={tickMarkers}
        activeMarkerId={selectedId}
        onMarkerClick={onMarkerClick}
        onPlayingChange={onPlayingChange}
        overlay={overlay}
      />

      {/* Steuerleiste oben über dem Video */}
      {canAnnotate && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2">
          {!drawing ? (
            <button
              type="button"
              onClick={startMarking}
              className="h-8 px-3 rounded-full bg-black/65 backdrop-blur text-white text-ui-xs inline-flex items-center gap-1.5 hover:bg-black/80 transition-colors duration-motion"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="2" y1="13" x2="13" y2="3" />
                <polyline points="8,3 13,3 13,8" />
              </svg>
              {t("annotation.videoMarkup.annotate")}
            </button>
          ) : (
            <>
              <AnnotationToolbar
                tool={tool}
                setTool={setTool}
                color={color}
                setColor={setColor}
                hasMine={strokes.length > 0}
                onUndo={() => setStrokes((arr) => arr.slice(0, -1))}
                onClear={() => setStrokes([])}
              />
              <div className="flex items-center gap-1.5 bg-black/65 backdrop-blur rounded-full px-2 py-1.5">
                <span className="text-ui-xs text-white/80 font-mono px-1 whitespace-nowrap">
                  {t("annotation.videoMarkup.at", {
                    time: formatTime(markT ?? 0),
                  })}
                </span>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t("annotation.videoMarkup.notePlaceholder")}
                  maxLength={5000}
                  className="w-40 sm:w-52 bg-white/10 text-white text-ui-xs placeholder:text-white/40 rounded px-2 py-1 focus:outline-none focus:bg-white/15"
                />
                <button
                  type="button"
                  onClick={cancelMarking}
                  className="h-7 px-2.5 rounded-full text-ui-xs text-white/80 hover:bg-white/15 transition-colors duration-motion"
                >
                  {t("annotation.videoMarkup.cancel")}
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || (strokes.length === 0 && !note.trim())}
                  className="h-7 px-3 rounded-full text-ui-xs bg-white text-black font-medium hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-motion"
                >
                  {saving
                    ? t("annotation.videoMarkup.saving")
                    : t("annotation.videoMarkup.save")}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Caption des ausgewählten Markers */}
      {selected && !drawing && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 bg-black/70 backdrop-blur rounded-full pl-3 pr-1.5 py-1 max-w-[90%]">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{
              background: selected.authorIsStudio
                ? TICK_COLOR.studio
                : TICK_COLOR.customer,
            }}
          />
          <span className="text-ui-xs text-white/70 font-mono shrink-0">
            {formatTime(selected.t)}
          </span>
          {selected.body && (
            <span className="text-ui-xs text-white/90 truncate">
              {selected.body}
            </span>
          )}
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="w-6 h-6 rounded-full text-white/70 hover:bg-white/15 inline-flex items-center justify-center shrink-0 transition-colors duration-motion"
            aria-label={t("annotation.videoMarkup.close")}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}
