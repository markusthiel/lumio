/**
 * Lumio API — Storage Service
 *
 * Wrapper um den S3-Client und die Generierung der Storage-Keys.
 *
 * Key-Layout (deterministisch, damit man Tenants/Galerien gezielt löschen kann):
 *   t/<tenant-uuid>/g/<gallery-uuid>/orig/<file-uuid>/<original-filename>
 *   t/<tenant-uuid>/g/<gallery-uuid>/r/<file-uuid>/<kind>.<ext>
 *   t/<tenant-uuid>/downloads/<gallery-uuid>/<label>_<ts>.zip
 *
 * Originalnamen werden im Key beibehalten (URL-encoded), damit Download-Header
 * sauber funktioniert und der S3-Browser intuitiv ist.
 */
import {
  S3Client,
  DeleteObjectCommand,
  ListObjectVersionsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  PutObjectCommand,
  GetObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  type CompletedPart,
} from "@aws-sdk/client-s3";

import { config } from "../config.js";
import { logger } from "../logger.js";

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------
// Wir halten ZWEI S3-Clients:
//
//   - _client (intern): Endpoint ist die container-interne Adresse, z.B.
//     http://minio:9000. Wird für Server-zu-Server-Calls verwendet (delete,
//     head, multipart-complete usw.). Niemals Browser-sichtbar.
//
//   - _publicClient (presign): Endpoint ist der public Endpoint, den der
//     Browser erreicht — typischerweise gleich dem PUBLIC_URL mit einem
//     /s3-Prefix, das Caddy zu minio:9000 weiterreicht. Wird ausschließlich
//     zur Erzeugung von presigned URLs verwendet, die anschließend an den
//     Browser ausgeliefert werden.
//
// Wenn S3_PUBLIC_URL nicht gesetzt ist, fällt der Public-Client auf den
// internen Endpoint zurück. Das ist nur für reine Server-Side-Setups (kein
// Browser-Upload) oder echtes externes S3 ohne Reverse-Proxy korrekt.
let _client: S3Client | null = null;
let _publicClient: S3Client | null = null;

function makeClient(endpoint: string): S3Client {
  return new S3Client({
    endpoint,
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    // AWS SDK v3 (>= 3.729) berechnet bei PutObject standardmäßig eine
    // CRC32-Checksum und nimmt die zugehörigen Header in die Signatur
    // einer presigned URL auf. Browser-Uploads (fetch PUT) senden diese
    // Header nicht mit → Signatur-Mismatch, im Browser als "Load failed"
    // / "Failed to fetch" sichtbar. Bei S3-kompatiblen Stores wie Hetzner
    // Object Storage daher nur dann berechnen, wenn es wirklich nötig ist.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY,
      secretAccessKey: config.S3_SECRET_KEY,
    },
  });
}

export function getS3Client(): S3Client {
  if (_client) return _client;
  _client = makeClient(config.S3_ENDPOINT);
  logger.info(
    {
      endpoint: config.S3_ENDPOINT,
      bucket: config.S3_BUCKET,
      pathStyle: config.S3_FORCE_PATH_STYLE,
    },
    "s3 client initialized (internal)"
  );
  return _client;
}

function getPublicS3Client(): S3Client {
  if (_publicClient) return _publicClient;
  const publicEndpoint = config.S3_PUBLIC_URL || config.S3_ENDPOINT;
  _publicClient = makeClient(publicEndpoint);
  logger.info(
    { endpoint: publicEndpoint },
    "s3 client initialized (public/presign)"
  );
  return _publicClient;
}

export function getBucket(): string {
  return config.S3_BUCKET;
}

// ---------------------------------------------------------------------------
// Key-Generation
// ---------------------------------------------------------------------------
// Sanitize: bewahrt Buchstaben/Ziffern/_-., ersetzt alles andere durch -
function sanitizeFilename(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 200) // S3-Keys sind großzügig, aber wir bleiben moderat
    .replace(/^-+|-+$/g, "");
}

export function originalKey(opts: {
  tenantId: string;
  galleryId: string;
  fileId: string;
  filename: string;
}): string {
  const safe = sanitizeFilename(opts.filename) || "file";
  return `t/${opts.tenantId}/g/${opts.galleryId}/orig/${opts.fileId}/${safe}`;
}

