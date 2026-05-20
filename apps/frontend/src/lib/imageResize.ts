/**
 * Client-Side Bild-Optimierung vor S3-Upload.
 *
 * Hero- und Logo-Uploads sind im Frontend gepicked und gehen direkt
 * zu S3 (presigned PUT). Wenn der Studio-User ein 24-MP-JPEG aus
 * Lightroom uploadet, sind das schnell 8-15 MB die durch die Leitung
 * müssen — unnötig, weil der Hero im Customer-View eh nur max ~2560px
 * breit dargestellt wird, und ein Logo selten über 600px hoch ist.
 *
 * Diese Funktion macht das Resize auf eine vernünftige Zielgröße und
 * encodiert als JPEG (oder PNG bei transparenten Logos). Verlustfreie
 * Pipeline ist nicht das Ziel — Customer-View ist eine Web-Anzeige
 * und JPEG-Q85 ist visuell verlustfrei für Hero-Banners.
 *
 * Eingangs-Formate: alles was der Browser via createImageBitmap
 * versteht (JPEG, PNG, WebP, GIF — auf Modernen-Browsern auch HEIC
 * auf iOS Safari). Wenn das Decoding fehlschlägt, fällt der Caller
 * auf den unveränderten Original-File zurück (siehe try/catch im
 * Caller).
 */

export interface ResizeOptions {
  /** Maximale Breite in Pixel. Bild wird proportional skaliert wenn breiter. */
  maxWidth: number;
  /** Maximale Höhe in Pixel. */
  maxHeight: number;
  /** Ziel-MIME-Type. "image/jpeg" für Hero, "image/png" wenn das
   *  Original transparent ist (z.B. Logos). */
  mimeType?: "image/jpeg" | "image/png" | "image/webp";
  /** JPEG/WebP-Qualität 0-1, irrelevant bei PNG. */
  quality?: number;
}

const RESIZE_PRESETS: Record<"hero" | "logo", ResizeOptions> = {
  // Hero: 2560px reicht für 4K-Retina-Displays (DPR 2 auf 1280px Hero).
  // Höher zu gehen wäre Bandbreite verbrennen.
  hero: { maxWidth: 2560, maxHeight: 2560, mimeType: "image/jpeg", quality: 0.85 },
  // Logo: 800px ist großzügig — meist viel kleiner dargestellt (h-16 ~ 64px).
  // Wir behalten PNG-Transparency wenn das Original PNG ist.
  logo: { maxWidth: 800, maxHeight: 800, mimeType: "image/png" },
};

/** Hilfsfunktion: rechnet das größere von (w/maxW, h/maxH) als Skalierungsfaktor. */
function computeTargetSize(
  srcW: number,
  srcH: number,
  maxW: number,
  maxH: number
): { w: number; h: number; needsResize: boolean } {
  const scale = Math.min(maxW / srcW, maxH / srcH, 1);
  return {
    w: Math.round(srcW * scale),
    h: Math.round(srcH * scale),
    needsResize: scale < 1,
  };
}

/**
 * Resized eine Image-File auf eine Zielgröße. Wenn das Original
 * bereits klein genug ist, gibt es das Original 1:1 zurück (kein
 * Quality-Loss durch re-encoding).
 *
 * Returnt einen NEUEN File (oder den Original-File wenn keine
 * Änderung nötig). Caller kann das Ergebnis direkt zu S3 PUTten.
 */
export async function resizeImage(
  source: File,
  preset: "hero" | "logo"
): Promise<File> {
  const opts = RESIZE_PRESETS[preset];

  // Wenn das File schon klein ist, sparen wir uns das Re-Encoding.
  // Limit: 1.5 MB für Logo, 4 MB für Hero. Darunter ist Re-Encoding
  // selten ein Gewinn, weil JPEG-Encoding bei kleinen Bildern fast
  // nichts mehr einspart und PNG-Logos eh schon optimal sind.
  const fastPassLimit = preset === "logo" ? 1.5 * 1024 * 1024 : 4 * 1024 * 1024;
  if (source.size < fastPassLimit) {
    // Selbst dann checken wir noch ob die Pixel-Dimensionen unter
    // dem Preset liegen — z.B. ein 8000×4000 PNG kann unter 4MB
    // sein und sollte trotzdem runtergerechnet werden.
    try {
      const probe = await loadImageBitmap(source);
      if (
        probe.width <= opts.maxWidth &&
        probe.height <= opts.maxHeight
      ) {
        probe.close();
        return source;
      }
      probe.close();
    } catch {
      // Konnte nicht dekodieren — Fast-Pass-Pfad lassen wir laufen,
      // der Caller bekommt das Original und der S3-Limit-Check
      // (10MB Backend-Side) entscheidet.
      return source;
    }
  }

  const bitmap = await loadImageBitmap(source);
  const target = computeTargetSize(
    bitmap.width,
    bitmap.height,
    opts.maxWidth,
    opts.maxHeight
  );

  // Canvas in einer Off-Screen-Variante falls verfügbar (etwas
  // schneller, blockt den Main-Thread nicht). Browser ohne
  // OffscreenCanvas-Support fallen auf normales <canvas>.
  const canvas: HTMLCanvasElement | OffscreenCanvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(target.w, target.h)
      : Object.assign(document.createElement("canvas"), {
          width: target.w,
          height: target.h,
        });
  const ctx = (canvas as HTMLCanvasElement).getContext("2d");
  if (!ctx) {
    bitmap.close();
    return source;
  }
  // Hochwertige Skalierung. Nicht alle Browser respektieren das,
  // aber wenn doch ist's deutlich besser als Nearest-Neighbor.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, target.w, target.h);
  bitmap.close();

  // PNG-Erhalt für Logos mit Transparenz: wenn das Original ein PNG
  // ist und der Logo-Preset gewählt wurde, behalten wir PNG. Sonst
  // JPEG (kleiner, kein Alpha-Bedarf bei Heros).
  const useMime =
    preset === "logo" && source.type === "image/png"
      ? "image/png"
      : opts.mimeType ?? "image/jpeg";
  const quality = useMime === "image/png" ? undefined : opts.quality ?? 0.85;

  const blob =
    canvas instanceof OffscreenCanvas
      ? await canvas.convertToBlob({ type: useMime, quality })
      : await canvasToBlob(canvas as HTMLCanvasElement, useMime, quality);
  if (!blob) return source;

  // Neuen File-Namen behalten, aber Endung an das tatsächliche
  // MIME-Format anpassen. Sonst hat man "logo.heic" mit Inhalt JPEG.
  const ext = useMime === "image/png" ? "png" : "jpg";
  const baseName = source.name.replace(/\.[^.]+$/, "");
  return new File([blob], `${baseName}.${ext}`, { type: useMime });
}

async function loadImageBitmap(source: File): Promise<ImageBitmap> {
  // createImageBitmap kann direkt ein File annehmen. Vorteil
  // gegenüber dem URL.createObjectURL-+-Image-Pattern: kein
  // Memory-Leak, kein onload-Handler, schneller.
  return await createImageBitmap(source);
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality?: number
): Promise<Blob | null> {
  return new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), mime, quality)
  );
}
