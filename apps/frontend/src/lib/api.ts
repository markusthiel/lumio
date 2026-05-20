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
export type FileKind = "image" | "heic" | "raw" | "video" | "other";
export type ZipStatus = "pending" | "building" | "ready" | "failed";

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface TagSummary extends Tag {
  parentId: string | null;
  galleryCount: number;
  fileCount: number;
}

export interface Gallery {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  mode: GalleryMode;
  status: GalleryStatus;
  downloadEnabled: boolean;
  downloadOriginalsEnabled: boolean;
  watermarkEnabled: boolean;
  commentsEnabled: boolean;
  selectionLimit: number | null;
  brandingId?: string | null;
  // Header-Customization (Studio kann das hier direkt sehen + editieren)
  heroFileId: string | null;
  heroUrl: string | null;
  heroOverlayColor: string | null;
  heroBackgroundColor: string | null;
  eventLogoUrl: string | null;
  welcomeMarkdown: string | null;
  heroLayout: "minimal" | "splash" | "side_by_side" | "centered";
  // Footer + Galerie-Farben
  footerMarkdown: string | null;
  colorBackground: string | null;
  colorAccent: string | null;
  // Galerie-Schriftarten (IDs aus dem Frontend-Katalog)
  fontHeading: string | null;
  fontBody: string | null;
  // Grid-Layout (masonry | justified | equal)
  gridLayout: "masonry" | "justified" | "equal";
  // Slideshow-Übergangseffekt
  slideshowTransition: "fade" | "slide" | "kenburns";
  // Slideshow-Hintergrund-Musik (S3-Storage-Key)
  slideshowAudioUrl: string | null;
  fileCount?: number;
  tags?: Tag[];
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
  errorMessage?: string | null;
  width: number | null;
  height: number | null;
  sortIndex: number;
  /** Optional einer Section zugeordnet (Galerie-Kapitel). Null =
   *  im Default-Bucket. */
  sectionId: string | null;
  createdAt: string;
  thumbUrl: string | null;
  tags?: Tag[];
}