export function renditionKey(opts: {
  tenantId: string;
  galleryId: string;
  fileId: string;
  kind: string; // thumb | preview | web | watermarked | poster | hls | sprite
  extension: string; // webp | jpg | mp4 | m3u8 | ...
  // Seiten-Index fuer mehrseitige Dokumente (PDF). 0/undefined = keine
  // Seite (unveraenderter Key, rueckwaertskompatibel zu Bestands-Renditions).
  page?: number;
}): string {
  const pageSuffix = opts.page && opts.page > 0 ? `_p${opts.page}` : "";
  return `t/${opts.tenantId}/g/${opts.galleryId}/r/${opts.fileId}/${opts.kind}${pageSuffix}.${opts.extension}`;
}

export function downloadKey(opts: {
  tenantId: string;
  galleryId: string;
  label: string;
}): string {
  const safe = sanitizeFilename(opts.label) || "download";
  return `t/${opts.tenantId}/downloads/${opts.galleryId}/${safe}_${Date.now()}.zip`;
}

// ---------------------------------------------------------------------------
// Presigned URLs
// ---------------------------------------------------------------------------
const PRESIGN_PUT_TTL = 3600; // 1h für Uploads
const PRESIGN_GET_TTL = 3600; // 1h für Downloads

export async function presignPut(opts: {
  key: string;
  contentType: string;
  contentLength?: number;
  ttlSeconds?: number;
}): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: getBucket(),
    Key: opts.key,
    ContentType: opts.contentType,
    ContentLength: opts.contentLength,
  });
  return getSignedUrl(getPublicS3Client(), cmd, {
    expiresIn: opts.ttlSeconds ?? PRESIGN_PUT_TTL,
  });
}

export async function presignGet(opts: {
  key: string;
  ttlSeconds?: number;
  responseContentDisposition?: string;
}): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: getBucket(),
    Key: opts.key,
    ResponseContentDisposition: opts.responseContentDisposition,
  });
  return getSignedUrl(getPublicS3Client(), cmd, {
    expiresIn: opts.ttlSeconds ?? PRESIGN_GET_TTL,
  });
}

// ---------------------------------------------------------------------------
// Object-Stream (server-seitiger Read, KEIN presign)
// ---------------------------------------------------------------------------
// Liest ein Objekt über den INTERNEN Client und gibt den Node-Stream zurück,
// damit die API die Bytes selbst an den Browser durchreichen kann. Gebraucht
// für den Customer-"Blob"-Endpoint: der Web-Share-Flow auf iOS braucht die
// Datei-Bytes per fetch(), und cross-origin-fetch auf eine presigned
// Object-Storage-URL scheitert mangels CORS-Header am Bucket. Indem die API
// (die bereits CORS für die Frontend-Origin macht) die Bytes streamt, ist der
// fetch same-origin-konform.
//
// Bewusst NUR für Einzeldateien gedacht (Share eines Bilds), nicht für ZIPs —
// die laufen weiterhin über presigned Redirects, damit die API-Bandbreite
// nicht belastet wird.
export async function getObjectStream(key: string): Promise<{
  body: NodeJS.ReadableStream;
  contentLength?: number;
  contentType?: string;
}> {
  const res = await getS3Client().send(
    new GetObjectCommand({ Bucket: getBucket(), Key: key })
  );
  if (!res.Body) {
    throw new Error(`getObjectStream: empty body for key ${key}`);
  }
  return {
    body: res.Body as unknown as NodeJS.ReadableStream,
    contentLength: res.ContentLength,
    contentType: res.ContentType,
  };
}

// ---------------------------------------------------------------------------
// Multipart Upload (für große Files > 100 MB)
// ---------------------------------------------------------------------------
// Wir verwenden Multipart, sobald sizeBytes > 100 MB.
// Standard-Chunk-Größe: 8 MB (per .env konfigurierbar).
export const MULTIPART_THRESHOLD = 100 * 1024 * 1024;

