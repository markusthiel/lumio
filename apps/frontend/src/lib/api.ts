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
  gridLayout: "justified" | "equal";
  // Slideshow-Übergangseffekt
  slideshowTransition: "fade" | "slide" | "kenburns";
  // Slideshow-Hintergrund-Musik (S3-Storage-Key)
  slideshowAudioUrl: string | null;
  // Print-Shop-Override pro Galerie. null = uebernimmt Tenant-Default,
  // true = explizit aktiv, false = explizit ausgeblendet.
  printShopEnabled: boolean | null;
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
  /** Mittel-Größe-Rendition (web 2560px). Nur in der Studio-Galerie-
   *  Detail-Antwort gesetzt; wird für die Proofing-Detail-Ansicht
   *  benutzt, wo das Studio in voller Größe annotieren will. */
  webUrl?: string | null;
  tags?: Tag[];
  /** "studio" = vom Owner direkt hochgeladen.
   *  "upload_link" = von einem externen Uploader via /u/<token>. */
  uploadedVia?: "studio" | "upload_link";
  uploadLinkId?: string | null;
  /** "visible" = im Customer-View. "hidden" = nur Studio sieht es
   *  (Default für Upload-Link-Uploads bis zur Freigabe).
   *  "rejected" = vom Studio abgelehnt, S3-Objekte gelöscht. */
  publicVisibility?: "visible" | "hidden" | "rejected";
  /** Nur gesetzt wenn publicVisibility === "rejected". ISO-String. */
  rejectedAt?: string | null;
  /** Reject-Grund (max 500 chars, Freitext oder Preset-Label). */
  rejectedReason?: string | null;
}

/** Upload-Link: öffentlicher Drag-and-Drop-Endpunkt pro Galerie.
 *  Studio teilt die URL (mit Token), Empfänger laden hoch ohne Login. */
export interface UploadLink {
  id: string;
  token: string;
  label: string;
  active: boolean;
  hasPassword: boolean;
  /** Optional. null = unbegrenzt. */
  maxFiles: number | null;
  /** BigInt → string. null = unbegrenzt. */
  maxBytesTotal: string | null;
  /** Per-File-Limit für DIESEN Link in Bytes (string wegen BigInt).
   *  null = Tenant-Limit erben. */
  maxFileBytes: string | null;
  expiresAt: string | null;
  uploadCount: number;
  bytesUploaded: string;
  lastUploadAt: string | null;
  createdAt: string;
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
  gridLayout: "justified" | "equal";
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
  logoLightUrl: string | null;
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
  emails: string[];
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
  me: () =>
    request<{
      user: ApiUser;
      tenant: {
        id: string;
        name: string;
        slug: string;
        status: "active" | "suspended" | "archived" | "pending_deletion";
        archiveScheduledAt: string | null;
      } | null;
      /** Wenn nicht null: aktuelle Session ist Impersonate-Modus durch
       *  einen Super-Admin. Frontend zeigt einen Banner. */
      impersonation: {
        bySuperAdminEmail: string;
        bySuperAdminName: string | null;
        expiresAt: string;
      } | null;
      /** Aktive Feature-Flag-Keys fuer diesen Tenant. Frontend prueft
       *  z.B. features.includes('print_shop') bevor es Print-Shop-
       *  Eintraege rendert. */
      features: string[];
    }>("/auth/me"),

  /** Liefert Tenant-Info basierend auf dem aufgelösten Tenant (Host,
   *  Subdomain, Header). Funktioniert OHNE Login — wird auf der
   *  Login-Seite genutzt um den User darüber zu informieren bei
   *  welchem Studio er sich gerade anmeldet, plus optionales
   *  Default-Branding (Logo, Farben, Background, Greeting) für
   *  eine markenkonforme Login-Page. tenant: null wenn Apex ohne
   *  erkennbaren Tenant. */
  getTenantContext: () =>
    request<{
      tenant: {
        id: string;
        name: string;
        slug: string;
        status: "active" | "suspended" | "archived" | "pending_deletion";
      } | null;
      branding: {
        id: string;
        name: string;
        logoUrl: string | null;
        logoLightUrl: string | null;
        faviconUrl: string | null;
        primaryColor: string;
        accentColor: string;
        fontFamily: string;
        introText: string | null;
        footerText: string | null;
        customCss: string | null;
        loginBackgroundUrl: string | null;
        loginGreeting: string | null;
      } | null;
    }>("/auth/tenant-context"),

  /** Passwort-vergessen anstossen. Backend antwortet IMMER 200 (egal
   *  ob die E-Mail existiert), um User-Enumeration zu vermeiden. Die
   *  Mail kommt nur wenn der User aktiv + Tenant aktiv ist. Tenant
   *  wird ueber Host/Subdomain aufgeloest. */
  forgotPassword: (email: string) =>
    request<{ ok: true }>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  /** Reset-Token validieren (vor dem Submit). Liefert minimale Daten
   *  fuer die Reset-Page-UX. */
  checkResetToken: (token: string) =>
    request<{
      email: string;
      name: string | null;
      tenantName: string;
      expiresAt: string;
    }>(`/auth/reset-password/check?token=${encodeURIComponent(token)}`),

