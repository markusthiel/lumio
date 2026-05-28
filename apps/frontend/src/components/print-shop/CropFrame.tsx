"use client";

/**
 * Lumio Print-Shop — CropFrame
 *
 * Interaktiver Crop-Rahmen über einem Bild. Aspect-Ratio-constrained:
 * der Rahmen behaelt das vorgegebene Verhaeltnis (z.B. 2:3) und kann
 * via Drag verschoben und ueber Eck-Handles vergroessert/verkleinert
 * werden.
 *
 * Crop-Koordinaten sind in [0..1] normalisiert (relativ zum Bild),
 * damit sie unabhaengig von der Display-Groesse sind und 1:1 ans
 * Backend gehen koennen.
 *
 * Touch + Mouse parallel via Pointer-Events.
 *
 * Default-Crop wenn kein initialCrop: maximal-grosser Frame zentriert.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  imageUrl: string;
  /** Echte Bild-Pixel — fuer Aspect-Ratio des Containers */
  imageWidth: number;
  imageHeight: number;
  /** Crop-Aspect-Ratio width/height. z.B. 2/3 = 0.6667 (Hochformat 2:3) */
  aspectRatio: number;
  /** Optional: initiale Crop-Region. Wenn null: Default-Center-Crop. */
  initialCrop?: Crop | null;
  /** Wird bei jeder Aenderung gerufen */
  onChange: (crop: Crop) => void;
  /** Maximal-Hoehe des Editors in px (sonst voll-breit). Default 360 */
  maxHeightPx?: number;
}

/**
 * Berechnet den maximal-grossen Crop-Frame bei gegebenem Bild- und
 * Ziel-Aspect-Ratio, zentriert.
 */
export function defaultCropForAspect(
  imageWidth: number,
  imageHeight: number,
  aspectRatio: number
): Crop {
  if (!imageWidth || !imageHeight) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  const imageRatio = imageWidth / imageHeight;
  if (Math.abs(imageRatio - aspectRatio) < 0.001) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  if (imageRatio > aspectRatio) {
    // Bild breiter — Frame nimmt volle Höhe, schmaler in der Breite
    const w = aspectRatio / imageRatio;
    return { x: (1 - w) / 2, y: 0, width: w, height: 1 };
  }
  // Bild höher — Frame nimmt volle Breite, niedriger in der Höhe
  const h = imageRatio / aspectRatio;
  return { x: 0, y: (1 - h) / 2, width: 1, height: h };
}

/** Clamp eine Crop-Region in [0..1] und so dass das Aspect-Ratio
 *  korrekt bleibt. Wenn Width/Height-Mismatch zur containerRatio: wir
 *  shrinken zur Crop-Aspect-Ratio. */
function clampCrop(
  crop: Crop,
  containerRatio: number,
  cropAspect: number
): Crop {
  // Erst: Crop in [0..1]
  let x = Math.max(0, Math.min(1, crop.x));
  let y = Math.max(0, Math.min(1, crop.y));
  let w = Math.max(0.05, Math.min(1 - x, crop.width));
  let h = Math.max(0.05, Math.min(1 - y, crop.height));

  // Aspect-Ratio enforcement: width-im-container / height-im-container
  // muss == cropAspect (width/height) sein.
  // Container hat Ratio R = containerWidth/containerHeight.
  // In normalisierten Koordinaten: pixelW = w * containerWidth,
  // pixelH = h * containerHeight. Aspect = pixelW/pixelH =
  // (w * containerWidth) / (h * containerHeight) = (w/h) * R.
  // Soll gleich cropAspect sein: w/h = cropAspect / R.
  const targetWHRatio = cropAspect / containerRatio;
  const currentWHRatio = w / h;
  if (Math.abs(currentWHRatio - targetWHRatio) > 0.001) {
    // Anpassen: kleinere Dimension fixieren, andere nachziehen
    if (currentWHRatio > targetWHRatio) {
      // w ist zu gross relativ zu h — w shrinken
      w = h * targetWHRatio;
    } else {
      h = w / targetWHRatio;
    }
  }
  // Nochmal in [0..1] clampen falls Anpassung ueber den Rand schob
  if (x + w > 1) x = 1 - w;
  if (y + h > 1) y = 1 - h;
  x = Math.max(0, x);
  y = Math.max(0, y);
  return { x, y, width: w, height: h };
}

