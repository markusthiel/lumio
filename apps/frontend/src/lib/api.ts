/**
 * Lumio Frontend — API Client
 *
 * API_URL ist normalerweise leer, weil Frontend und API hinter demselben
 * Caddy laufen — alle /api/v1/...-Calls gehen damit automatisch an denselben
 * Origin wie das Frontend. Bei einem Split-Deployment (API auf anderer
 * Domain) kann NEXT_PUBLIC_API_URL gesetzt werden, dann wird absolut
 * adressiert.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

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
  backupCodesRemaining?: number;
};

export type GalleryMode = "collaboration" | "presentation";
export type GalleryStatus = "draft" | "live" | "archived";
export type FileStatus = "uploading" | "processing" | "ready" | "failed" | "hidden";
export type FileKind = "image" | "raw" | "video" | "other";
export type ZipStatus = "pending" | "building" | "ready" | "failed";

export interface Gallery {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  mode: GalleryMode;
  status: GalleryStatus;
  downloadEnabled: boolean;
  watermarkEnabled: boolean;
  commentsEnabled: boolean;
  brandingId?: string | null;
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
// Public Gallery (Kunden-Sicht)
// -----------------------------------------------------------------------------
export interface PublicGalleryMeta {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  mode: GalleryMode;
  downloadEnabled: boolean;
  watermarkEnabled: boolean;
  commentsEnabled: boolean;
  ratingsEnabled: boolean;
  requiresPassword: boolean;
  unlocked: boolean;
  branding: Branding | null;
}

export interface Branding {
  id: string;
  name: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  accentColor: string;
  fontFamily: string;
  introText: string | null;
  footerText: string | null;
  customCss: string | null;
}

export interface PublicFile {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  kind: FileKind;
  width: number | null;
  height: number | null;
  thumbUrl: string | null;
  previewUrl: string | null;
  webUrl: string | null;
  hlsUrl: string | null;
  previewWidth: number | null;
  previewHeight: number | null;
}

export interface MySelection {
  color: "red" | "yellow" | "green" | null;
  rating: number | null;
  liked: boolean;
}

// -----------------------------------------------------------------------------
// Access (Studio-seitig)
// -----------------------------------------------------------------------------
export interface GalleryAccess {
  id: string;
  label: string;
  email: string | null;
  token: string;
  canDownload: boolean;
  canComment: boolean;
  canSelect: boolean;
  canSeeOthers: boolean;
  expiresAt: string | null;
  lastAccessAt: string | null;
  accessCount: number;
  createdAt: string;
}

// -----------------------------------------------------------------------------
// Comments
// -----------------------------------------------------------------------------
export interface Comment {
  id: string;
  authorLabel: string;
  authorIsStudio: boolean;
  body: string;
  annotation: unknown;
  parentId: string | null;
  createdAt: string;
}

// -----------------------------------------------------------------------------
// API surface
// -----------------------------------------------------------------------------
export const api = {
  // Auth
  health: () => fetch(`${API_URL}/health`).then((r) => r.json()),
  login: (email: string, password: string) =>
    request<
      | { user: ApiUser }
      | { requiresTotp: true; challenge: string }
    >("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  loginTotp: (challenge: string, token: string) =>
    request<{ user: ApiUser }>("/auth/login/totp", {
      method: "POST",
      body: JSON.stringify({ challenge, token }),
    }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  me: () => request<{ user: ApiUser }>("/auth/me"),

  setupTotp: () =>
    request<{ qrDataUrl: string; otpauthUri: string }>("/auth/totp/setup", {
      method: "POST",
    }),
  activateTotp: (token: string) =>
    request<{ backupCodes: string[] }>("/auth/totp/activate", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  disableTotp: (token: string) =>
    request<{ ok: true }>("/auth/totp/disable", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),

  // Galleries (Studio)
  listGalleries: () => request<{ galleries: Gallery[] }>("/galleries"),

  createGallery: (input: {
    title: string;
    description?: string;
    mode?: GalleryMode;
    downloadEnabled?: boolean;
    watermarkEnabled?: boolean;
    templateId?: string;
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

  bulkFileAction: (input: {
    galleryId: string;
    fileIds: string[];
    action: "delete" | "hide" | "show";
  }) =>
    request<{ affected: number }>(`/files/bulk-action`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  // Access Tokens (Studio)
  listAccesses: (galleryId: string) =>
    request<{ accesses: GalleryAccess[] }>(
      `/galleries/${galleryId}/access`
    ),

  createAccess: (
    galleryId: string,
    input: {
      label: string;
      email?: string;
      canDownload?: boolean;
      canComment?: boolean;
      canSelect?: boolean;
      canSeeOthers?: boolean;
      expiresAt?: string;
    }
  ) =>
    request<{ access: GalleryAccess }>(
      `/galleries/${galleryId}/access`,
      { method: "POST", body: JSON.stringify(input) }
    ),

  deleteAccess: (galleryId: string, accessId: string) =>
    request<void>(`/galleries/${galleryId}/access/${accessId}`, {
      method: "DELETE",
    }),

  setPassword: (galleryId: string, password: string) =>
    request<{ ok: true }>(`/galleries/${galleryId}/password`, {
      method: "PUT",
      body: JSON.stringify({ password }),
    }),

  clearPassword: (galleryId: string) =>
    request<{ ok: true }>(`/galleries/${galleryId}/password`, {
      method: "DELETE",
    }),

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

  // Public Gallery (Kunden-Sicht)
  getPublicGallery: (slug: string) =>
    request<{ gallery: PublicGalleryMeta }>(`/g/${slug}`),

  unlockGallery: (
    slug: string,
    input: { password?: string; token?: string }
  ) =>
    request<{ ok: true; hasAccessToken: boolean }>(`/g/${slug}/unlock`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  listPublicFiles: (slug: string) =>
    request<{
      files: PublicFile[];
      mySelections: Record<string, MySelection>;
      finalizedAt: string | null;
    }>(`/g/${slug}/files`),

  finalizeSelection: (slug: string) =>
    request<{ ok: true; count: number; finalizedAt: string }>(
      `/g/${slug}/finalize`,
      { method: "POST" }
    ),

  // Proofing (Kunden-Sicht)
  setSelection: (
    slug: string,
    fileId: string,
    sel: Partial<MySelection & { status: "pick" | "reject" | "maybe" | null }>
  ) =>
    request<{ selection: unknown }>(
      `/g/${slug}/files/${fileId}/selection`,
      { method: "PUT", body: JSON.stringify(sel) }
    ),

  clearSelection: (slug: string, fileId: string) =>
    request<void>(`/g/${slug}/files/${fileId}/selection`, {
      method: "DELETE",
    }),

  listComments: (slug: string, fileId: string) =>
    request<{ comments: Comment[] }>(
      `/g/${slug}/files/${fileId}/comments`
    ),

  postComment: (
    slug: string,
    fileId: string,
    body: string,
    authorLabel?: string
  ) =>
    request<{ comment: Comment }>(
      `/g/${slug}/files/${fileId}/comments`,
      { method: "POST", body: JSON.stringify({ body, authorLabel }) }
    ),

  // Public download URL (für href, kein fetch — Browser folgt der Redirect)
  publicDownloadUrl: (slug: string, fileId: string) =>
    `${API_URL}/api/v1/g/${slug}/files/${fileId}/download`,

  // ZIP-Downloads
  requestZipAll: (slug: string) =>
    request<{ id: string; status: ZipStatus }>(
      `/g/${slug}/download/zip`,
      { method: "POST" }
    ),

  requestZipSelection: (slug: string) =>
    request<{ id: string; status: ZipStatus; fileCount: number }>(
      `/g/${slug}/download/selection`,
      { method: "POST" }
    ),

  getZipStatus: (slug: string, zipId: string) =>
    request<{
      id: string;
      status: ZipStatus;
      fileCount: number;
      sizeBytes: number | null;
      errorMessage: string | null;
      expiresAt: string;
    }>(`/g/${slug}/download/zip/${zipId}`),

  zipDownloadUrl: (slug: string, zipId: string) =>
    `${API_URL}/api/v1/g/${slug}/download/zip/${zipId}?download=1`,

  // Studio Proofing Exports
  getProofingSummary: (galleryId: string) =>
    request<ProofingSummary>(`/galleries/${galleryId}/export/summary`),

  csvExportUrl: (galleryId: string) =>
    `${API_URL}/api/v1/galleries/${galleryId}/export/csv`,

  xmpExportUrl: (galleryId: string) =>
    `${API_URL}/api/v1/galleries/${galleryId}/export/xmp`,

  // Tenant Settings
  getTenantSettings: () =>
    request<{ tenant: TenantSettings }>(`/settings`),

  updateTenantSettings: (patch: {
    watermarkText?: string | null;
    customDomain?: string | null;
  }) =>
    request<{ tenant: TenantSettings }>(`/settings`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  initWatermarkImageUpload: (input: {
    contentType: string;
    sizeBytes: number;
  }) =>
    request<{
      key: string;
      uploadUrl: string;
      headers: Record<string, string>;
    }>(`/settings/watermark-image`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  completeWatermarkImageUpload: (key: string) =>
    request<{ ok: true; key: string }>(
      `/settings/watermark-image/complete`,
      { method: "POST", body: JSON.stringify({ key }) }
    ),

  deleteWatermarkImage: () =>
    request<{ ok: true }>(`/settings/watermark-image`, { method: "DELETE" }),

  // Brandings
  listBrandings: () =>
    request<{ brandings: BrandingDetail[]; defaultBrandingId: string | null }>(
      `/brandings`
    ),

  createBranding: (input: {
    name: string;
    primaryColor?: string;
    accentColor?: string;
    fontFamily?: string;
    introText?: string | null;
    footerText?: string | null;
    customCss?: string | null;
  }) =>
    request<{ branding: BrandingDetail }>(`/brandings`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  getBranding: (id: string) =>
    request<{ branding: BrandingDetail }>(`/brandings/${id}`),

  updateBranding: (
    id: string,
    patch: Partial<{
      name: string;
      primaryColor: string;
      accentColor: string;
      fontFamily: string;
      introText: string | null;
      footerText: string | null;
      customCss: string | null;
    }>
  ) =>
    request<{ branding: BrandingDetail }>(`/brandings/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  deleteBranding: (id: string) =>
    request<void>(`/brandings/${id}`, { method: "DELETE" }),

  setDefaultBranding: (id: string) =>
    request<{ ok: true }>(`/brandings/${id}/default`, { method: "PUT" }),

  initBrandingAssetUpload: (
    id: string,
    input: {
      kind: "logo" | "favicon";
      contentType: string;
      sizeBytes: number;
    }
  ) =>
    request<{
      key: string;
      uploadUrl: string;
      headers: Record<string, string>;
    }>(`/brandings/${id}/assets`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  completeBrandingAssetUpload: (
    id: string,
    input: { kind: "logo" | "favicon"; key: string }
  ) =>
    request<{ branding: BrandingDetail }>(
      `/brandings/${id}/assets/complete`,
      { method: "POST", body: JSON.stringify(input) }
    ),

  deleteBrandingAsset: (id: string, kind: "logo" | "favicon") =>
    request<{ branding: BrandingDetail }>(
      `/brandings/${id}/assets/${kind}`,
      { method: "DELETE" }
    ),

  // Templates
  listTemplates: () =>
    request<{ templates: GalleryTemplate[] }>(`/templates`),

  createTemplate: (input: NewTemplateInput) =>
    request<{ template: GalleryTemplate }>(`/templates`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  getTemplate: (id: string) =>
    request<{ template: GalleryTemplate }>(`/templates/${id}`),

  updateTemplate: (id: string, patch: Partial<NewTemplateInput>) =>
    request<{ template: GalleryTemplate }>(`/templates/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  deleteTemplate: (id: string) =>
    request<void>(`/templates/${id}`, { method: "DELETE" }),
};

export interface GalleryTemplate {
  id: string;
  name: string;
  description: string | null;
  mode: GalleryMode;
  downloadEnabled: boolean;
  watermarkEnabled: boolean;
  commentsEnabled: boolean;
  ratingsEnabled: boolean;
  defaultExpiryDays: number | null;
  defaultDescription: string | null;
  brandingId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewTemplateInput {
  name: string;
  description?: string | null;
  mode?: GalleryMode;
  downloadEnabled?: boolean;
  watermarkEnabled?: boolean;
  commentsEnabled?: boolean;
  ratingsEnabled?: boolean;
  defaultExpiryDays?: number | null;
  defaultDescription?: string | null;
  brandingId?: string | null;
}

export interface BrandingDetail {
  id: string;
  name: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  accentColor: string;
  fontFamily: string;
  introText: string | null;
  footerText: string | null;
  customCss: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TenantSettings {
  id: string;
  slug: string;
  name: string;
  watermarkText: string | null;
  watermarkImageKey: string | null;
  customDomain?: string | null;
}

// -----------------------------------------------------------------------------
// Proofing Summary types
// -----------------------------------------------------------------------------
export interface ProofingSummary {
  gallery: { id: string; slug: string; title: string };
  totals: {
    fileCount: number;
    withRating: number;
    withLike: number;
    byLabel: Record<string, number>;
  };
  perAccess: Array<{
    label: string;
    picks: number;
    likes: number;
    comments: number;
  }>;
  files: Array<{
    fileId: string;
    filename: string;
    rating: number | null;
    label: string | null;
    liked: boolean;
    perAccess: Array<{
      accessLabel: string;
      color: string | null;
      rating: number | null;
      liked: boolean;
      status: string | null;
    }>;
  }>;
  fileCountTotal: number;
}

export { API_URL, ApiError };