  /** Neues Passwort setzen. Im Erfolgsfall sind ALLE Sessions
   *  invalidiert; User muss sich neu einloggen. */
  resetPassword: (token: string, password: string) =>
    request<{ ok: true }>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    }),

  // Account-Self-Service (eigener Profil-Bereich)
  getAccount: () =>
    request<{
      user: {
        id: string;
        email: string;
        name: string | null;
        role: "owner" | "admin" | "member";
        status: string;
        totpEnabled: boolean;
        createdAt: string;
        lastLoginAt: string | null;
      };
      pendingEmailChange: {
        newEmail: string | undefined;
        expiresAt: string;
      } | null;
    }>("/account"),

  updateAccountName: (name: string) =>
    request<{ user: { id: string; email: string; name: string | null } }>(
      "/account",
      { method: "PATCH", body: JSON.stringify({ name }) }
    ),

  changeAccountPassword: (input: {
    currentPassword: string;
    newPassword: string;
  }) =>
    request<{ ok: true }>("/account/password", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  requestAccountEmailChange: (input: {
    currentPassword: string;
    newEmail: string;
  }) =>
    request<{ ok: true; newEmail: string }>("/account/email-change", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  cancelAccountEmailChange: () =>
    request<{ ok: true; cancelled: number }>("/account/email-change", {
      method: "DELETE",
    }),

  // ---------- Self-Service Tenant-Loeschung (DSGVO Art. 17) ----------

  /** Studio-Loeschung anfordern. Doppelte Bestaetigung:
   *  - aktuelles Passwort (Re-Auth)
   *  - Studio-Name exakt eingetippt (UI-side, hier nochmal Backend-side) */
  requestStudioDeletion: (input: {
    password: string;
    confirmStudioName: string;
  }) =>
    request<{ status: "scheduled" | "already_pending"; scheduledFor: string }>(
      "/account/delete-request",
      { method: "POST", body: JSON.stringify(input) }
    ),

  /** Studio-Loeschung zuruecknehmen (Reaktivierung waehrend Karenzphase). */
  cancelStudioDeletion: () =>
    request<{ status: "reactivated" | "not_pending" }>(
      "/account/delete-request/cancel",
      { method: "POST" }
    ),

  /** Status der Loeschung — fuer Banner-Anzeige. */
  getDeletionStatus: () =>
    request<{
      isPendingDeletion: boolean;
      requestedAt: string | null;
      scheduledFor: string | null;
    }>("/account/deletion-status"),

  /** Auto-Login nach Stripe-Checkout. Welcome-Page ruft das mit der
   *  session_id aus der URL auf — Backend validiert via Stripe und
   *  stellt das Session-Cookie aus. Returnt {ok:true} bei Erfolg,
   *  wirft sonst (Session ungültig, falscher Tenant, etc.). */
  checkoutLogin: (sessionId: string) =>
    request<{ ok: true }>("/auth/checkout-login", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }),

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

  // Galleries (Studio). Ad-hoc-Filter über Query-Params. Wenn ein
  // Filter-Set gespeichert werden soll, geht das über die Smart-
  // Collections-Routes weiter unten.
  listGalleries: (filter?: GalleryFilter) => {
    const qs = filterToQueryString(filter);
    return request<{ galleries: Gallery[] }>(
      qs ? `/galleries?${qs}` : "/galleries"
    );
  },

  // Smart Collections — gespeicherte Filter-Macros über die
  // Galerien-Liste. Sprint: docs/ROADMAP.md "Smart Collections".
  listCollections: () =>
    request<{ collections: SmartCollection[] }>("/collections"),
  createCollection: (input: {
    name: string;
    icon?: string;
    filter?: GalleryFilter;
  }) =>
    request<{ collection: SmartCollection }>("/collections", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateCollection: (
    id: string,
    patch: { name?: string; icon?: string | null; filter?: GalleryFilter; sortOrder?: number }
  ) =>
    request<{ collection: SmartCollection }>(`/collections/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteCollection: (id: string) =>
    request<void>(`/collections/${id}`, { method: "DELETE" }),
  runCollection: (id: string) =>
    request<{ galleries: Gallery[] }>(`/collections/${id}/galleries`),

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

  // Billing — Read-Only-Endpoints + Sprint 2 Stripe-Aktionen
  getBillingPlans: () => request<BillingPlansResponse>(`/billing/plans`),
  getBillingUsage: () => request<BillingUsage>(`/billing/usage`),
  getBillingSubscription: () =>
    request<BillingSubscriptionInfo>(`/billing/subscription`),

  /** Startet einen Plan-Wechsel oder ein erstmaliges Abo nach Trial.
   * Bei aktiver Subscription: Server macht in-place-Update und gibt
   * { upgraded: true } zurück. Bei fehlender Subscription: Server
   * gibt eine Stripe-Checkout-URL zurück, der Client redirected. */
  startSubscription: (input: {
    plan: "solo" | "studio" | "pro";
    interval?: "monthly" | "yearly";
  }) =>
    request<
      | { upgraded: true; message?: string }
      | { checkoutUrl: string; sessionId: string }
    >(`/billing/subscription`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  /** Erstellt einen Stripe-Customer-Portal-Link. Client redirected
   * den User dorthin — Stripe hostet Karte/Rechnungen/Cancel. */
  startBillingPortal: () =>
    request<{ portalUrl: string }>(`/billing/portal`, {
      method: "POST",
    }),

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
  // Upload-Links (Studio) — öffentliche Drag-and-Drop-Endpunkte pro Galerie
  // ---------------------------------------------------------------------------
  listUploadLinks: (galleryId: string) =>
    request<UploadLink[]>(`/galleries/${galleryId}/upload-links`),

  createUploadLink: (
    galleryId: string,
    input: {
      label: string;
      password?: string;
      maxFiles?: number | null;
      // Bytes als number — 100 GB max im Backend-Schema, locker im JS-
      // Number-Safe-Range (Number.MAX_SAFE_INTEGER ≈ 9 PB).
      maxBytesTotal?: number | null;
      maxFileBytes?: number | null;
      expiresAt?: string | null;
    }
  ) =>
    request<UploadLink>(`/galleries/${galleryId}/upload-links`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updateUploadLink: (
    galleryId: string,
    linkId: string,
    patch: {
      label?: string;
      password?: string | null;
      active?: boolean;
      maxFiles?: number | null;
      maxBytesTotal?: number | null;
      maxFileBytes?: number | null;
      expiresAt?: string | null;
    }
  ) =>
    request<UploadLink>(`/galleries/${galleryId}/upload-links/${linkId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  deleteUploadLink: (galleryId: string, linkId: string) =>
    request<void>(`/galleries/${galleryId}/upload-links/${linkId}`, {
      method: "DELETE",
    }),

  /** File-Freigabe: macht ein per Upload-Link reingekommenes File für
   * den Customer sichtbar (publicVisibility: hidden → visible). */
  approveUploadedFile: (galleryId: string, fileId: string) =>
    request<{ fileId: string; publicVisibility: "visible" }>(
      `/galleries/${galleryId}/files/${fileId}/approve`,
      { method: "POST" }
    ),

  /** Bulk-Freigabe: mehrere pending-Files in einem Call freigeben.
   * Endpoint returnt die freigegebenen IDs (kann weniger sein wenn
   * manche schon visible waren oder nicht zur Galerie gehören). */
  approveUploadedFilesBulk: (galleryId: string, fileIds: string[]) =>
    request<{ approved: string[] }>(
      `/galleries/${galleryId}/uploads/approve-bulk`,
      {
        method: "POST",
        body: JSON.stringify({ fileIds }),
      }
    ),

  /** Reject: einzelnen File ablehnen. S3-Objekte werden gelöscht,
   * DB-Row bleibt mit publicVisibility="rejected" + Audit-Metadaten. */
  rejectUploadedFile: (
    galleryId: string,
    fileId: string,
    reason: string | null
  ) =>
    request<{ fileId: string; publicVisibility: "rejected" }>(
      `/galleries/${galleryId}/files/${fileId}/reject`,
      {
        method: "POST",
        body: JSON.stringify({ reason }),
      }
    ),

  /** Bulk-Reject: mehrere Files mit GEMEINSAMEM Grund ablehnen. */
  rejectUploadedFilesBulk: (
    galleryId: string,
    fileIds: string[],
    reason: string | null
  ) =>
    request<{ rejected: string[] }>(
      `/galleries/${galleryId}/uploads/reject-bulk`,
      {
        method: "POST",
        body: JSON.stringify({ fileIds, reason }),
      }
    ),

  // ---------------------------------------------------------------------------
  // Upload-Links (Public, Token-basiert, kein Login)
  // ---------------------------------------------------------------------------
  getUploadLinkMeta: (token: string) =>
    request<{
      label: string;
      galleryTitle: string;
      hasPassword: boolean;
      unlocked: boolean;
      limits: {
        maxFiles: number | null;
        maxBytesTotal: string | null;
        maxFileBytes: string | null;
        /** Effektives Pro-File-Limit (Tenant + Link + Hard-Cap). */
        effectivePerFileBytes: string;
        usedFiles: number;
        usedBytes: string;
      };
    }>(`/u/${token}`),

  unlockUploadLink: (token: string, password: string) =>
    request<{ ok: true }>(`/u/${token}/unlock`, {
      method: "POST",
      body: JSON.stringify({ password }),
    }),

  initUploadViaLink: (
    token: string,
    files: { filename: string; sizeBytes: number; mimeType: string }[]
  ) =>
    request<{ uploads: UploadInit[] }>(`/u/${token}/uploads/init`, {
      method: "POST",
      body: JSON.stringify({ files }),
    }),

  completeUploadViaLink: (
    token: string,
    fileId: string,
    parts?: { partNumber: number; eTag: string }[],
    uploadId?: string
  ) => {
    const headers: Record<string, string> = {};
    if (uploadId) headers["X-Upload-Id"] = uploadId;
    return request<{ fileId: string; status: string }>(
      `/u/${token}/uploads/complete`,
      {
        method: "POST",
        body: JSON.stringify({ fileId, parts }),
        headers,
      }
    );
  },

  /** Holt frische presigned URLs für ein Upload-Link-File, das in
   *  status='uploading' hängt. Analog zu resignUpload (Studio), aber
   *  via Upload-Link-Token authentifiziert. */
  resignUploadViaLink: (
    token: string,
    fileId: string,
    input?: { uploadId?: string; partNumbers?: number[] }
  ) =>
    request<UploadInit>(`/u/${token}/uploads/${fileId}/resign`, {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    }),

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
      emails?: string[];
      canDownload?: boolean;
      canComment?: boolean;
      canSelect?: boolean;
      canSeeOthers?: boolean;
      expiresAt?: string;
      /** Wenn true UND mindestens eine Adresse in emails: direkt nach
       *  dem Anlegen Einladungs-Mails an alle Adressen schicken. */
      sendInvitation?: boolean;
      /** Persoenliche Notiz fuer die Einladungs-Mail. Max 1000 Zeichen. */
      personalMessage?: string;
    }
  ) =>
    request<{ access: GalleryAccess; invitationSent?: boolean }>(
      `/galleries/${galleryId}/access`,
      { method: "POST", body: JSON.stringify(input) }
    ),

  /** PATCH eines bestehenden Access — fuer Label/Emails/Berechtigungs-
   *  Aenderungen. Schickt KEINE Mail (dafuer ist /invite da). */
  updateAccess: (
    galleryId: string,
    accessId: string,
    input: {
      label?: string;
      emails?: string[];
      canDownload?: boolean;
      canComment?: boolean;
      canSelect?: boolean;
      canSeeOthers?: boolean;
      expiresAt?: string;
    }
  ) =>
    request<{ access: GalleryAccess }>(
      `/galleries/${galleryId}/access/${accessId}`,
      { method: "PATCH", body: JSON.stringify(input) }
    ),

  /** Einladung zu einem bestehenden Access (erneut) verschicken.
   *  - Ohne recipients: nutzt die hinterlegten emails am Access.
   *  - Mit recipients: ueberschreibt fuer diesen einen Versand.
   *  - updateDefaults=true: speichert recipients als neue Defaults
   *    auf dem Access (nur sinnvoll wenn recipients gesetzt). */
  sendAccessInvitation: (
    galleryId: string,
    accessId: string,
    input?: {
      personalMessage?: string;
      recipients?: string[];
      updateDefaults?: boolean;
    }
  ) =>
    request<{ sent: boolean }>(
      `/galleries/${galleryId}/access/${accessId}/invite`,
      { method: "POST", body: JSON.stringify(input ?? {}) }
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

  /** Holt frische presigned URLs für ein File, das in status='uploading'
   *  hängt — z.B. nach abgelaufener Signature oder mehrfachem Network-
   *  Fail. Bei Multipart muss die uploadId mitgegeben werden, weil sie
   *  nicht in der DB liegt. */
  resignUpload: (
    fileId: string,
    input?: { uploadId?: string; partNumbers?: number[] }
  ) =>
    request<UploadInit>(`/uploads/${fileId}/resign`, {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    }),

  // Duplicate Detection
  /** Startet einen SHA-256-Scan für die Galerie. Liefert
   *  scanRequired=false wenn alle Files schon einen Hash haben
   *  (dann kann man direkt findDuplicates aufrufen). */
  scanDuplicates: (galleryId: string) =>
    request<{ scanRequired: boolean; missingCount: number }>(
      `/galleries/${galleryId}/duplicates/scan`,
      { method: "POST" }
    ),

  /** Polled den Scan-Progress. status='idle' wenn kein Scan läuft,
   *  'queued'/'running' während er läuft, 'done' am Ende. */
  getDuplicateScanStatus: (galleryId: string) =>
    request<{
      status: "idle" | "queued" | "running" | "done" | "failed";
      total: number;
      done: number;
      ok: number;
      failed: number;
    }>(`/galleries/${galleryId}/duplicates/scan-status`),

  /** Liefert alle Duplikat-Gruppen (gleicher SHA-256-Hash innerhalb
   *  der Galerie). Files ohne sha256 werden ignoriert. */
  findDuplicates: (galleryId: string) =>
    request<{
      galleryId: string;
      groupCount: number;
      totalDuplicates: number;
      groups: Array<{
        sha256: string;
        count: number;
        files: Array<{
          id: string;
          originalFilename: string;
          sizeBytes: number;
          createdAt: string;
          width: number | null;
          height: number | null;
          thumbUrl: string | null;
        }>;
      }>;
    }>(`/galleries/${galleryId}/duplicates`),

  // Team-Management (Tenant-intern, Owner-only)
  listTeam: () =>
    request<{
      users: Array<{
        id: string;
        email: string;
        name: string | null;
        role: "owner" | "admin" | "member";
        status: "active" | "invited" | "disabled";
        lastLoginAt: string | null;
        createdAt: string;
        totpEnabled: boolean;
      }>;
    }>(`/team`),

  inviteTeamMember: (input: {
    email: string;
    name: string;
    role?: "owner" | "admin" | "member";
  }) =>
    request<{
      user: {
        id: string;
        email: string;
        name: string | null;
        role: string;
        status: string;
      };
      mailSent: boolean;
      /** Setup-URL nur gesetzt wenn die Mail NICHT durchging — dann
       *  kann der einladende Owner manuell weiterleiten. */
      setupUrl: string | null;
    }>(`/team`, { method: "POST", body: JSON.stringify(input) }),

  resendTeamInvite: (userId: string) =>
    request<{ mailSent: boolean; setupUrl: string | null }>(
      `/team/${userId}/resend`,
      { method: "POST" }
    ),

  updateTeamMember: (
    userId: string,
    input: {
      role?: "owner" | "admin" | "member";
      status?: "active" | "disabled";
      name?: string;
    }
  ) =>
    request<{
      user: {
        id: string;
        email: string;
        name: string | null;
        role: string;
        status: string;
      };
    }>(`/team/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),

  deleteTeamMember: (userId: string) =>
    request<null>(`/team/${userId}`, { method: "DELETE" }),

  // Tenant-Exporte (Datenexport)
  /** Eine einzelne Galerie als ZIP exportieren. */
  createGalleryExport: (galleryId: string) =>
    request<{ exportId: string; itemCount: number }>(
      `/exports/galleries/${galleryId}`,
      { method: "POST" }
    ),

  /** Alle Galerien des Tenants als separate ZIPs exportieren. */
  createTenantExport: () =>
    request<{ exportId: string; itemCount: number }>(`/exports/tenant`, {
      method: "POST",
    }),

  /** Liste aller Exports (max. 50, neueste zuerst). */
  listExports: () =>
    request<{
      exports: Array<{
        id: string;
        source: "studio" | "studio_all" | "super_admin";
        status: "pending" | "building" | "ready" | "expired";
        itemCount: number;
        expiresAt: string;
        createdAt: string;
      }>;
    }>(`/exports`),

  /** Detail eines Exports inkl. Items + signed Download-URLs. */
  getExport: (id: string) =>
    request<{
      export: {
        id: string;
        source: "studio" | "studio_all" | "super_admin";
        status: "pending" | "building" | "ready" | "expired";
        expiresAt: string;
        createdAt: string;
        items: Array<{
          id: string;
          galleryId: string | null;
          gallerySlug: string;
          galleryName: string;
          status: "pending" | "building" | "ready" | "failed";
          sizeBytes: number | null;
          fileCount: number | null;
          errorMessage: string | null;
          downloadUrl: string | null;
          createdAt: string;
          updatedAt: string;
        }>;
      };
    }>(`/exports/${id}`),

  /** Manuell löschen — S3-Cleanup passiert über TTL. */
  deleteExport: (id: string) =>
    request<null>(`/exports/${id}`, { method: "DELETE" }),

  // Public: Token-basierter Download (kein Login). Nur fuer Tenants
  // waehrend der Karenz nach Archive.
  getPublicExport: (token: string) =>
    request<{
      tenant: { id: string; name: string; slug: string };
      export: {
        id: string;
        status: string;
        expiresAt: string;
        createdAt: string;
        items: Array<{
          id: string;
          gallerySlug: string;
          galleryName: string;
          status: "pending" | "building" | "ready" | "failed";
          sizeBytes: number | null;
          fileCount: number | null;
          errorMessage: string | null;
        }>;
      };
    }>(`/e/${token}`),

  /** Liefert die direkte Download-URL für ein Item via Public-Token.
   *  Backend antwortet 302-Redirect auf eine S3-presigned URL — die
   *  Browser folgen automatisch. Wir geben einfach den URL-String
   *  zurück, den der Browser im <a href> öffnen kann. */
  getPublicExportItemDownloadUrl: (token: string, itemId: string): string => {
    // request() folgt 302 nicht — wir bauen die URL direkt; der
    // Browser kriegt das vom Backend mit Redirect aufgeloest sobald
    // er klickt. Pfad spiegelt /api/v1/e/<token>/items/<id>/download
    // wider, was server.ts mit /api/v1-Prefix anbietet.
    const base =
      typeof window !== "undefined"
        ? window.location.origin
        : "";
    return `${base}/api/v1/e/${token}/items/${itemId}/download`;
  },


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

  // ---------------------------------------------------------------------------
  // Studio-Comments (für Proofing-Detail-Ansicht)
  // ---------------------------------------------------------------------------
  // Liste UND Post sind eigene Endpoints unter /galleries/:id/... weil
  // das Studio über User-Session läuft, nicht über Visitor-Token. Das
  // List-Endpoint zeigt IMMER alle Comments (inkl. aller Customer-
  // Annotationen) — anders als der Customer-Endpoint, der die
  // canSeeOthers-Logik anwendet.
  studioListComments: (galleryId: string, fileId: string) =>
    request<{ comments: Comment[] }>(
      `/galleries/${galleryId}/files/${fileId}/comments`
    ),

  studioPostComment: (
    galleryId: string,
    fileId: string,
    input: { body: string; authorLabel?: string; annotation?: unknown }
  ) =>
    request<{ comment: Comment }>(
      `/galleries/${galleryId}/files/${fileId}/comments`,
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

  /** Ad-hoc-Warenkorb: client-übermittelte File-IDs (kein Backend-State).
   * Funktioniert in allen Galerie-Modes, im Gegensatz zu requestZipSelection
   * das die Selection-Tabelle braucht. */
  requestZipPicked: (
    slug: string,
    variant: "original" | "web" = "original",
    fileIds: string[]
  ) =>
    request<{
      id: string;
      status: ZipStatus;
      fileCount: number;
      requested: number;
    }>(`/g/${slug}/download/picked?variant=${variant}`, {
      method: "POST",
      body: JSON.stringify({ fileIds }),
      headers: { "Content-Type": "application/json" },
    }),

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
    request<{ tenant: TenantSettings; uploadLimits: UploadLimits }>(
      `/settings`
    ),

  updateTenantSettings: (patch: {
    displayName?: string | null;
    watermarkText?: string | null;
    customDomain?: string | null;
    maxUploadMib?: number | null;
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
      loginGreeting: string | null;
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
      kind: "logo" | "logoLight" | "favicon" | "loginBackground";
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
    input: {
      kind: "logo" | "logoLight" | "favicon" | "loginBackground";
      key: string;
    }
  ) =>
    request<{ branding: BrandingDetail }>(
      `/brandings/${id}/assets/complete`,
      { method: "POST", body: JSON.stringify(input) }
    ),

  deleteBrandingAsset: (
    id: string,
    kind: "logo" | "logoLight" | "favicon" | "loginBackground"
  ) =>
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
      pendingDeletions: Array<{
        id: string;
        name: string;
        slug: string;
        requestedAt: string | null;
        scheduledFor: string | null;
        ownerEmail: string | null;
        ownerName: string | null;
      }>;
      recentSignups: Array<{
        id: string;
        name: string;
        slug: string;
        status: string;
        createdAt: string;
        planName: string | null;
        planSlug: string | null;
        subscriptionStatus: string | null;
      }>;
      planDistribution: Array<{
        planId: string;
        planSlug: string;
        planName: string;
        total: number;
        byStatus: Record<string, number>;
      }>;
      signupsPerWeek: Array<{ weekStart: string; count: number }>;
      failedPayments: Array<{
        tenantId: string;
        tenantName: string;
        tenantSlug: string;
        ownerEmail: string | null;
        planName: string;
        status: string;
        problemSince: string;
        readOnlySince: string | null;
        currentPeriodEnd: string | null;
        stripeCustomerId: string | null;
      }>;
    }>("/super/stats"),

  /** Manueller Cancel der Self-Service-Loeschung durch den Super-Admin
   *  — Use-Case: Owner kann sich nicht selbst zurueck-einloggen. */
  superCancelSelfDeletion: (tenantId: string) =>
    request<{ ok: true; status: "reactivated" | "not_pending" }>(
      `/super/tenants/${tenantId}/cancel-self-deletion`,
      { method: "POST" }
    ),

  superAuditLog: (params: {
    tenantId?: string;
    actionPrefix?: string;
    actorType?: "user" | "access" | "system" | "super_admin";
    from?: string;
    to?: string;
    limit?: number;
    cursor?: string;
  }) => {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") {
        search.set(k, String(v));
      }
    }
    return request<{
      events: Array<{
        id: string;
        tenantId: string | null;
        tenantName: string | null;
        tenantSlug: string | null;
        actorType: string;
        actorId: string | null;
        action: string;
        targetType: string | null;
        targetId: string | null;
        payload: unknown;
        ipAddress: string | null;
        createdAt: string;
      }>;
      nextCursor: string | null;
    }>(`/super/audit-log?${search.toString()}`);
  },

  superAuditDistinctActions: () =>
    request<{
      actions: Array<{ action: string; count: number }>;
    }>("/super/audit-log/distinct-actions"),

  superListTenantNotes: (tenantId: string) =>
    request<{
      notes: Array<{
        id: string;
        body: string;
        authorEmail: string;
        authorName: string | null;
        createdAt: string;
      }>;
    }>(`/super/tenants/${tenantId}/notes`),

  superCreateTenantNote: (tenantId: string, body: string) =>
    request<{
      note: {
        id: string;
        body: string;
        authorEmail: string;
        authorName: string | null;
        createdAt: string;
      };
    }>(`/super/tenants/${tenantId}/notes`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }),

  superDeleteTenantNote: (tenantId: string, noteId: string) =>
    request<{ ok: true }>(
      `/super/tenants/${tenantId}/notes/${noteId}`,
      { method: "DELETE" }
    ),

  /** Super-Admin loest einen Passwort-Reset-Link fuer einen User aus.
   *  Mail wird verschickt und der Link wird zusaetzlich zurueckgegeben,
   *  damit man ihn notfalls telefonisch durchgeben kann. */
  superTriggerPasswordReset: (tenantId: string, userId: string) =>
    request<{ ok: true; resetUrl: string; expiresAt: string }>(
      `/super/tenants/${tenantId}/owner-password-reset`,
      { method: "POST", body: JSON.stringify({ userId }) }
    ),

  superExtendTrial: (
    tenantId: string,
    extraDays: number,
    reason?: string
  ) =>
    request<{ ok: true; newTrialEnd: string; extraDays: number }>(
      `/super/tenants/${tenantId}/extend-trial`,
      {
        method: "POST",
        body: JSON.stringify({ extraDays, reason }),
      }
    ),

  /** Impersonate-Login: Super-Admin bekommt eine redirect-URL auf die
   *  Tenant-Subdomain. Der Cookie wird erst dort gesetzt (Cross-Domain-
   *  Sicherheits-Workaround via Intent-Token). */
  superImpersonate: (
    tenantId: string,
    userId: string,
    reason?: string
  ) =>
    request<{ ok: true; redirectUrl: string; studioSlug: string }>(
      `/super/tenants/${tenantId}/impersonate`,
      {
        method: "POST",
        body: JSON.stringify({ userId, reason }),
      }
    ),

  /** Tauscht einen Impersonate-Intent-Token gegen eine Session.
   *  Wird auf der Tenant-Subdomain aufgerufen. */
  redeemImpersonateToken: (token: string) =>
    request<{ ok: true }>("/auth/impersonate-redeem", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),

  superTenantsStorage: () =>
    request<{
      tenants: Array<{
        id: string;
        name: string;
        slug: string;
        status: string;
        usedBytes: number;
        planName: string | null;
        planSlug: string | null;
        planLimitGib: number | null;
        addonGib: number;
        totalLimitGib: number | null;
        usagePct: number | null;
        galleriesCount: number | null;
      }>;
    }>("/super/tenants/storage"),

  superMrr: () =>
    request<{
      current: {
        date: string;
        mrrCents: number;
        trialingMrrCents: number;
        activeSubs: number;
        trialingSubs: number;
        perPlan: Record<
          string,
          { mrrCents: number; count: number; name: string }
        >;
      };
      history: Array<{
        date: string;
        mrrCents: number;
        trialingMrrCents: number;
        activeSubs: number;
        trialingSubs: number;
      }>;
    }>("/super/mrr"),

  /** Public: aktive Announcements (vom Studio-Shell gepollt). */
  listActiveAnnouncements: () =>
    request<{
      announcements: Array<{
        id: string;
        title: string;
        body: string;
        severity: "info" | "warning" | "critical";
        dismissible: boolean;
        activeUntil: string | null;
        createdAt: string;
      }>;
    }>("/announcements/active"),

  /** Super-Admin: alle Announcements (inkl. zukuenftige + vergangene). */
  superListAnnouncements: () =>
    request<{
      announcements: Array<{
        id: string;
        title: string;
        body: string;
        severity: string;
        activeFrom: string | null;
        activeUntil: string | null;
        dismissible: boolean;
        createdByEmail: string;
        createdAt: string;
        updatedAt: string;
      }>;
    }>("/super/announcements"),

  superCreateAnnouncement: (input: {
    title: string;
    body: string;
    severity?: "info" | "warning" | "critical";
    activeFrom?: string | null;
    activeUntil?: string | null;
    dismissible?: boolean;
  }) =>
    request<{ announcement: { id: string } }>("/super/announcements", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  superUpdateAnnouncement: (
    id: string,
    input: {
      title?: string;
      body?: string;
      severity?: "info" | "warning" | "critical";
      activeFrom?: string | null;
      activeUntil?: string | null;
      dismissible?: boolean;
    }
  ) =>
    request<{ announcement: { id: string } }>(
      `/super/announcements/${id}`,
      { method: "PATCH", body: JSON.stringify(input) }
    ),

  superDeleteAnnouncement: (id: string) =>
    request<{ ok: true }>(`/super/announcements/${id}`, {
      method: "DELETE",
    }),

  superListBroadcasts: () =>
    request<{
      broadcasts: Array<{
        id: string;
        subject: string;
        audience: string;
        status: string;
        totalRecipients: number;
        sentCount: number;
        failedCount: number;
        optedOutSkippedCount: number;
        startedAt: string | null;
        finishedAt: string | null;
        createdAt: string;
        createdByEmail: string;
      }>;
      audienceLabels: Record<string, string>;
    }>("/super/broadcasts"),

  superGetBroadcast: (id: string) =>
    request<{
      broadcast: {
        id: string;
        subject: string;
        bodyMarkdown: string;
        bodyHtml: string;
        audience: string;
        status: string;
        totalRecipients: number;
        sentCount: number;
        failedCount: number;
        optedOutSkippedCount: number;
        startedAt: string | null;
        finishedAt: string | null;
        lastProgressAt: string | null;
        errorMessage: string | null;
        createdByEmail: string;
        createdAt: string;
        updatedAt: string;
      };
    }>(`/super/broadcasts/${id}`),

  superCreateBroadcast: (input: {
    subject: string;
    bodyMarkdown: string;
    audience:
      | "all_paid_owners"
      | "all_trial_owners"
      | "all_owners"
      | "all_active_users";
  }) =>
    request<{ broadcast: { id: string } }>("/super/broadcasts", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  superPreviewBroadcast: (bodyMarkdown: string) =>
    request<{ html: string }>("/super/broadcasts/preview", {
      method: "POST",
      body: JSON.stringify({ bodyMarkdown }),
    }),

  superTestSendBroadcast: (input: { subject: string; bodyMarkdown: string }) =>
    request<{ ok: true }>("/super/broadcasts/test-send", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  superDeleteBroadcast: (id: string) =>
    request<{ ok: true }>(`/super/broadcasts/${id}`, { method: "DELETE" }),

  superListFeatureFlagDefs: () =>
    request<{
      flags: Array<{
        key: string;
        name: string;
        description: string;
        defaultValue: boolean;
        badge?: "beta" | "experimental" | "deprecated";
      }>;
    }>("/super/feature-flags"),

  superGetTenantFeatureFlags: (tenantId: string) =>
    request<{
      flags: Array<{
        key: string;
        name: string;
        description: string;
        defaultValue: boolean;
        badge?: "beta" | "experimental" | "deprecated";
        effectiveValue: boolean;
        hasOverride: boolean;
        overrideSetBy: string | null;
        overrideSetAt: string | null;
      }>;
    }>(`/super/tenants/${tenantId}/feature-flags`),

  superSetTenantFeatureFlag: (
    tenantId: string,
    flagKey: string,
    enabled: boolean
  ) =>
    request<{
      ok: true;
      action: "set" | "deleted" | "unchanged";
    }>(`/super/tenants/${tenantId}/feature-flags/${flagKey}`, {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    }),

  superListPrintProviders: () =>
    request<{
      providers: Array<{
        key: string;
        label: string;
        tagline: string;
        market: string;
        websiteUrl: string;
        apiKeyHelpUrl?: string;
        stage: "production" | "beta" | "planned" | "self_print";
        categories: string[];
        enabled: boolean;
        adminNotes: string | null;
        configuredAt: string | null;
      }>;
    }>("/super/print-providers"),

  superTogglePrintProvider: (
    key: string,
    enabled: boolean,
    adminNotes?: string | null
  ) =>
    request<{ ok: true }>(`/super/print-providers/${key}`, {
      method: "PUT",
      body: JSON.stringify({ enabled, adminNotes }),
    }),

  superSystemStatus: () =>
    request<{
      health: {
        db: { ok: boolean; latencyMs: number | null; message?: string };
        redis: { ok: boolean; latencyMs: number | null; message?: string };
        s3: { ok: boolean; latencyMs: number | null; message?: string };
        worker: {
          ok: boolean;
          latencyMs: number | null;
          message?: string;
          details?: { lastProcessedAt?: string | null; lastStatus?: string };
        };
        queues: Record<string, number>;
        diskFreeMib: number | null;
      };
      update: {
        currentVersion: string;
        latestVersion: string | null;
        updateAvailable: boolean;
        releaseUrl: string | null;
        releaseNotes: string | null;
        publishedAt: string | null;
        checkedAt: string | null;
        disabled: string | null;
      };
      backup: {
        configured: boolean;
        statusPath: string | null;
        lastBackupAt: string | null;
        ageHours: number | null;
        sizeBytes: number | null;
        health: "ok" | "warning" | "critical" | "unknown";
        message: string;
      };
    }>("/super/system"),

  superListTenants: () =>
    request<{ tenants: SuperTenantSummary[] }>("/super/tenants"),
  superGetTenant: (id: string) =>
    request<{ tenant: SuperTenantDetail }>(`/super/tenants/${id}`),

  superCreateTenant: (input: {
    slug: string;
    name: string;
    displayName?: string | null;
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
    patch: {
      slug?: string;
      name?: string;
      displayName?: string | null;
      customDomain?: string | null;
    }
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

  /** Hard-Delete eines bereits archivierten Tenants. Setzt 30-Tage-
   *  Karenz seit archivedAt voraus, sonst HTTP 409. Verlangt im Body
   *  `confirmSlug` exakt = tenant.slug. */
  superDeleteTenant: (id: string, input: { confirmSlug: string }) =>
    request<null>(`/super/tenants/${id}`, {
      method: "DELETE",
      body: JSON.stringify(input),
    }),

  /** Tenant-Datenexport anstoßen. Bei archived Tenants wird zusätzlich
   *  ein Token erzeugt und eine Mail mit Download-Link an alle Owner
   *  verschickt — der Tenant kann ohne Login darauf zugreifen. */
  superExportTenant: (id: string) =>
    request<{
      exportId: string;
      itemCount: number;
      tokenIssued: boolean;
      mailsSent: number;
    }>(`/super/tenants/${id}/export`, { method: "POST" }),

  /** Archivierung vor-planen. Optional scheduledAt (ISO-String);
   *  default 30 Tage in der Zukunft. Schickt Initial-Mail an alle
   *  aktiven Owner. Studio zeigt ab Setzen einen Countdown-Banner. */
  superScheduleArchive: (id: string, input?: { scheduledAt?: string }) =>
    request<{
      tenant: {
        id: string;
        slug: string;
        name: string;
        status: string;
        archiveScheduledAt: string | null;
      };
      mailsSent: number;
      ownersTotal: number;
    }>(`/super/tenants/${id}/schedule-archive`, {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    }),

  /** Schedule zurückziehen. Schickt KEINE Absage-Mail automatisch. */
  superCancelScheduledArchive: (id: string) =>
    request<{ ok: true }>(`/super/tenants/${id}/schedule-archive`, {
      method: "DELETE",
    }),

  /** Liste der Exports eines Tenants (Super-Admin-Sicht inkl. Token). */
  superListTenantExports: (id: string) =>
    request<{
      exports: Array<{
        id: string;
        source: string;
        status: string;
        itemCount: number;
        expiresAt: string;
        createdAt: string;
        token: {
          value: string;
          expiresAt: string;
          accessCount: number;
        } | null;
      }>;
    }>(`/super/tenants/${id}/exports`),

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

  // ===========================================================================
  // Print-Shop (Studio-Verwaltung)
  // ===========================================================================
  // Alle pruefen serverseitig den Feature-Flag print_shop. Bei aus: 404.

  getPrintShopConfig: () =>
    request<{
      config: {
        enabled: boolean;
        studioDisplayName: string | null;
        supportEmail: string | null;
        vatHandling: "inclusive" | "exclusive";
        defaultVatBps: number;
        currency: string;
        termsUrl: string | null;
        privacyUrl: string | null;
        applicationFeeBpsOverride: number | null;
        featureFlagEnabled: boolean;
      };
      stripeConnect: {
        configured: boolean;
        stripeConnectedAccountId: string | null;
        chargesEnabled: boolean;
        payoutsEnabled: boolean;
        detailsSubmitted: boolean;
        ready: boolean;
        onboardedAt: string | null;
      };
    }>("/print-shop/config"),

  updatePrintShopConfig: (patch: {
    enabled?: boolean;
    studioDisplayName?: string | null;
    supportEmail?: string | null;
    vatHandling?: "inclusive" | "exclusive";
    defaultVatBps?: number;
    currency?: string;
    termsUrl?: string | null;
    privacyUrl?: string | null;
  }) =>
    request<{ ok: true }>("/print-shop/config", {
      method: "PUT",
      body: JSON.stringify(patch),
    }),

  startStripeConnectOnboarding: () =>
    request<{ onboardingUrl: string }>("/print-shop/stripe-connect", {
      method: "POST",
    }),

  refreshStripeConnect: () =>
    request<{
      stripeConnect: Awaited<
        ReturnType<typeof api.getPrintShopConfig>
      >["stripeConnect"];
    }>("/print-shop/stripe-connect/refresh", { method: "POST" }),

  disconnectStripeConnect: () =>
    request<{ ok: true }>("/print-shop/stripe-connect", { method: "DELETE" }),

  listAvailablePrintProviders: () =>
    request<{
      providers: Array<{
        key: string;
        label: string;
        tagline: string;
        market: string;
        stage: "production" | "beta" | "planned" | "self_print";
        categories: string[];
        websiteUrl: string;
        apiKeyHelpUrl?: string;
        credentialFields: Array<{
          key: string;
          label: string;
          kind: "text" | "password" | "email" | "url";
          helpText?: string;
          required: boolean;
        }>;
      }>;
    }>("/print-shop/providers/available"),

  listTenantPrintProviders: () =>
    request<{
      providers: Array<{
        id: string;
        providerKey: string;
        providerLabel: string;
        enabled: boolean;
        isDefault: boolean;
        displayName: string | null;
        hasCredentials: boolean;
        createdAt: string;
        updatedAt: string;
      }>;
    }>("/print-shop/providers"),

  setTenantPrintProvider: (
    providerKey: string,
    input: {
      enabled?: boolean;
      displayName?: string | null;
      credentials?: Record<string, string>;
      isDefault?: boolean;
    }
  ) =>
    request<{ ok: true }>(`/print-shop/providers/${providerKey}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),

  deleteTenantPrintProvider: (providerKey: string) =>
    request<{ ok: true }>(`/print-shop/providers/${providerKey}`, {
      method: "DELETE",
    }),

  listPrintProducts: () =>
    request<{
      products: Array<{
        id: string;
        name: string;
        description: string | null;
        providerKey: string;
        providerProductRef: string | null;
        category: string;
        vatBpsOverride: number | null;
        displayOrder: number;
        enabled: boolean;
        variants: Array<{
          id: string;
          name: string;
          widthMm: number;
          heightMm: number;
          aspectRatio: number | null;
          finishType: string | null;
          providerVariantRef: string | null;
          priceCents: number;
          costCents: number | null;
          displayOrder: number;
          enabled: boolean;
        }>;
      }>;
    }>("/print-shop/products"),

  createPrintProduct: (input: PrintProductCreateInput) =>
    request<{ product: { id: string } }>("/print-shop/products", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updatePrintProduct: (id: string, patch: Partial<PrintProductCreateInput>) =>
    request<{ product: { id: string } }>(`/print-shop/products/${id}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    }),

  deletePrintProduct: (id: string) =>
    request<{ ok: true }>(`/print-shop/products/${id}`, { method: "DELETE" }),

  createPrintVariant: (productId: string, input: PrintVariantCreateInput) =>
    request<{ variant: { id: string } }>(
      `/print-shop/products/${productId}/variants`,
      { method: "POST", body: JSON.stringify(input) }
    ),

  updatePrintVariant: (id: string, patch: Partial<PrintVariantCreateInput>) =>
    request<{ variant: { id: string } }>(`/print-shop/variants/${id}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    }),

  deletePrintVariant: (id: string) =>
    request<{ ok: true }>(`/print-shop/variants/${id}`, { method: "DELETE" }),

  listShippingMethods: () =>
    request<{
      methods: Array<{
        id: string;
        providerKey: string;
        name: string;
        priceCents: number;
        estimatedDaysMin: number | null;
        estimatedDaysMax: number | null;
        countries: string[];
        providerShippingRef: string | null;
        enabled: boolean;
        displayOrder: number;
      }>;
    }>("/print-shop/shipping-methods"),

  createShippingMethod: (input: ShippingMethodCreateInput) =>
    request<{ method: { id: string } }>("/print-shop/shipping-methods", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updateShippingMethod: (
    id: string,
    patch: Partial<ShippingMethodCreateInput>
  ) =>
    request<{ method: { id: string } }>(
      `/print-shop/shipping-methods/${id}`,
      { method: "PUT", body: JSON.stringify(patch) }
    ),

  deleteShippingMethod: (id: string) =>
    request<{ ok: true }>(`/print-shop/shipping-methods/${id}`, {
      method: "DELETE",
    }),

  // ===========================================================================
  // Studio Print-Shop Orders
  // ===========================================================================
  listPrintOrders: (params?: {
    status?: string;
    limit?: number;
    cursor?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.cursor) qs.set("cursor", params.cursor);
    const q = qs.toString();
    return request<{
      orders: Array<{
        id: string;
        orderNumber: string;
        guestName: string;
        guestEmail: string;
        totalCents: number;
        currency: string;
        status: string;
        paymentMode: string;
        providerKey: string;
        createdAt: string;
        paidAt: string | null;
        shippedAt: string | null;
        deliveredAt: string | null;
      }>;
      nextCursor: string | null;
    }>(`/print-shop/orders${q ? "?" + q : ""}`);
  },

  getPrintOrder: (id: string) =>
    request<{
      order: PrintOrderDetail;
    }>(`/print-shop/orders/${id}`),

  transitionPrintOrder: (
    id: string,
    body: {
      type:
        | "mark_paid"
        | "mark_in_production"
        | "mark_shipped"
        | "mark_delivered"
        | "cancel"
        | "refund";
      trackingNumber?: string;
      trackingCarrier?: string;
      trackingUrl?: string;
      reason?: string;
    }
  ) =>
    request<{ ok: true }>(`/print-shop/orders/${id}/transitions`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  setPrintOrderNote: (id: string, note: string) =>
    request<{ ok: true }>(`/print-shop/orders/${id}/note`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),

  // ===========================================================================
  // Public Print-Shop (Endkunde in Galerie)
  // ===========================================================================
  getGalleryPrintShopCatalog: (slug: string) =>
    request<{
      gallery: { slug: string; title: string };
      config: {
        studioDisplayName: string | null;
        supportEmail: string | null;
        vatHandling: "inclusive" | "exclusive";
        vatBps: number;
        currency: string;
        termsUrl: string | null;
        privacyUrl: string | null;
      };
      payment: {
        stripeConnectReady: boolean;
        offlineAvailable: boolean;
        stripePublishableKey: string | null;
        stripeAccountId: string | null;
      };
      products: Array<{
        id: string;
        name: string;
        description: string | null;
        category: string;
        providerKey: string;
        variants: Array<{
          id: string;
          name: string;
          widthMm: number;
          heightMm: number;
          aspectRatio: number | null;
          finishType: string | null;
          priceCents: number;
        }>;
      }>;
      shipping: Array<{
        id: string;
        name: string;
        priceCents: number;
        estimatedDaysMin: number | null;
        estimatedDaysMax: number | null;
        countries: string[];
      }>;
    }>(`/g/${slug}/print-shop/catalog`),

  priceGalleryCart: (
    slug: string,
    input: {
      items: Array<{
        variantId: string;
        fileId: string;
        quantity: number;
        crop?: { x: number; y: number; width: number; height: number } | null;
      }>;
      shippingMethodId: string | null;
    }
  ) =>
    request<{
      subtotalCents: number;
      shippingCents: number;
      taxCents: number;
      totalCents: number;
      currency: string;
      vatBps: number;
      vatHandling: "inclusive" | "exclusive";
    }>(`/g/${slug}/print-shop/price`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  checkoutGalleryCart: (
    slug: string,
    input: {
      items: Array<{
        variantId: string;
        fileId: string;
        quantity: number;
        crop?: { x: number; y: number; width: number; height: number } | null;
      }>;
      shippingMethodId: string;
      guestName: string;
      guestEmail: string;
      shippingAddress: {
        street: string;
        street2?: string;
        postalCode: string;
        city: string;
        region?: string;
        countryCode: string;
        phone?: string;
      };
      billingAddress?: typeof input.shippingAddress | null;
      paymentMode: "stripe_connect" | "offline_invoice";
      guestNote?: string;
      acceptedTerms: boolean;
    }
  ) =>
    request<{
      orderId: string;
      orderNumber: string;
      totals: {
        subtotalCents: number;
        shippingCents: number;
        taxCents: number;
        totalCents: number;
        currency: string;
      };
      payment:
        | { mode: "stripe_connect"; clientSecret: string; paymentIntentId: string }
        | { mode: "offline_invoice" };
    }>(`/g/${slug}/print-shop/checkout`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  getGalleryPrintOrder: (slug: string, orderNumber: string) =>
    request<{
      orderNumber: string;
      guestName: string;
      status: string;
      paymentMode: string;
      currency: string;
      totals: {
        subtotalCents: number;
        shippingCents: number;
        taxCents: number;
        totalCents: number;
      };
      items: Array<{
        quantity: number;
        variantName: string;
        productName: string;
        widthMm: number;
        heightMm: number;
        totalPriceCents: number;
      }>;
      shippingMethod: string | null;
      trackingNumber: string | null;
      trackingCarrier: string | null;
      trackingUrl: string | null;
      providerLabel: string;
      paidAt: string | null;
      shippedAt: string | null;
      deliveredAt: string | null;
    }>(`/g/${slug}/print-shop/order/${orderNumber}`),

  // ===========================================================================
  // Analytics (Feature-Flag 'advanced_analytics')
  // ===========================================================================
  getAnalyticsOverview: (days?: number) =>
    request<{
      range: { days: number; since: string };
      totals: {
        galleries: number;
        files: number;
        visits: number;
        likes: number;
        comments: number;
        finalizedSelections: number;
        printOrders: number;
        printRevenueCents: number;
      };
      trends: {
        dailyVisits: Array<{ day: string; count: number }>;
        dailyLikes: Array<{ day: string; count: number }>;
        storage: Array<{ day: string; bytesAdded: number; cumulative: number }>;
      };
      top: {
        byVisits: Array<{ galleryId: string; title: string; slug: string; visits: number }>;
        byLikes: Array<{ galleryId: string; title: string; slug: string; likes: number }>;
      };
    }>(`/analytics/overview${days ? "?days=" + days : ""}`),

  getGalleryFunnel: (galleryId: string, days?: number) =>
    request<{
      range: { days: number; since: string };
      steps: Array<{ key: string; label: string; count: number }>;
    }>(`/analytics/galleries/${galleryId}/funnel${days ? "?days=" + days : ""}`),

  // ===========================================================================
  // Auto-Tagging (Feature-Flag 'ai_tagging')
  // ===========================================================================
  getFileAutoTags: (fileId: string) =>
    request<{
      autoTags: Array<{
        id: string;
        tagName: string;
        confidence: number;
        source: string;
        status: "suggested" | "accepted" | "rejected";
        reviewedAt: string | null;
        label: string;
        group: string | null;
        color: string;
      }>;
    }>(`/files/${fileId}/auto-tags`),

  acceptAutoTag: (fileId: string, autoTagId: string) =>
    request<{ ok: boolean; tag?: { id: string; name: string } }>(
      `/files/${fileId}/auto-tags/${autoTagId}/accept`,
      { method: "POST" }
    ),

  rejectAutoTag: (fileId: string, autoTagId: string) =>
    request<{ ok: boolean }>(
      `/files/${fileId}/auto-tags/${autoTagId}/reject`,
      { method: "POST" }
    ),

  reTagGallery: (galleryId: string) =>
    request<{ ok: boolean; enqueuedFiles: number }>(
      `/galleries/${galleryId}/auto-tags/re-tag`,
      { method: "POST" }
    ),

  bulkAcceptAutoTags: (galleryId: string, minConfidence: number) =>
    request<{ ok: boolean; accepted: number; threshold: number }>(
      `/galleries/${galleryId}/auto-tags/bulk-accept?min=${minConfidence}`,
      { method: "POST" }
    ),

  getAutoTagStatus: () =>
    request<{ enabled: boolean; vocabulary: string[] }>(
      `/auto-tags/status`
    ),

  getGalleryAutoTagStats: (galleryId: string) =>
    request<{
      fileCount: number;
      taggedFiles: number;
      pendingSuggestions: number;
      accepted: number;
      rejected: number;
      lastTaggedAt: string | null;
    }>(`/galleries/${galleryId}/auto-tags/stats`),

  getGalleryAutoTagsPending: (galleryId: string) =>
    request<{
      groups: Array<{
        tagName: string;
        label: string;
        group: string | null;
        color: string;
        count: number;
        avgConfidence: number;
        hasMore: boolean;
        suggestions: Array<{
          autoTagId: string;
          fileId: string;
          filename: string;
          confidence: number;
          source: string;
          thumbUrl: string | null;
        }>;
      }>;
    }>(`/galleries/${galleryId}/auto-tags/pending`),

  acceptTagGroup: (
    galleryId: string,
    tagName: string,
    autoTagIds?: string[]
  ) =>
    request<{ ok: boolean; accepted: number }>(
      `/galleries/${galleryId}/auto-tags/by-name/${encodeURIComponent(tagName)}/accept-all`,
      {
        method: "POST",
        body: autoTagIds ? JSON.stringify({ autoTagIds }) : undefined,
      }
    ),

  rejectTagGroup: (
    galleryId: string,
    tagName: string,
    autoTagIds?: string[]
  ) =>
    request<{ ok: boolean; rejected: number }>(
      `/galleries/${galleryId}/auto-tags/by-name/${encodeURIComponent(tagName)}/reject-all`,
      {
        method: "POST",
        body: autoTagIds ? JSON.stringify({ autoTagIds }) : undefined,
      }
    ),
};

// ---------------------------------------------------------------------------
// Print-Shop Studio Order-Detail-Type (extern weil komplex)
// ---------------------------------------------------------------------------
export interface PrintOrderDetail {
  id: string;
  orderNumber: string;
  guestName: string;
  guestEmail: string;
  shippingAddress: Record<string, string>;
  billingAddress: Record<string, string> | null;
  paymentMode: string;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  applicationFeeCents: number;
  currency: string;
  status: string;
  providerKey: string;
  providerOrderRef: string | null;
  trackingNumber: string | null;
  trackingCarrier: string | null;
  trackingUrl: string | null;
  guestNote: string | null;
  studioNote: string | null;
  paidAt: string | null;
  productionStartedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  refundedAt: string | null;
  createdAt: string;
  items: Array<{
    id: string;
    quantity: number;
    unitPriceCents: number;
    totalPriceCents: number;
    crop: { x: number; y: number; width: number; height: number } | null;
    printProductVariant: {
      name: string;
      widthMm: number;
      heightMm: number;
      finishType: string | null;
      printProduct: { name: string };
    };
    file: { id: string; originalFilename: string; sha256: string | null };
  }>;
  shippingMethod: { name: string; priceCents: number } | null;
  events: Array<{
    id: string;
    eventType: string;
    actor: string;
    actorUserId: string | null;
    data: Record<string, unknown> | null;
    createdAt: string;
  }>;
  gallery: { id: string; slug: string; title: string };
}

// ---------------------------------------------------------------------------
// Print-Shop Input-Types (extern definiert weil TS Self-References im
// api-Objekt nicht aufloesen kann — sonst kaskadieren Type-Inferences
// und alle 'typeof api.X'-Verwendungen in anderen Files brechen)
// ---------------------------------------------------------------------------
export interface PrintProductCreateInput {
  name: string;
  description?: string | null;
  providerKey: string;
  providerProductRef?: string | null;
  category?:
    | "print"
    | "canvas"
    | "photobook"
    | "frame"
    | "metal_print"
    | "poster";
  vatBpsOverride?: number | null;
  displayOrder?: number;
  enabled?: boolean;
}

export interface PrintVariantCreateInput {
  name: string;
  widthMm: number;
  heightMm: number;
  aspectRatio?: number | null;
  finishType?: string | null;
  providerVariantRef?: string | null;
  priceCents: number;
  costCents?: number | null;
  displayOrder?: number;
  enabled?: boolean;
}

export interface ShippingMethodCreateInput {
  providerKey: string;
  name: string;
  priceCents: number;
  estimatedDaysMin?: number | null;
  estimatedDaysMax?: number | null;
  countries?: string[];
  providerShippingRef?: string | null;
  enabled?: boolean;
  displayOrder?: number;
}

export interface SuperTenantSummary {
  id: string;
  slug: string;
  /** Interner Verwaltungsname. */
  name: string;
  /** Oeffentlicher Anzeigename (Login, Mails). Null = Fallback auf name. */
  displayName: string | null;
  status: "active" | "suspended" | "archived" | "pending_deletion";
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
  /** Interner Verwaltungsname. */
  name: string;
  /** Oeffentlicher Anzeigename. Null = Fallback auf name. */
  displayName: string | null;
  status: "active" | "suspended" | "archived" | "pending_deletion";
  /** Timestamp wann der Tenant archiviert wurde. Null bei aktiven/
   *  suspendierten Tenants. */
  archivedAt: string | null;
  /** Wenn gesetzt: Super-Admin hat eine Archivierung im Voraus geplant.
   *  Studio zeigt ab dann einen Countdown-Banner. */
  archiveScheduledAt: string | null;
  /** Self-Service-Loeschung: gesetzt wenn Owner das Studio zur
   *  endgueltigen Loeschung angemeldet hat (status = pending_deletion). */
  selfDeletionRequestedAt: string | null;
  selfDeletionScheduledFor: string | null;
  /** Karenz-Info bei archivierten Tenants. Null sonst.
   *  - active: true wenn die Karenzfrist (30 Tage) noch läuft
   *  - deletableAt: ISO-Zeitstring ab wann Hard-Delete erlaubt ist
   *  - remainingDays: Tage bis Hard-Delete möglich ist (0 wenn vorbei) */
  karenz: {
    active: boolean;
    deletableAt: string;
    remainingDays: number;
  } | null;
  customDomain: string | null;
  createdAt: string;
  updatedAt: string;
  galleryCount: number;
  users: SuperTenantUser[];
  /** Stripe-Subscription, falls vorhanden. Null bei Tenants ohne
   *  Subscription (Self-Hosting-Tests, etc.). */
  subscription: SuperTenantSubscription | null;
}

export interface SuperTenantSubscription {
  status: string;
  billingInterval: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  storageBytesUsed: number;
  storageAddonGib: number;
  galleriesCount: number;
  readOnlySince: string | null;
  createdAt: string;
  updatedAt: string;
  plan: {
    slug: string;
    name: string;
    storageGib: number | null;
    galleriesMax: number | null;
    priceMonthlyCents: number | null;
    priceYearlyCents: number | null;
    currency: string;
  };
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
  logoLightUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  accentColor: string;
  fontFamily: string;
  introText: string | null;
  footerText: string | null;
  customCss: string | null;
  loginBackgroundUrl: string | null;
  loginGreeting: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TenantSettings {
  id: string;
  slug: string;
  /** Interner Verwaltungsname (Super-Admin-Sicht). */
  name: string;
  /** Oeffentlicher Anzeigename (Login, Mails, Welcome). Wenn null,
   *  fallen alle Caller auf 'name' zurueck. */
  displayName: string | null;
  watermarkText: string | null;
  watermarkImageKey: string | null;
  customDomain?: string | null;
  /** Pro-File Upload-Limit-Override in MiB. Null = ENV-Default. */
  maxUploadMib: number | null;
}

/** Limits-Hilfsinfo aus dem Settings-GET — sagt der UI was Default
 *  und Hard-Cap sind, ohne die ENV lesen zu müssen. */
export interface UploadLimits {
  defaultMib: number;
  hardCapMib: number;
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

export interface BillingPlan {
  slug: string;
  name: string;
  description: string;
  storageGib: number;
  // null = unbegrenzt
  activeGalleries: number | null;
  brandings: number;
  customDomains: number | null;
  teamMembers: number;
  watermarkAllowed: boolean;
  priceMonthlyCents: number;
  /** Jahres-Preis in Cent. Üblich = 10 Monatspreise (~17% Rabatt). */
  priceYearlyCents: number;
}

export interface BillingPlansResponse {
  plans: BillingPlan[];
  storageAddon: { gibPerUnit: number; priceMonthlyCents: number };
}

export interface BillingUsage {
  plan: BillingPlan;
  subscriptionStatus: string;
  storageAddonGib: number;
  storage: {
    usedBytes: string;
    limitBytes: string;
    breakdown: { originalsBytes: string; renditionsBytes: string };
  };
  galleries: { active: number; total: number };
  customDomains: number;
  brandings: number;
  teamMembers: number;
  trialEndsAt: string | null;
  readOnlySince: string | null;
}

export interface BillingSubscriptionInfo {
  planSlug: string;
  planName: string;
  status: string;
  billingInterval: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  /** Tage bis Trial endet. null wenn nicht in Trial. */
  trialDaysRemaining: number | null;
  /** Wann Read-only-Modus begann (= 14d-Trial expired ohne Karte).
   * null wenn nicht read-only. */
  readOnlySince: string | null;
  /** Tage seit Read-only-Beginn. UI nutzt das für den
   * Suspend-Countdown (30 Tage bis Galerien archiviert werden). */
  readOnlyDays: number | null;
  storageAddonGib: number;
  hasStripeId: boolean;
  limits: {
    storageGib: number;
    galleriesMax: number | null;
    customDomain: boolean;
    watermarking: boolean;
    priceMonthlyCents: number;
    priceYearlyCents: number;
    currency: string;
  };
}

export interface GalleryFilter {
  tagIds?: string[];
  mode?: "collaboration" | "presentation";
  status?: "draft" | "live" | "archived";
  since?: string; // ISO
  until?: string; // ISO
}

export interface SmartCollection {
  id: string;
  name: string;
  icon: string | null;
  filter: GalleryFilter;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** Übersetzt einen GalleryFilter in die Query-Param-Form
 *  die GET /galleries akzeptiert. */
function filterToQueryString(filter?: GalleryFilter): string {
  if (!filter) return "";
  const params = new URLSearchParams();
  if (filter.tagIds && filter.tagIds.length > 0) {
    params.set("tag", filter.tagIds.join(","));
  }
  if (filter.mode) params.set("mode", filter.mode);
  if (filter.status) params.set("status", filter.status);
  if (filter.since) params.set("since", filter.since);
  if (filter.until) params.set("until", filter.until);
  return params.toString();
}

export { API_URL, ApiError };