export interface GalleryDetail extends Gallery {
  files: GalleryFile[];
  tags: Tag[];
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

export interface WebhookSummary {
  id: string;
  label: string;
  url: string;
  events: string[];
  active: boolean;
  lastDeliveryAt: string | null;
  lastDeliveryOk: boolean | null;
  createdAt: string;
}

export interface WebhookDelivery {
  id: string;
  eventType: string;
  status: "pending" | "sent" | "failed" | "dead";
  httpStatus: number | null;
  errorMessage: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
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
  // Default-Headers nur setzen, wenn sie sinnvoll sind:
  //   - Content-Type: application/json nur, wenn ein Body mitgeschickt
  //     wird. Sonst sieht der Server "Content-Type: json + Length: 0" und
  //     wirft FST_ERR_CTP_EMPTY_JSON_BODY (400 Bad Request) — was bisher
  //     z.B. requestZipAll/requestZipSelection bei jedem Klick auf
  //     "Alle herunterladen" hat scheitern lassen, ohne dass der Frontend-
  //     Code etwas davon mitbekommen hat.
  //
  // Wichtig: init MUSS vor headers stehen, damit unser zusammengeführtes
  // headers-Objekt nicht durch init.headers überschrieben wird, wenn der
  // Aufrufer eigene Headers mitgibt (z.B. x-upload-id beim Multipart-Complete).
  const hasBody =
    init.body !== undefined && init.body !== null && init.body !== "";
  const defaultHeaders: Record<string, string> = hasBody
    ? { "Content-Type": "application/json" }
    : {};
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    credentials: "include",
    ...init,
    headers: {
      ...defaultHeaders,
      ...(init.headers ?? {}),
    },
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
  downloadOriginalsEnabled: boolean;
  watermarkEnabled: boolean;
  commentsEnabled: boolean;
  ratingsEnabled: boolean;
  selectionLimit: number | null;
  requiresPassword: boolean;
  unlocked: boolean;
  branding: Branding | null;
  header: {
    /** Hero-Layout-Variante: bestimmt wie der Header gerendert wird. */
    layout: "minimal" | "splash" | "side_by_side" | "centered";
    /** Absoluter Presigned-S3-URL (Hero aus Galerie) ODER relativer
     *  Pfad /g/<slug>/assets/hero (Upload). Frontend kann das direkt
     *  als <img src> nutzen — relative Pfade landen auf der API. */
    heroImageUrl: string | null;
    /** Hex #RRGGBBAA für Overlay über dem Hero-Bild */
    overlayColor: string | null;
    /** Hex #RRGGBB für Background wenn kein Hero gesetzt */
    backgroundColor: string | null;
    /** Relativer Pfad /g/<slug>/assets/logo, wenn ein Event-Logo
     *  gesetzt ist. */
    eventLogoUrl: string | null;
    /** Markdown-Text für den Welcome-Block. Wenn null, wird nur die
     *  description angezeigt. */
    welcomeMarkdown: string | null;
  };
  /** Markdown für den Galerie-Footer (Dankeschön, Kontakt, Socials).
   *  Wenn null, wird der Tenant-Branding-Footer (falls vorhanden)
   *  angezeigt. */
  footerMarkdown: string | null;
  /** Galerie-spezifische Farb-Overrides. null = Branding gewinnt. */
  colors: {
    background: string | null;
    accent: string | null;
  };
  /** Galerie-spezifische Font-Overrides. IDs aus lib/fonts.ts. */
  fonts: {
    heading: string | null;
    body: string | null;
  };
  /** Grid-Layout für das File-Grid auf der Customer-Seite. */
  gridLayout: "masonry" | "justified" | "equal";
  /** Slideshow-Übergangseffekt. */
  slideshowTransition: "fade" | "slide" | "kenburns";
  /** Optionaler Hintergrund-Musik-URL für die Slideshow (relativer
   *  API-Pfad inkl. Cache-Buster). Null wenn keine Musik gesetzt. */
  slideshowAudioUrl: string | null;
  /** Galerie-Sections (Kapitel). Leeres Array wenn keine angelegt
   *  sind — Customer-View rendert dann klassisches Hauptraster. */
  sections: PublicSection[];
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

export interface SpriteSheet {
  url: string;
  interval: number;
  cols: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  frames: number;
}

export interface PublicFile {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  kind: FileKind;
  width: number | null;
  height: number | null;
  /** Section/Kapitel-Zugehörigkeit. Null = File ist im Default-
   *  Bucket der Galerie (oberhalb der Sections im Customer-View). */
  sectionId: string | null;
  thumbUrl: string | null;
  previewUrl: string | null;
  webUrl: string | null;
  hlsUrl: string | null;
  sprite: SpriteSheet | null;
  previewWidth: number | null;
  previewHeight: number | null;
}

/** Section/Kapitel einer Galerie. Customer-Sicht. */
export interface PublicSection {
  id: string;
  title: string;
  description: string | null;
  /** Cover-Thumb (presigned URL) oder null wenn keins gesetzt ist. */
  coverThumbUrl: string | null;
  sortIndex: number;
}

/** Section in der Studio-Sicht — wie Public, aber mit coverFileId
 *  (zum Editieren) und ohne Presigned-URL (Studio bekommt die Thumb-
 *  URL über die Files-Liste). Plus fileCount für UI. */
export interface StudioSection {
  id: string;
  title: string;
  description: string | null;
  coverFileId: string | null;
  sortIndex: number;
  fileCount: number;
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
      | {
          requiresTotp: boolean;
          requiresWebauthn: boolean;
          challenge: string;
        }
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

  // WebAuthn
  listWebauthnCredentials: () =>
    request<{ credentials: WebauthnCredential[] }>("/auth/webauthn"),
  webauthnRegisterStart: () =>
    request<{ options: unknown }>("/auth/webauthn/register/start", {
      method: "POST",
    }),
  webauthnRegisterFinish: (response: unknown, label: string) =>
    request<{ ok: true; credentialId: string }>(
      "/auth/webauthn/register/finish",
      {
        method: "POST",
        body: JSON.stringify({ response, label }),
      }
    ),
  webauthnLoginStart: (challenge: string) =>
    request<{ options: unknown; challengeId: string }>(
      "/auth/webauthn/login/start",
      {
        method: "POST",
        body: JSON.stringify({ challenge }),
      }
    ),
  webauthnLoginFinish: (challenge: string, challengeId: string, response: unknown) =>
    request<{ user: ApiUser }>("/auth/webauthn/login/finish", {
      method: "POST",
      body: JSON.stringify({ challenge, challengeId, response }),
    }),
  deleteWebauthnCredential: (id: string) =>
    request<{ ok: true }>(`/auth/webauthn/${id}`, { method: "DELETE" }),

