/**
 * Lumio API — File-Kind-Detection
 *
 * Bestimmt aus Dateinamen + MIME-Type, in welche Worker-Pipeline ein File
 * gehört. Bewusst defensiv: zuerst Extension prüfen (Browser-MIME-Types
 * sind unzuverlässig, besonders bei RAW).
 */

export type FileKind = "image" | "raw" | "video" | "other";

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

const IMAGE_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "webp", "avif", "gif",
  "tiff", "tif", "heic", "heif", "psd",
]);

export function detectFileKind(
  filename: string,
  mimeType?: string
): FileKind {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (RAW_EXTENSIONS.has(ext)) return "raw";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";

  // Fallback auf MIME-Type, falls Extension unbekannt
  if (mimeType) {
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("image/")) return "image";
  }
  return "other";
}