type DragMode =
  | { kind: "move"; startCrop: Crop; startX: number; startY: number }
  | {
      kind: "resize";
      corner: "nw" | "ne" | "sw" | "se";
      startCrop: Crop;
      startX: number;
      startY: number;
    }
  | null;

export function CropFrame({
  imageUrl,
  imageWidth,
  imageHeight,
  aspectRatio,
  initialCrop = null,
  onChange,
  maxHeightPx = 360,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });
  const [crop, setCrop] = useState<Crop>(() =>
    initialCrop ?? defaultCropForAspect(imageWidth, imageHeight, aspectRatio)
  );
  const dragRef = useRef<DragMode>(null);

  // ContainerSize messen (fuer pointer-delta → normalized-Koordinaten)
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setContainerSize({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Wenn sich aspectRatio aendert (User waehlt andere Variante): Crop
  // auf neues Default zuruecksetzen. imageWidth/imageHeight aendern sich
  // nicht (gleiche File).
  useEffect(() => {
    setCrop(defaultCropForAspect(imageWidth, imageHeight, aspectRatio));
  }, [aspectRatio, imageWidth, imageHeight]);

  // onChange bei jeder Aenderung. Ref-Stable-Pattern fuer den Callback.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onChangeRef.current(crop);
  }, [crop]);

  const containerRatio =
    containerSize.h > 0 ? containerSize.w / containerSize.h : 1;

  const startMove = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        kind: "move",
        startCrop: crop,
        startX: e.clientX,
        startY: e.clientY,
      };
    },
    [crop]
  );

  const startResize = useCallback(
    (corner: "nw" | "ne" | "sw" | "se") => (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        kind: "resize",
        corner,
        startCrop: crop,
        startX: e.clientX,
        startY: e.clientY,
      };
    },
    [crop]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!containerSize.w || !containerSize.h) return;
      const dx = (e.clientX - d.startX) / containerSize.w;
      const dy = (e.clientY - d.startY) / containerSize.h;

      if (d.kind === "move") {
        setCrop((prev) =>
          clampCrop(
            {
              x: d.startCrop.x + dx,
              y: d.startCrop.y + dy,
              width: d.startCrop.width,
              height: d.startCrop.height,
            },
            containerRatio,
            aspectRatio
          )
        );
        return;
      }

      // Resize: ankerseite (gegenueber-corner) bleibt fix, drag-corner
      // bewegt sich. width/height werden so geaendert dass die Aspect-
      // Ratio erhalten bleibt — wir nehmen die laengere Dimension als
      // Master.
      let nx = d.startCrop.x;
      let ny = d.startCrop.y;
      let nw = d.startCrop.width;
      let nh = d.startCrop.height;
      switch (d.corner) {
        case "se":
          nw = d.startCrop.width + dx;
          nh = d.startCrop.height + dy;
          break;
        case "sw":
          nx = d.startCrop.x + dx;
          nw = d.startCrop.width - dx;
          nh = d.startCrop.height + dy;
          break;
        case "ne":
          ny = d.startCrop.y + dy;
          nw = d.startCrop.width + dx;
          nh = d.startCrop.height - dy;
          break;
        case "nw":
          nx = d.startCrop.x + dx;
          ny = d.startCrop.y + dy;
          nw = d.startCrop.width - dx;
          nh = d.startCrop.height - dy;
          break;
      }
      // Aspect-Ratio enforcement: master ist die Dimension mit dem
      // groesseren Delta in Pixel.
      const dxPx = Math.abs(dx * containerSize.w);
      const dyPx = Math.abs(dy * containerSize.h);
      const targetWHRatio = aspectRatio / containerRatio;
      if (dxPx >= dyPx) {
        const targetH = nw / targetWHRatio;
        const diffH = targetH - nh;
        nh = targetH;
        // Wenn n-Corner (oben): y entsprechend mitziehen
        if (d.corner === "nw" || d.corner === "ne") {
          ny -= diffH;
        }
      } else {
        const targetW = nh * targetWHRatio;
        const diffW = targetW - nw;
        nw = targetW;
        if (d.corner === "nw" || d.corner === "sw") {
          nx -= diffW;
        }
      }
      setCrop(clampCrop({ x: nx, y: ny, width: nw, height: nh }, containerRatio, aspectRatio));
    },
    [aspectRatio, containerRatio, containerSize]
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  // Crop in Display-Pixel umrechnen
  const px = {
    left: crop.x * containerSize.w,
    top: crop.y * containerSize.h,
    width: crop.width * containerSize.w,
    height: crop.height * containerSize.h,
  };

  return (
    <div className="relative w-full" style={{ maxHeight: maxHeightPx }}>
      <div
        ref={containerRef}
        className="relative w-full select-none touch-none"
        style={{
          aspectRatio: `${imageWidth} / ${imageHeight}`,
          maxHeight: maxHeightPx,
          margin: "0 auto",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
          draggable={false}
        />
        {/* Backdrop-Overlay — vier Streifen ausserhalb des Crop */}
        {containerSize.w > 0 && (
          <>
            <div
              className="absolute bg-black/55 pointer-events-none"
              style={{ left: 0, top: 0, right: 0, height: px.top }}
            />
            <div
              className="absolute bg-black/55 pointer-events-none"
              style={{
                left: 0,
                top: px.top,
                width: px.left,
                height: px.height,
              }}
            />
            <div
              className="absolute bg-black/55 pointer-events-none"
              style={{
                left: px.left + px.width,
                top: px.top,
                right: 0,
                height: px.height,
              }}
            />
            <div
              className="absolute bg-black/55 pointer-events-none"
              style={{
                left: 0,
                top: px.top + px.height,
                right: 0,
                bottom: 0,
              }}
            />

            {/* Crop-Frame */}
            <div
              className="absolute border-2 border-white shadow-lg cursor-move"
              style={{
                left: px.left,
                top: px.top,
                width: px.width,
                height: px.height,
                touchAction: "none",
              }}
              onPointerDown={startMove}
              onPointerMove={handlePointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              {/* Grid-Lines (Drittel-Regel) */}
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute left-1/3 top-0 bottom-0 border-l border-white/40" />
                <div className="absolute left-2/3 top-0 bottom-0 border-l border-white/40" />
                <div className="absolute top-1/3 left-0 right-0 border-t border-white/40" />
                <div className="absolute top-2/3 left-0 right-0 border-t border-white/40" />
              </div>
              {/* Resize-Handles */}
              <ResizeHandle position="nw" onStart={startResize("nw")} onMove={handlePointerMove} onEnd={endDrag} />
              <ResizeHandle position="ne" onStart={startResize("ne")} onMove={handlePointerMove} onEnd={endDrag} />
              <ResizeHandle position="sw" onStart={startResize("sw")} onMove={handlePointerMove} onEnd={endDrag} />
              <ResizeHandle position="se" onStart={startResize("se")} onMove={handlePointerMove} onEnd={endDrag} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ResizeHandle({
  position,
  onStart,
  onMove,
  onEnd,
}: {
  position: "nw" | "ne" | "sw" | "se";
  onStart: (e: React.PointerEvent) => void;
  onMove: (e: React.PointerEvent) => void;
  onEnd: () => void;
}) {
  const pos: Record<string, string> = {
    nw: "-top-1.5 -left-1.5 cursor-nwse-resize",
    ne: "-top-1.5 -right-1.5 cursor-nesw-resize",
    sw: "-bottom-1.5 -left-1.5 cursor-nesw-resize",
    se: "-bottom-1.5 -right-1.5 cursor-nwse-resize",
  };
  return (
    <div
      className={`absolute w-3.5 h-3.5 bg-white border border-gray-600 shadow ${pos[position]}`}
      style={{ touchAction: "none" }}
      onPointerDown={onStart}
      onPointerMove={onMove}
      onPointerUp={onEnd}
      onPointerCancel={onEnd}
    />
  );
}