  // API-Tokens (Plugins/CLI)
  listApiTokens: () =>
    request<{ tokens: ApiTokenSummary[] }>("/auth/tokens"),
  createApiToken: (name: string, expiresAt?: string | null) =>
    request<{
      token: string;
      id: string;
      name: string;
      createdAt: string;
    }>("/auth/tokens", {
      method: "POST",
      body: JSON.stringify({ name, expiresAt: expiresAt ?? null }),
    }),
  revokeApiToken: (id: string) =>
    request<{ ok: true }>(`/auth/tokens/${id}`, { method: "DELETE" }),

  // Webhooks (Studio, pro Tenant)
  listWebhooks: () =>
    request<{
      webhooks: WebhookSummary[];
      supportedEvents: readonly string[];
    }>("/webhooks"),

  createWebhook: (input: {
    label: string;
    url: string;
    events: string[];
    active?: boolean;
  }) =>
    request<{ webhook: WebhookSummary; secret: string }>("/webhooks", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updateWebhook: (id: string, patch: {
    label?: string;
    url?: string;
    events?: string[];
    active?: boolean;
  }) =>
    request<{ webhook: WebhookSummary }>(`/webhooks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  deleteWebhook: (id: string) =>
    request<void>(`/webhooks/${id}`, { method: "DELETE" }),

  testWebhook: (id: string) =>
    request<{
      ok: boolean;
      httpStatus?: number;
      errorMessage?: string;
    }>(`/webhooks/${id}/test`, { method: "POST" }),

  listWebhookDeliveries: (id: string) =>
    request<{ deliveries: WebhookDelivery[] }>(`/webhooks/${id}/deliveries`),

  // Galleries (Studio)
  listGalleries: (filter?: { tagIds?: string[] }) =>
    request<{ galleries: Gallery[] }>(
      filter?.tagIds && filter.tagIds.length > 0
        ? `/galleries?tag=${filter.tagIds.join(",")}`
        : "/galleries"
    ),

  // Tags
  listTags: () => request<{ tags: TagSummary[] }>("/tags"),
  createTag: (input: {
    name: string;
    color?: string;
    parentId?: string | null;
  }) =>
    request<{ tag: TagSummary }>("/tags", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateTag: (
    id: string,
    patch: { name?: string; color?: string; parentId?: string | null }
  ) =>
    request<{ tag: TagSummary }>(`/tags/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteTag: (id: string) =>
    request<void>(`/tags/${id}`, { method: "DELETE" }),

  assignTagToGallery: (galleryId: string, tagId: string) =>
    request<void>(`/galleries/${galleryId}/tags`, {
      method: "POST",
      body: JSON.stringify({ tagId }),
    }),
  removeTagFromGallery: (galleryId: string, tagId: string) =>
    request<void>(`/galleries/${galleryId}/tags/${tagId}`, {
      method: "DELETE",
    }),
  assignTagToFile: (fileId: string, tagId: string) =>
    request<void>(`/files/${fileId}/tags`, {
      method: "POST",
      body: JSON.stringify({ tagId }),
    }),
  removeTagFromFile: (fileId: string, tagId: string) =>
    request<void>(`/files/${fileId}/tags/${tagId}`, { method: "DELETE" }),

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

  getGalleryStats: (id: string) =>
    request<GalleryStats>(`/galleries/${id}/stats`),

  searchGlobal: (q: string, limit = 5) =>
    request<SearchResults>(
      `/search?q=${encodeURIComponent(q)}&limit=${limit}`
    ),

  updateGallery: (id: string, patch: Partial<Gallery>) =>
    request<{ gallery: Gallery }>(`/galleries/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  /**
   * Lädt ein Header-Asset (logo/hero) hoch. Zweistufig:
   *   1. POST /galleries/:id/assets/presign → liefert PUT-URL + storageKey
   *   2. Browser PUT direkt zu S3
   * Anschließend muss der Caller updateGallery mit eventLogoUrl bzw.
   * heroUrl = storageKey aufrufen, um das Asset persistent an die
   * Galerie zu binden.
   *
   * Vor dem Upload wird das Bild client-side resized:
   *   - Hero: max 2560×2560, JPEG-Q85 (oder Original wenn klein)
   *   - Logo: max 800×800, PNG-Erhalt für Transparenz
   * Spart Bandbreite und passt das Bild auf Display-Größen an.
   * Wenn das Resize-Decoding fehlschlägt, wird der Original-File
   * unverändert hochgeladen — Backend lehnt dann ggf. Files >10MB ab.
   */
  uploadGalleryAsset: async (
    galleryId: string,
    kind: "logo" | "hero" | "audio",
    file: File
  ): Promise<{ storageKey: string }> => {
    // Image-Assets vor Upload resizen. Audio (kind === 'audio') wird
    // unverändert hochgeladen — wir machen kein Transcoding hier;
    // moderne Browsers spielen MP3/AAC/OGG/Opus alle nativ.
    let optimized: File = file;
    if (kind === "logo" || kind === "hero") {
      try {
        const { resizeImage } = await import("./imageResize");
        optimized = await resizeImage(file, kind);
      } catch {
        // Decoding-Failure → Original verwenden. Backend-seitige
        // Größen-/Type-Limits fangen Edge-Cases ab.
        optimized = file;
      }
    }

    const presign = await request<{ uploadUrl: string; storageKey: string }>(
      `/galleries/${galleryId}/assets/presign`,
      {
        method: "POST",
        body: JSON.stringify({
          kind,
          contentType: optimized.type,
          contentLength: optimized.size,
        }),
      }
    );
    const putRes = await fetch(presign.uploadUrl, {
      method: "PUT",
      body: optimized,
      headers: { "Content-Type": optimized.type },
    });
    if (!putRes.ok) {
      throw new Error(`Upload failed (${putRes.status})`);
    }
    return { storageKey: presign.storageKey };
  },

  /** Public-URL für ein Galerie-Asset (für Customer-View und OG-Tags).
   *  Akzeptiert einen optionalen Cache-Buster (typisch der storageKey
   *  oder ein Teil davon) — wechselt der Key, wechselt die URL, und
   *  der Browser holt das neue Bild ohne 5-Minuten-Cache-Wartezeit. */
  galleryAssetUrl: (
    slug: string,
    kind: "logo" | "hero" | "audio",
    cacheBust?: string | null
  ) => {
    const base = `${API_URL}/api/v1/g/${slug}/assets/${kind}`;
    if (!cacheBust) return base;
    // Wir hashen client-side mit einem schnellen Hash, damit Studio-
    // Vorschau und Customer-URL denselben Wert produzieren. Das Studio
    // bekommt den storageKey vom Backend (gallery.heroUrl); kurze
    // Hash-Funktion reicht — keine kryptographische Anforderung, nur
    // "verschiedene Keys → verschiedene Hashes".
    let h = 0;
    for (let i = 0; i < cacheBust.length; i++) {
      h = ((h << 5) - h + cacheBust.charCodeAt(i)) | 0;
    }
    return `${base}?v=${(h >>> 0).toString(16)}`;
  },

  deleteGallery: (id: string) =>
    request<void>(`/galleries/${id}`, { method: "DELETE" }),

  // ---------------------------------------------------------------------------
  // Sections (Studio) — Kapitel-Verwaltung einer Galerie
  // ---------------------------------------------------------------------------
  listSections: (galleryId: string) =>
    request<{ sections: StudioSection[] }>(
      `/galleries/${galleryId}/sections`
    ),

  createSection: (
    galleryId: string,
    input: { title: string; description?: string | null; coverFileId?: string | null }
  ) =>
    request<{ section: StudioSection }>(
      `/galleries/${galleryId}/sections`,
      { method: "POST", body: JSON.stringify(input) }
    ),

  updateSection: (
    galleryId: string,
    sectionId: string,
    input: {
      title?: string;
      description?: string | null;
      coverFileId?: string | null;
      sortIndex?: number;
    }
  ) =>
    request<{ section: StudioSection }>(
      `/galleries/${galleryId}/sections/${sectionId}`,
      { method: "PATCH", body: JSON.stringify(input) }
    ),

  deleteSection: (galleryId: string, sectionId: string) =>
    request<{ ok: true }>(
      `/galleries/${galleryId}/sections/${sectionId}`,
      { method: "DELETE" }
    ),

  reorderSections: (galleryId: string, order: string[]) =>
    request<{ ok: true }>(
      `/galleries/${galleryId}/sections/reorder`,
      { method: "POST", body: JSON.stringify({ order }) }
    ),

  /** Bulk-Zuweisung: Files in eine Section verschieben. */
  assignFilesToSection: (
    galleryId: string,
    sectionId: string,
    fileIds: string[]
  ) =>
    request<{ assigned: number }>(
      `/galleries/${galleryId}/sections/${sectionId}/files`,
      { method: "POST", body: JSON.stringify({ fileIds }) }
    ),

  /** Bulk-Entfernen: Files aus ihren Sections in den Default-Bucket
   *  zurücklegen. */
  unassignFilesFromSection: (galleryId: string, fileIds: string[]) =>
    request<{ removed: number }>(
      `/galleries/${galleryId}/sections/files`,
      { method: "DELETE", body: JSON.stringify({ fileIds }) }
    ),

  bulkFileAction: (input: {
    galleryId: string;
    fileIds: string[];
    action: "delete" | "hide" | "show";
  }) =>
    request<{ affected: number }>(`/files/bulk-action`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  reorderFiles: (input: {
    galleryId: string;
    order: { id: string; sortIndex: number }[];
  }) =>
    request<{ affected: number }>(`/files/reorder`, {
      method: "PUT",
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
      canSelect: boolean;
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
    input: { body: string; authorLabel?: string; annotation?: unknown }
  ) =>
    request<{ comment: Comment }>(
      `/g/${slug}/files/${fileId}/comments`,
      { method: "POST", body: JSON.stringify(input) }
    ),

  // Public download URL (für href, kein fetch — Browser folgt der Redirect).
  // variant default "original"; passender Schalter im Customer-UI.
  publicDownloadUrl: (
    slug: string,
    fileId: string,
    variant: "original" | "web" = "original"
  ) =>
    `${API_URL}/api/v1/g/${slug}/files/${fileId}/download?variant=${variant}`,

  // ZIP-Downloads
  requestZipAll: (slug: string, variant: "original" | "web" = "original") =>
    request<{ id: string; status: ZipStatus }>(
      `/g/${slug}/download/zip?variant=${variant}`,
      { method: "POST" }
    ),

  requestZipSelection: (
    slug: string,
    variant: "original" | "web" = "original"
  ) =>
    request<{ id: string; status: ZipStatus; fileCount: number }>(
      `/g/${slug}/download/selection?variant=${variant}`,
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

  // Audit Log
  listAuditEvents: (params: {
    galleryId?: string;
    action?: string;
    since?: string;
    until?: string;
    limit?: number;
    cursor?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params.galleryId) qs.set("galleryId", params.galleryId);
    if (params.action) qs.set("action", params.action);
    if (params.since) qs.set("since", params.since);
    if (params.until) qs.set("until", params.until);
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.cursor) qs.set("cursor", params.cursor);
    return request<{ events: AuditEvent[]; nextCursor: string | null }>(
      `/events?${qs.toString()}`
    );
  },

  // ---------------------------------------------------------------------
  // Super-Admin (Plattform-Operatoren). Eigene Auth, eigener Cookie.
  // ---------------------------------------------------------------------
  superLogin: (email: string, password: string) =>
    request<{ admin: { id: string; email: string; displayName: string } }>(
      "/super/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }
    ),
  superLogout: () =>
    request<{ ok: true }>("/super/auth/logout", { method: "POST" }),
  superMe: () =>
    request<{
      admin: {
        id: string;
        email: string;
        displayName: string;
        lastLoginAt: string | null;
      };
    }>("/super/auth/me"),

  superStats: () =>
    request<{
      tenants: Record<string, number>;
      totalUsers: number;
      totalGalleries: number;
      totalFiles: number;
    }>("/super/stats"),

  superListTenants: () =>
    request<{ tenants: SuperTenantSummary[] }>("/super/tenants"),
  superGetTenant: (id: string) =>
    request<{ tenant: SuperTenantDetail }>(`/super/tenants/${id}`),

  superCreateTenant: (input: {
    slug: string;
    name: string;
    customDomain?: string | null;
    ownerEmail: string;
    ownerName: string;
  }) =>
    request<SuperTenantCreated>("/super/tenants", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  superUpdateTenant: (
    id: string,
    patch: { slug?: string; name?: string; customDomain?: string | null }
  ) =>
    request<{ tenant: SuperTenantSummary }>(`/super/tenants/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  superSuspendTenant: (id: string) =>
    request<{ tenant: SuperTenantSummary }>(`/super/tenants/${id}/suspend`, {
      method: "POST",
    }),
  superUnsuspendTenant: (id: string) =>
    request<{ tenant: SuperTenantSummary }>(`/super/tenants/${id}/unsuspend`, {
      method: "POST",
    }),
  superArchiveTenant: (id: string) =>
    request<{ tenant: SuperTenantSummary }>(`/super/tenants/${id}/archive`, {
      method: "POST",
    }),

  superInviteOwner: (
    tenantId: string,
    input: { email: string; name: string }
  ) =>
    request<{
      owner: { id: string; email: string; name: string; status: string };
      setup: { url: string; mailSent: boolean };
    }>(`/super/tenants/${tenantId}/owners`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  // ---------------------------------------------------------------------
  // Setup-Password (Tenant-Owner-Onboarding nach Einladungs-Mail)
  // ---------------------------------------------------------------------
  checkSetupToken: (token: string) =>
    request<{
      email: string;
      name: string | null;
      tenantName: string;
      expiresAt: string;
    }>(`/auth/setup-password/check?token=${encodeURIComponent(token)}`),

  setupPassword: (token: string, password: string) =>
    request<{
      ok: true;
      user: { id: string; email: string; name: string | null; role: string };
    }>("/auth/setup-password", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    }),
};

export interface SuperTenantSummary {
  id: string;
  slug: string;
  name: string;
  status: "active" | "suspended" | "archived";
  customDomain: string | null;
  createdAt: string;
  userCount: number;
  galleryCount: number;
}

export interface SuperTenantUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface SuperTenantDetail {
  id: string;
  slug: string;
  name: string;
  status: "active" | "suspended" | "archived";
  customDomain: string | null;
  createdAt: string;
  updatedAt: string;
  galleryCount: number;
  users: SuperTenantUser[];
}

export interface SuperTenantCreated {
  tenant: {
    id: string;
    slug: string;
    name: string;
    status: string;
    customDomain: string | null;
  };
  owner: { id: string; email: string; name: string | null; status: string };
  setup: { url: string; mailSent: boolean; expiresAt: string };
}

export interface AuditEvent {
  id: string;
  actorType: "user" | "access" | "system";
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  payload: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface WebauthnCredential {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface ApiTokenSummary {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

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

export interface GalleryStats {
  dailyVisits: Array<{ day: string; count: number }>;
  anonymousVisits: number;
  accessStats: Array<{
    accessId: string;
    label: string;
    visits: number;
    likes: number;
    comments: number;
    finalized: boolean;
  }>;
  topLikedFiles: Array<{
    fileId: string;
    filename: string;
    kind: string;
    likes: number;
  }>;
  downloadsByKind: Array<{ kind: string; count: number }>;
  downloadsTotal: number;
  dailyDownloads: Array<{ day: string; count: number }>;
}

export interface SearchResults {
  galleries: Array<{
    id: string;
    slug: string;
    title: string;
    status: string;
  }>;
  files: Array<{
    id: string;
    galleryId: string;
    gallerySlug: string;
    galleryTitle: string;
    filename: string;
    kind: string;
    status: string;
  }>;
  brandings: Array<{ id: string; name: string }>;
  templates: Array<{ id: string; name: string }>;
  truncated: boolean;
}

export { API_URL, ApiError };
