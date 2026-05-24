"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useImageZoom — Zoom + Pan für ein einzelnes Bild in der Lightbox.
 *
 * Drei Eingabe-Modi:
 *   - Mausrad (Desktop)      → Zoom zentriert auf Cursor-Position
 *   - Pinch (Touch, 2 Finger) → Zoom zentriert zwischen den Fingern
 *   - Doppeltap/Doppelklick   → Toggle 1× ↔ 2.5× (zentriert auf Klick-Pos)
 *
 * Wenn der Zoom > 1 ist:
 *   - Maus-Drag und Touch-1-Finger-Drag schieben das Bild (Pan).
 *   - Pan ist begrenzt, sodass das Bild nicht aus dem Container fliegt.
 *
 * Bewusste Design-Entscheidungen:
 *   - Wir verwalten Zoom als CSS-`transform: translate() scale()` am
 *     Wrapper, nicht am `<img>` direkt — so skaliert das absolute
 *     Annotation-Overlay (inset:0, viewBox=0 0 1 1, preserveAspectRatio=
 *     none) automatisch korrekt mit, ohne dass wir die Strokes
 *     transformieren müssen.
 *   - `transform-origin: center` plus eine Translation, die wir aus dem
 *     Cursor- bzw. Pinch-Center ableiten, gibt "Zoom zur Cursor-Position"
 *     ohne dass wir die origin selbst ändern müssten — letzteres würde
 *     bei Folge-Zooms zu Sprüngen führen, weil dann die Translation in
 *     einer anderen origin-Basis interpretiert wird.
 *   - Kein wheel-Event mit { passive: true }, weil wir preventDefault
 *     brauchen um das Scrollen der Seite zu verhindern. React's
 *     onWheel ist intern passive — daher addEventListener von Hand.
 */

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const WHEEL_ZOOM_FACTOR = 1.0015; // pro deltaY-Einheit; gibt ~1.5× pro 300px Scroll
const DOUBLE_TAP_ZOOM = 2.5;
const DOUBLE_TAP_THRESHOLD_MS = 300;

export interface ImageZoomState {
  /** aktueller Zoom-Faktor (1 = nicht gezoomt) */
  scale: number;
  /** ist der Zoom aktiv (scale > 1) — bequem für UI-Logik */
  zoomed: boolean;
  /** Style-Object für das transformierte Element */
  style: React.CSSProperties;
  /** Pan/Zoom-Handler an den Container (NICHT ans Bild!) hängen */
  containerProps: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
    onDoubleClick: (e: React.MouseEvent) => void;
    style: React.CSSProperties;
  };
  /** Ref auf den Container — der Hook braucht ihn für wheel + bounds */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** programmatisch zurücksetzen (z. B. bei Bildwechsel) */
  reset: () => void;
  /** programmatisch ein-/auszoomen (für externe Buttons) */
  zoomIn: () => void;
  zoomOut: () => void;
}

