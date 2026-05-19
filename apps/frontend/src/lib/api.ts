/**
 * Lumio Frontend — API Client
 */

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------
export type ApiUser = {
  id: string;
  email: string;
  name: string | null;
  role: "owner" | "admin" | "member";
  tenantId?: string;
  totpEnabled?: boolean;
};

export type GalleryMode = "collaboration" | "presentation";
export type GalleryStatus = "draft" | "live" | "archived";
export type FileStatus = "uploading" | "processing" | "ready" | "failed";
export type FileKind = "image" | "raw" | "video" | "other";

export interface Gallery {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  mode: GalleryMode;
  status: GalleryStatus;
  downloadEnabled: boolean;
  watermarkEnabled: boolean;
  fileCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface GalleryFile {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  kind: FileKind;
  status: FileStatus;
  width: number | null;
  height: number | null;
  sortIndex: number;
  createdAt: string;
  thumbUrl: string | null;
}

export interface GalleryDetail extends Gallery {
  files: GalleryFile[];
}

export interface UploadInit {
  fileId: string;
  method: "single" | "multipart";
  uploadUrl?: string;
  uploadId?: string;
  partSize?: number;
  totalParts?: number;
  parts?: { partNumber: number; uploadUrl: string }[];
  headers?: Record<string, string>;
}

// -----------------------------------------------------------------------------
// Core request
// -----------------------------------------------------------------------------
class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    ...init,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(
      data?.message ?? data?.error ?? `HTTP ${res.status}`,
      res.status,
      data?.error
    );
  }
  return data as T;
}

// -----------------------------------------------------------------------------
// API surface
// -----------------------------------------------------------------------------
export const api = {
  // Auth
  health: () => fetch(`${API_URL}/health`).then((r) => r.json()),
  login: (email: string, password: string) =>
    request<{ user: ApiUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  me: () => request<{ user: ApiUser }>("/auth/me"),

  // Galleries
  listGalleries: () =>
    request<{ galleries: Gallery[] }>("/galleries"),

  createGallery: (input: {
    title: string;
    description?: string;
    mode?: GalleryMode;
    downloadEnabled?: boolean;
    watermarkEnabled?: boolean;
  }) =>
    request<{ gallery: Gallery }>("/galleries", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  getGallery: (id: string) =>
    request<{ gallery: GalleryDetail }>(`/galleries/${id}`),

  updateGallery: (id: string, patch: Partial<Gallery>) =>
    request<{ gallery: Gallery }>(`/galleries/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  deleteGallery: (id: string) =>
    request<void>(`/galleries/${id}`, { method: "DELETE" }),

  // Uploads
  initUpload: (
    galleryId: string,
    files: Array<{ filename: string; sizeBytes: number; mimeType: string }>
  ) =>
    request<{ galleryId: string; uploads: UploadInit[] }>("/uploads/init", {
      method: "POST",
      body: JSON.stringify({ galleryId, files }),
    }),

  completeUpload: (input: {
    fileId: string;
    parts?: { partNumber: number; eTag: string }[];
    uploadId?: string;
  }) =>
    request<{ fileId: string; status: FileStatus }>("/uploads/complete", {
      method: "POST",
      headers: input.uploadId ? { "x-upload-id": input.uploadId } : {},
      body: JSON.stringify({
        fileId: input.fileId,
        parts: input.parts,
      }),
    }),
};

export { API_URL, ApiError };