export function chunkSizeBytes(): number {
  return Number(process.env.UPLOAD_CHUNK_SIZE_MIB ?? 8) * 1024 * 1024;
}

export function numberOfParts(sizeBytes: number): number {
  return Math.max(1, Math.ceil(sizeBytes / chunkSizeBytes()));
}

export async function createMultipartUpload(opts: {
  key: string;
  contentType: string;
}): Promise<{ uploadId: string }> {
  const res = await getS3Client().send(
    new CreateMultipartUploadCommand({
      Bucket: getBucket(),
      Key: opts.key,
      ContentType: opts.contentType,
    })
  );
  if (!res.UploadId) throw new Error("S3 did not return UploadId");
  return { uploadId: res.UploadId };
}

export async function presignUploadPart(opts: {
  key: string;
  uploadId: string;
  partNumber: number; // 1-basiert
  ttlSeconds?: number;
}): Promise<string> {
  const cmd = new UploadPartCommand({
    Bucket: getBucket(),
    Key: opts.key,
    UploadId: opts.uploadId,
    PartNumber: opts.partNumber,
  });
  return getSignedUrl(getPublicS3Client(), cmd, {
    expiresIn: opts.ttlSeconds ?? PRESIGN_PUT_TTL,
  });
}

export async function completeMultipartUpload(opts: {
  key: string;
  uploadId: string;
  parts: CompletedPart[];
}): Promise<void> {
  await getS3Client().send(
    new CompleteMultipartUploadCommand({
      Bucket: getBucket(),
      Key: opts.key,
      UploadId: opts.uploadId,
      MultipartUpload: {
        Parts: opts.parts.sort(
          (a, b) => (a.PartNumber ?? 0) - (b.PartNumber ?? 0)
        ),
      },
    })
  );
}

export async function abortMultipartUpload(opts: {
  key: string;
  uploadId: string;
}): Promise<void> {
  await getS3Client()
    .send(
      new AbortMultipartUploadCommand({
        Bucket: getBucket(),
        Key: opts.key,
        UploadId: opts.uploadId,
      })
    )
    .catch((err) => {
      logger.warn({ err, key: opts.key }, "failed to abort multipart upload");
    });
}

// ---------------------------------------------------------------------------
// Delete (für Gallery-/File-Löschung)
// ---------------------------------------------------------------------------
export async function deleteObject(key: string): Promise<void> {
  await getS3Client().send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: key })
  );
}

// ---------------------------------------------------------------------------
// Recovery: gelöschte Originale aufspüren (versionierter Bucket)
// ---------------------------------------------------------------------------
/**
 * Findet die Galerie-IDs eines Tenants, unter denen aktuell GELÖSCHTE
 * Originale liegen, die sich aus den noncurrent S3-Versionen noch
 * wiederherstellen lassen. Grundlage: ein Original ist "gelöscht", wenn
 * seine aktuelle Objekt-Version ein Delete-Marker ist (IsLatest). Das
 * Key-Layout ist t/<tenant>/g/<gallery>/orig/<file>/<name>.
 *
 * Setzt Bucket-Versioning voraus. Auf nicht-versionierten Buckets liefert
 * list_object_versions keine DeleteMarkers → leeres Ergebnis.
 */
export async function listDeletedOriginalGalleries(
  tenantId: string
): Promise<string[]> {
  const client = getS3Client();
  const bucket = getBucket();
  const prefix = `t/${tenantId}/g/`;
  const galleries = new Set<string>();

  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;
  // Sicherheitslimit gegen Endlosschleifen bei riesigen Buckets.
  for (let page = 0; page < 1000; page++) {
    const res = await client.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        Prefix: prefix,
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
      })
    );
    for (const dm of res.DeleteMarkers ?? []) {
      if (!dm.IsLatest || !dm.Key) continue;
      // Nur Originale (nicht Renditions/Downloads).
      const m = dm.Key.match(/^t\/[^/]+\/g\/([^/]+)\/orig\//);
      if (m) galleries.add(m[1]);
    }
    if (!res.IsTruncated) break;
    keyMarker = res.NextKeyMarker;
    versionIdMarker = res.NextVersionIdMarker;
  }

  return [...galleries];
}