export function useImageZoom(opts?: { disabled?: boolean }): ImageZoomState {
  const disabled = !!opts?.disabled;

  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);

  // Container-Ref für wheel und für bounding-rect-Berechnungen.
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Refs auf den aktuellen Transformations-Zustand: pointermove etc. lesen
  // die in jeder Frame, da wäre das Re-Reading von State stale.
  const scaleRef = useRef(1);
  const txRef = useRef(0);
  const tyRef = useRef(0);
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);
  useEffect(() => {
    txRef.current = tx;
  }, [tx]);
  useEffect(() => {
    tyRef.current = ty;
  }, [ty]);

  // --- Helpers ---

  /**
   * Wendet einen neuen Zoom-Faktor an und korrigiert die Translation so,
   * dass der Punkt (cx, cy) — in Container-Koordinaten, relativ zum
   * Container-Mittelpunkt — unter dem Cursor/Pinch-Center bleibt.
   *
   * Mathematik: Wir nutzen transform-origin center, also wird ein Punkt p
   * im untransformed image mapped zu (p * s) + t. Damit p_screen vor und
   * nach Zoom-Wechsel gleich bleibt, muss gelten:
   *   p * s_old + t_old = p * s_new + t_new
   *   => t_new = t_old + p * (s_old - s_new)
   * wobei p relativ zum Container-Mittelpunkt ist (da origin = center).
   */
  const applyZoomAt = useCallback(
    (newScale: number, cx: number, cy: number) => {
      const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newScale));
      const sOld = scaleRef.current;
      if (clamped === sOld) return;

      const container = containerRef.current;
      if (!container) {
        setScale(clamped);
        return;
      }
      const rect = container.getBoundingClientRect();
      // Cursor relativ zum Container-Mittelpunkt (origin = center)
      const px = cx - rect.left - rect.width / 2;
      const py = cy - rect.top - rect.height / 2;

      // Was war der "Bild-Punkt" unter dem Cursor vor dem Zoom?
      //   p_screen = p_image * sOld + tOld
      //   p_image  = (p_screen - tOld) / sOld
      const pImageX = (px - txRef.current) / sOld;
      const pImageY = (py - tyRef.current) / sOld;

      // Neue Translation, damit derselbe p_image wieder unter (px, py) liegt:
      const newTx = px - pImageX * clamped;
      const newTy = py - pImageY * clamped;

      // Bounds (siehe unten)
      const { tx: clampedTx, ty: clampedTy } = clampPan(
        newTx,
        newTy,
        clamped,
        rect.width,
        rect.height,
      );

      setScale(clamped);
      setTx(clampedTx);
      setTy(clampedTy);
    },
    [],
  );

  const reset = useCallback(() => {
    setScale(1);
    setTx(0);
    setTy(0);
  }, []);

  const zoomIn = useCallback(() => {
    const c = containerRef.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    applyZoomAt(scaleRef.current * 1.5, r.left + r.width / 2, r.top + r.height / 2);
  }, [applyZoomAt]);

  const zoomOut = useCallback(() => {
    const c = containerRef.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const next = scaleRef.current / 1.5;
    if (next <= MIN_ZOOM + 0.01) {
      reset();
      return;
    }
    applyZoomAt(next, r.left + r.width / 2, r.top + r.height / 2);
  }, [applyZoomAt, reset]);

  // --- Wheel (Desktop) ---
  // Wir registrieren manuell als non-passive, weil React's onWheel
  // intern passive bound wird (Next/React 18+) und wir preventDefault
  // brauchen, sonst scrollt die Seite mit.
  useEffect(() => {
    if (disabled) return;
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      // Wheel ohne Ctrl/Meta auf Trackpad ist häufig 2-Finger-Scroll —
      // wir interpretieren das hier trotzdem als Zoom, weil wir in der
      // Lightbox (Fullscreen) keinen sinnvollen Scroll-Use-Case haben.
      e.preventDefault();
      const factor = Math.pow(WHEEL_ZOOM_FACTOR, -e.deltaY);
      applyZoomAt(scaleRef.current * factor, e.clientX, e.clientY);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyZoomAt, disabled]);

  // --- Pointer-Tracking für Pan + Pinch ---
  // Wir verwalten alle aktiven Pointer in einer Map. Bei 1 Pointer = Pan,
  // bei 2 Pointern = Pinch.
  const pointersRef = useRef<
    Map<number, { x: number; y: number; startX: number; startY: number }>
  >(new Map());
  // Bei Pinch-Start halten wir den ursprünglichen Pinch-Abstand und den
  // damaligen Scale fest, sodass scale_new = scale_start * (dist_now / dist_start).
  const pinchRef = useRef<{ startDist: number; startScale: number } | null>(
    null,
  );
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      // Capture-Pointer macht move/up auf demselben Element robust,
      // auch wenn der Finger den Container verlässt.
      (e.target as Element).setPointerCapture?.(e.pointerId);
      pointersRef.current.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        startX: e.clientX,
        startY: e.clientY,
      });

      if (pointersRef.current.size === 2) {
        const pts = Array.from(pointersRef.current.values());
        const dx = pts[0].x - pts[1].x;
        const dy = pts[0].y - pts[1].y;
        pinchRef.current = {
          startDist: Math.hypot(dx, dy),
          startScale: scaleRef.current,
        };
      }

      // Touch-Doppeltap (pointerType=touch, einmal kurz an ähnlicher Stelle)
      if (e.pointerType === "touch" && pointersRef.current.size === 1) {
        const now = Date.now();
        const last = lastTapRef.current;
        if (
          last &&
          now - last.t < DOUBLE_TAP_THRESHOLD_MS &&
          Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30
        ) {
          // Doppeltap → toggle
          if (scaleRef.current > 1) {
            reset();
          } else {
            applyZoomAt(DOUBLE_TAP_ZOOM, e.clientX, e.clientY);
          }
          lastTapRef.current = null;
        } else {
          lastTapRef.current = { t: now, x: e.clientX, y: e.clientY };
        }
      }
    },
    [applyZoomAt, disabled, reset],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      const prev = pointersRef.current.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      pointersRef.current.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        startX: prev.startX,
        startY: prev.startY,
      });

      if (pointersRef.current.size === 2 && pinchRef.current) {
        // Pinch: neuer Abstand und neues Pinch-Center
        const pts = Array.from(pointersRef.current.values());
        const cdx = pts[0].x - pts[1].x;
        const cdy = pts[0].y - pts[1].y;
        const dist = Math.hypot(cdx, cdy);
        const factor = dist / pinchRef.current.startDist;
        const newScale = pinchRef.current.startScale * factor;
        const cx = (pts[0].x + pts[1].x) / 2;
        const cy = (pts[0].y + pts[1].y) / 2;
        applyZoomAt(newScale, cx, cy);
        return;
      }

      // Pan (nur bei zoom > 1, sonst lassen wir Wischgesten unangetastet —
      // die Nav-Buttons machen das in der Lightbox).
      if (
        pointersRef.current.size === 1 &&
        scaleRef.current > 1 &&
        !pinchRef.current
      ) {
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const { tx: clampedTx, ty: clampedTy } = clampPan(
          txRef.current + dx,
          tyRef.current + dy,
          scaleRef.current,
          rect.width,
          rect.height,
        );
        setTx(clampedTx);
        setTy(clampedTy);
      }
    },
    [applyZoomAt, disabled],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) {
      pinchRef.current = null;
    }
  }, []);

  const onPointerCancel = useCallback((e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) {
      pinchRef.current = null;
    }
  }, []);

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      // Nur Maus — Touch-Doppeltap läuft in pointerdown.
      // (e.detail===2 mit pointerType=mouse landet hier; Touch-Doubletap
      // synthetisiert kein dblclick auf allen Browsern zuverlässig.)
      if (scaleRef.current > 1) {
        reset();
      } else {
        applyZoomAt(DOUBLE_TAP_ZOOM, e.clientX, e.clientY);
      }
    },
    [applyZoomAt, disabled, reset],
  );

  const zoomed = scale > 1.001;

  // Im disabled-Mode (z. B. Annotation-Zeichnen aktiv) geben wir
  // pointerEvents-no-ops und Default-Cursor zurück, damit das darunter
  // liegende Annotation-Overlay normal funktioniert.
  if (disabled) {
    return {
      scale: 1,
      zoomed: false,
      style: {},
      containerProps: {
        onPointerDown: () => {},
        onPointerMove: () => {},
        onPointerUp: () => {},
        onPointerCancel: () => {},
        onDoubleClick: () => {},
        style: {},
      },
      containerRef,
      reset,
      zoomIn,
      zoomOut,
    };
  }

  return {
    scale,
    zoomed,
    style: {
      transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
      transformOrigin: "center center",
      // Eine smooth-transition während Pan/Pinch hakt — daher nur wenn
      // gerade KEIN Pointer aktiv ist (kein Drag). Für Doppelklick/Wheel
      // wäre eine 120ms-transition schöner, aber das vermischt sich mit
      // Pan und macht's hakelig — pragmatisch: ohne transition.
      willChange: "transform",
      touchAction: "none",
    },
    containerProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onDoubleClick,
      style: {
        // touchAction:none verhindert dass der Browser unsere Pointer-
        // Events durch Scrollen/Pinch-Zoom-Page abfängt.
        touchAction: "none",
        // Cursor: bei zoom>1 grab/grabbing für Pan, sonst zoom-in.
        cursor: zoomed ? "grab" : "zoom-in",
        // userSelect off — sonst markiert Drag den Text drumherum.
        userSelect: "none",
        WebkitUserSelect: "none",
      },
    },
    containerRef,
    reset,
    zoomIn,
    zoomOut,
  };
}

/**
 * Begrenzt die Translation so, dass das skalierte Bild den Container
 * mindestens halb füllt — verhindert dass das Bild komplett aus dem
 * sichtbaren Bereich gezogen wird.
 *
 * Wir kennen die Bildgröße nicht exakt (object-contain), gehen aber davon
 * aus dass das Bild im untransformed-Zustand maximal so groß wie der
 * Container ist. Damit ist die max. erlaubte Verschiebung in jede
 * Richtung: (containerSize * (scale - 1)) / 2.
 */
function clampPan(
  tx: number,
  ty: number,
  scale: number,
  w: number,
  h: number,
): { tx: number; ty: number } {
  const maxX = (w * (scale - 1)) / 2;
  const maxY = (h * (scale - 1)) / 2;
  return {
    tx: Math.max(-maxX, Math.min(maxX, tx)),
    ty: Math.max(-maxY, Math.min(maxY, ty)),
  };
}
