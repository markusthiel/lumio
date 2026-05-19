/**
 * @lumio/shared — Shared types and Zod schemas used by API and Frontend.
 */
import { z } from "zod";

// -----------------------------------------------------------------------------
// Enums
// -----------------------------------------------------------------------------
export const GalleryMode = z.enum(["collaboration", "presentation"]);
export type GalleryMode = z.infer<typeof GalleryMode>;

export const GalleryStatus = z.enum(["draft", "live", "archived"]);
export type GalleryStatus = z.infer<typeof GalleryStatus>;

export const FileKind = z.enum(["image", "raw", "video", "other"]);
export type FileKind = z.infer<typeof FileKind>;

export const FileStatus = z.enum(["uploading", "processing", "ready", "failed"]);
export type FileStatus = z.infer<typeof FileStatus>;

export const SelectionColor = z.enum(["red", "yellow", "green"]);
export type SelectionColor = z.infer<typeof SelectionColor>;

export const RenditionKind = z.enum([
  "thumb",
  "preview",
  "web",
  "watermarked",
  "download",
  "hls",
  "poster",
  "sprite",
]);
export type RenditionKind = z.infer<typeof RenditionKind>;

// -----------------------------------------------------------------------------
// File-Type-Detection
// -----------------------------------------------------------------------------
export const RAW_EXTENSIONS = [
  "cr2", "cr3", "crw",      // Canon
  "nef", "nrw",             // Nikon
  "arw", "srf", "sr2",      // Sony
  "raf",                    // Fujifilm
  "dng",                    // Adobe DNG
  "orf",                    // Olympus
  "pef", "ptx",             // Pentax
  "rw2", "raw",             // Panasonic
  "x3f",                    // Sigma
  "3fr", "fff",             // Hasselblad
  "iiq",                    // Phase One
  "mef",                    // Mamiya
  "mrw",                    // Minolta
  "erf",                    // Epson
] as const;

export const VIDEO_EXTENSIONS = [
  "mp4", "m4v", "mov", "avi", "mkv", "webm", "wmv", "flv", "mts", "m2ts",
] as const;

export const IMAGE_EXTENSIONS = [
  "jpg", "jpeg", "png", "webp", "avif", "gif", "tiff", "tif", "heic", "heif", "psd",
] as const;

export function detectFileKind(filename: string): FileKind {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (RAW_EXTENSIONS.includes(ext as (typeof RAW_EXTENSIONS)[number])) return "raw";
  if (VIDEO_EXTENSIONS.includes(ext as (typeof VIDEO_EXTENSIONS)[number])) return "video";
  if (IMAGE_EXTENSIONS.includes(ext as (typeof IMAGE_EXTENSIONS)[number])) return "image";
  return "other";
}

// -----------------------------------------------------------------------------
// API DTOs
// -----------------------------------------------------------------------------
export const HealthResponse = z.object({
  status: z.literal("ok"),
  service: z.string(),
  version: z.string(),
  mode: z.enum(["single", "multi"]),
  storage: z.string(),
  billing: z.boolean(),
  timestamp: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
