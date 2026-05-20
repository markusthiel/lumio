"use client";

/**
 * AnnotationOverlay — SVG-basiertes Zeichen-Overlay auf einem Bild.
 *
 * Zwei Werkzeuge:
 *   - freehand: einfache Stift-Linie, Punkte werden als polyline gerendert
 *   - arrow:    gerade Linie mit Pfeilspitze am Ende
 *
 * Drei Farben (rot, gelb, grün) — semantisch frei nutzbar; Kunde
 * benutzt typisch rot=weg, gelb=überlegen, grün=top.
 *
 * Optische Trennung Kunde-vs-Studio: durchgezogen vs. gestrichelt.
 * Das Author-Bit kommt von außen, der Renderer macht den Stil-Switch.
 *
 * Koordinaten: normalisiert auf [0..1] der Bildfläche. Wir kennen die
 * Display-Größe nicht (Lightbox-Container, Proofing-Tab-Container,
 * Mobile/Desktop), aber die Bild-Dimensionen sind in den File-Daten.
 * Speichert man so kann jeder Viewer wieder skalieren ohne Verluste.
 *
 * SVG statt Canvas:
 *   - Einfach zu animieren (cursor-tracking)
 *   - DOM-strokes sind individuell adressierbar (Undo, Löschen)
 *   - Auflösungsunabhängig, kein Pixel-Aliasing
 *   - Toolchain-frei
 */

import { useEffect, useRef, useState } from "react";

export type AnnotationColor = "red" | "yellow" | "green";
export type AnnotationTool = "freehand" | "arrow";

/** Ein einzelner Pfeil ODER eine Frei-Hand-Linie. Strokes sind das,
 *  was geschickt + persistiert wird. */
export type AnnotationStroke =
  | {
      kind: "freehand";
      color: AnnotationColor;
      author?: "customer" | "studio";
      /** Punkte als [x, y]-Tupel, normalisiert auf [0..1]. Mindestens
       *  2 Punkte, sonst wird der Stroke verworfen. */
      points: Array<[number, number]>;
    }
  | {
      kind: "arrow";
      color: AnnotationColor;
      author?: "customer" | "studio";
      from: [number, number];
      to: [number, number];
    };

export interface AnnotationData {
  version: 1;
  strokes: AnnotationStroke[];
}

/** Hex-Farben pro Annotation-Color. Bewusst kräftig, weil sie auf
 *  Foto-Hintergrund lesbar bleiben müssen. Mit dunklem Stroke-Halo
 *  für Lesbarkeit auf hellen Bildflächen. */
const COLOR_MAP: Record<AnnotationColor, string> = {
  red: "#ef4444",
  yellow: "#fbbf24",
  green: "#22c55e",
};

const STROKE_WIDTH = 0.006; // relativ — wirkt wie 4-6px bei normalen Sizes

interface Props {
  /** Existierende, persistierte Strokes — werden gerendert aber sind
   *  read-only. Eigene Edits kommen ins separate `value`-Array.
   *  Dieser Split macht es möglich dass Kunde + Studio gleichzeitig
   *  ein Bild annotieren ohne dass einer das andere kaputt macht. */
  existing?: AnnotationStroke[];

  /** Editierbare Strokes — UNCONTROLLED während des Zeichnens, der
   *  Wert kommt am Ende eines Strokes via onCommit nach außen. */
  value?: AnnotationStroke[];
  onChange?: (next: AnnotationStroke[]) => void;

  /** Wer zeichnet gerade. Bestimmt den Linien-Stil (durchgezogen
   *  für customer, gestrichelt für studio). Wenn null → read-only. */
  author: "customer" | "studio" | null;

  /** Aktiv-Werkzeug + Farbe. null/null → Pan-Modus, keine Eingaben. */
  tool: AnnotationTool | null;
  color: AnnotationColor;
}

