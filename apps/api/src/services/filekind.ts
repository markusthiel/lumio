/**
 * Lumio API — File-Kind-Detection
 *
 * Bestimmt aus Dateinamen + MIME-Type, in welche Worker-Pipeline ein File
 * gehört. Bewusst defensiv: zuerst Extension prüfen (Browser-MIME-Types
 * sind unzuverlässig, besonders bei RAW und HEIC).
 *
 * Warum HEIC eine eigene Variante kriegt (nicht einfach "image"):
 *
 * 1) iPhones liefern HEIC standardmäßig. Das ist mittlerweile so verbreitet,
 *    dass eine eigene Klassifikation sinnvoll ist — analog zu wie wir RAW
 *    von normalen JPEGs trennen, obwohl beide letztlich "Bilder" sind.
 *
 * 2) HEIC ist auf Windows ohne Codec-Pack nicht öffenbar (anders als JPEG
 *    oder PNG). Im Download-Flow können wir den Kunden vorwarnen oder
 *    automatisch die JPEG-Web-Rendition statt des Originals liefern. Diese
 *    Logik braucht die Information "ist HEIC" pro File.
 *
 * 3) Im Studio-UI hilft das HEIC-Badge dem Fotografen zu erkennen, was vom
 *    iPhone kam — relevant z.B. wenn der Client eine bestimmte Farbprofil-
 *    Behandlung erwartet.
 *
 * Die Worker-Pipeline behandelt HEIC weiterhin wie ein normales Bild (libvips
 * liest es transparent via libheif). Wir brauchen keinen eigenen Worker-Task,
 * nur eine eigene Klassifikation hier oben.
 */

export type FileKind = "image" | "heic" | "raw" | "video" | "pdf" | "other";

const RAW_EXTENSIONS = new Set([
  "cr2", "cr3", "crw",       // Canon
  "nef", "nrw",              // Nikon
  "arw", "srf", "sr2",       // Sony
  "raf",                     // Fujifilm
  "dng",                     // Adobe DNG
  "orf",                     // Olympus
  "pef", "ptx",              // Pentax
  "rw2",                     // Panasonic
  "x3f",                     // Sigma
  "3fr", "fff",              // Hasselblad
  "iiq",                     // Phase One
  "mef",                     // Mamiya
  "mrw",                     // Minolta
  "erf",                     // Epson
]);

const VIDEO_EXTENSIONS = new Set([
  "mp4", "m4v", "mov", "avi", "mkv", "webm", "wmv", "flv", "mts", "m2ts",
]);

// HEIC-Familie: vom iPhone (.heic), Android-HEIF (.heif), und die selteneren
// Sequence-Container (.heics für Live-Photos und .heifs).
const HEIC_EXTENSIONS = new Set(["heic", "heif", "heics", "heifs"]);

const IMAGE_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "webp", "avif", "gif",
  "tiff", "tif", "psd",
]);

// MIME-Types, die wir als HEIC erkennen wollen. Browser sind hier
// inkonsistent: Safari schickt "image/heic", manche Android-Apps
// "image/heif", manche Dropbox-Sync-Tools "image/heic-sequence". Wir
// matchen daher auf den Prefix.
const HEIC_MIME_PREFIX = ["image/heic", "image/heif"];

export function detectFileKind(
  filename: string,
  mimeType?: string
): FileKind {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "pdf";
  if (RAW_EXTENSIONS.has(ext)) return "raw";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (HEIC_EXTENSIONS.has(ext)) return "heic";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";

  // Fallback auf MIME-Type, falls Extension unbekannt — vor allem
  // bei HEIC wichtig, weil iOS-Uploads manchmal generische Filenames
  // wie "image.jpg" mit MIME "image/heic" produzieren (Sync-Apps).
  if (mimeType) {
    const lower = mimeType.toLowerCase();
    if (HEIC_MIME_PREFIX.some((p) => lower.startsWith(p))) return "heic";
    if (lower === "application/pdf") return "pdf";
    if (lower.startsWith("video/")) return "video";
    if (lower.startsWith("image/")) return "image";
  }
  return "other";
}