export function AnnotationOverlay({
  existing,
  value,
  onChange,
  author,
  tool,
  color,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);

  // Aktiver Draw-Stroke (Frei-Hand: wächst, Pfeil: Start+End)
  const [drawing, setDrawing] = useState<
    | { kind: "freehand"; points: Array<[number, number]> }
    | { kind: "arrow"; from: [number, number]; to: [number, number] }
    | null
  >(null);

  const readonly = author === null || tool === null || !onChange;

  /** Konvertiert ein Pointer-Event in [0..1]-Koordinaten relativ zur SVG. */
  function pointFromEvent(
    e: React.PointerEvent<SVGSVGElement>
  ): [number, number] {
    const svg = svgRef.current;
    if (!svg) return [0, 0];
    const r = svg.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    return [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))];
  }

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (readonly || !tool) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    const p = pointFromEvent(e);
    if (tool === "freehand") {
      setDrawing({ kind: "freehand", points: [p] });
    } else {
      setDrawing({ kind: "arrow", from: p, to: p });
    }
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!drawing) return;
    const p = pointFromEvent(e);
    if (drawing.kind === "freehand") {
      // Einfacher Distanz-Filter — keine Punkte näher als 0.003 dran.
      // Sonst werden die Strokes riesig und das JSON teuer.
      const last = drawing.points[drawing.points.length - 1];
      const dx = p[0] - last[0];
      const dy = p[1] - last[1];
      if (dx * dx + dy * dy < 0.003 * 0.003) return;
      setDrawing({ kind: "freehand", points: [...drawing.points, p] });
    } else {
      setDrawing({ kind: "arrow", from: drawing.from, to: p });
    }
  }

  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    if (!drawing || !author || !onChange) {
      setDrawing(null);
      return;
    }
    (e.target as Element).releasePointerCapture?.(e.pointerId);

    // Stroke nur commiten wenn er substantiell ist — kurze Mini-
    // Wackler beim Klick sollen keine 1-Punkt-Stroke produzieren.
    let stroke: AnnotationStroke | null = null;
    if (drawing.kind === "freehand") {
      if (drawing.points.length >= 2) {
        stroke = {
          kind: "freehand",
          color,
          author,
          points: drawing.points,
        };
      }
    } else {
      const [fx, fy] = drawing.from;
      const [tx, ty] = drawing.to;
      const dx = tx - fx;
      const dy = ty - fy;
      // Pfeil mind. 2 % der Bildlänge sein lassen, sonst war's ein Klick.
      if (dx * dx + dy * dy >= 0.02 * 0.02) {
        stroke = {
          kind: "arrow",
          color,
          author,
          from: drawing.from,
          to: drawing.to,
        };
      }
    }
    if (stroke) onChange([...(value ?? []), stroke]);
    setDrawing(null);
  }

  // Beim Verlassen des SVG ohne PointerUp: trotzdem committen
  function onPointerCancel() {
    setDrawing(null);
  }

  const allRendered: Array<AnnotationStroke & { _idx: number }> = [
    ...(existing ?? []).map((s, i) => ({ ...s, _idx: i })),
    ...(value ?? []).map((s, i) => ({ ...s, _idx: 1000 + i })),
  ];

  // Cursor-Style: crosshair während Tool aktiv, sonst default.
  const cursor = readonly ? "default" : "crosshair";

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      className="absolute inset-0 w-full h-full pointer-events-auto"
      style={{ cursor, touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {/* Pfeilspitzen-Definitionen pro Farbe. Wir verwenden ein
          orientiertes Marker-Element, damit die Spitze immer auf
          das Pfeil-Ende zeigt unabhängig von der Pfeil-Richtung. */}
      <defs>
        {(["red", "yellow", "green"] as const).map((c) => (
          <marker
            key={c}
            id={`lumio-arrow-${c}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L10,5 L0,10 z" fill={COLOR_MAP[c]} />
          </marker>
        ))}
      </defs>

      {/* Persistierte + neue Strokes */}
      {allRendered.map((s) => {
        const stroke = COLOR_MAP[s.color];
        const dash = s.author === "studio" ? "0.012 0.008" : undefined;
        if (s.kind === "freehand") {
          const d = strokeToPath(s.points);
          return (
            <g key={s._idx}>
              {/* Halo für Lesbarkeit auf hellen Bildflächen */}
              <path
                d={d}
                fill="none"
                stroke="rgba(0,0,0,0.35)"
                strokeWidth={STROKE_WIDTH * 1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={d}
                fill="none"
                stroke={stroke}
                strokeWidth={STROKE_WIDTH}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={dash}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        }
        return (
          <g key={s._idx}>
            <line
              x1={s.from[0]}
              y1={s.from[1]}
              x2={s.to[0]}
              y2={s.to[1]}
              stroke="rgba(0,0,0,0.35)"
              strokeWidth={STROKE_WIDTH * 1.6}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={s.from[0]}
              y1={s.from[1]}
              x2={s.to[0]}
              y2={s.to[1]}
              stroke={stroke}
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="round"
              strokeDasharray={dash}
              markerEnd={`url(#lumio-arrow-${s.color})`}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}

      {/* Live-Preview des aktuellen Strokes (während die Maus runter ist) */}
      {drawing && drawing.kind === "freehand" && drawing.points.length > 0 && (
        <path
          d={strokeToPath(drawing.points)}
          fill="none"
          stroke={COLOR_MAP[color]}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          opacity={0.85}
        />
      )}
      {drawing && drawing.kind === "arrow" && (
        <line
          x1={drawing.from[0]}
          y1={drawing.from[1]}
          x2={drawing.to[0]}
          y2={drawing.to[1]}
          stroke={COLOR_MAP[color]}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          markerEnd={`url(#lumio-arrow-${color})`}
          opacity={0.85}
        />
      )}
    </svg>
  );
}

/** Polyline mit gerundeten Ecken via quadratischen Beziers durch die
 *  Punkt-Mittelpunkte. Liefert glattere Frei-Hand-Linien als pures
 *  polyline ohne Performance-Aufwand. */
function strokeToPath(points: Array<[number, number]>): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`;
  if (points.length === 2)
    return `M ${points[0][0]} ${points[0][1]} L ${points[1][0]} ${points[1][1]}`;
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [cx, cy] = points[i];
    const [nx, ny] = points[i + 1];
    const mx = (cx + nx) / 2;
    const my = (cy + ny) / 2;
    d += ` Q ${cx} ${cy} ${mx} ${my}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last[0]} ${last[1]}`;
  return d;
}

/** Schmaler Tool-Picker-Strip — wird vom Caller über der Lightbox
 *  oder dem Proofing-Image gerendert. Hier weil Tool+Color+Author
 *  hier definiert sind und der Picker exakt diese Begriffe nutzt. */
export function AnnotationToolbar({
  tool,
  setTool,
  color,
  setColor,
  onUndo,
  onClear,
  hasMine,
}: {
  tool: AnnotationTool | null;
  setTool: (t: AnnotationTool | null) => void;
  color: AnnotationColor;
  setColor: (c: AnnotationColor) => void;
  /** Letzten EIGENEN Stroke entfernen. existing-Strokes (vom anderen
   *  Author oder bereits persistiert) bleiben unberührt. */
  onUndo: () => void;
  /** Alle eigenen Strokes löschen. */
  onClear: () => void;
  /** True wenn mind. einer eigener Stroke existiert — sonst sind
   *  Undo/Clear ausgegraut. */
  hasMine: boolean;
}) {
  return (
    <div className="inline-flex items-center gap-1 bg-black/60 backdrop-blur rounded-full px-2 py-1.5 text-white">
      {/* Tool */}
      <ToolButton
        active={tool === "freehand"}
        onClick={() => setTool(tool === "freehand" ? null : "freehand")}
        title="Frei-Hand"
        aria-label="Frei-Hand zeichnen"
      >
        <FreehandIcon />
      </ToolButton>
      <ToolButton
        active={tool === "arrow"}
        onClick={() => setTool(tool === "arrow" ? null : "arrow")}
        title="Pfeil"
        aria-label="Pfeil zeichnen"
      >
        <ArrowIcon />
      </ToolButton>

      <span className="w-px h-5 bg-white/20 mx-1" aria-hidden />

      {/* Farben */}
      {(["red", "yellow", "green"] as const).map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => setColor(c)}
          aria-label={`Farbe ${c}`}
          className={`w-7 h-7 rounded-full inline-flex items-center justify-center transition-transform duration-motion ${
            color === c ? "scale-110 ring-2 ring-white/80" : "opacity-80 hover:opacity-100"
          }`}
        >
          <span
            className="block w-4 h-4 rounded-full"
            style={{ backgroundColor: COLOR_MAP[c] }}
          />
        </button>
      ))}

      <span className="w-px h-5 bg-white/20 mx-1" aria-hidden />

      <ToolButton
        onClick={onUndo}
        disabled={!hasMine}
        title="Letzte Markierung zurück"
        aria-label="Letzte Markierung zurück"
      >
        <UndoIcon />
      </ToolButton>
      <ToolButton
        onClick={onClear}
        disabled={!hasMine}
        title="Alle eigenen Markierungen löschen"
        aria-label="Alle eigenen Markierungen löschen"
      >
        <ClearIcon />
      </ToolButton>
    </div>
  );
}

function ToolButton({
  active,
  disabled,
  onClick,
  title,
  children,
  ...rest
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick">) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`w-8 h-8 rounded-full inline-flex items-center justify-center transition-colors duration-motion ${
        disabled
          ? "opacity-30 cursor-not-allowed"
          : active
          ? "bg-white/25"
          : "hover:bg-white/15"
      }`}
      {...rest}
    >
      {children}
    </button>
  );
}

function FreehandIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 13 Q 4 6, 7 9 T 14 4" />
    </svg>
  );
}
function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="13" x2="13" y2="3" />
      <polyline points="8,3 13,3 13,8" />
    </svg>
  );
}
function UndoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 6 L5 3 M2 6 L5 9 M2 6 H9 a3 3 0 0 1 0 6" />
    </svg>
  );
}
function ClearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3 L11 11 M11 3 L3 11" />
    </svg>
  );
}
