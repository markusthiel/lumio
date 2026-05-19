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
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
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
// Client
// ---------------------------------------------------------------------------
let _client: S3Client | null = null;

export function getS3Client(): S3Client {
  if (_client) return _client;
  _client = new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY,
      secretAccessKey: config.S3_SECRET_KEY,
    },
  });
  logger.info(
    {
      endpoint: config.S3_ENDPOINT,
      bucket: config.S3_BUCKET,
      pathStyle: config.S3_FORCE_PATH_STYLE,
    },
    "s3 client initialized"
  );
  return _client;
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
}): string {
  return `t/${opts.tenantId}/g/${opts.galleryId}/r/${opts.fileId}/${opts.kind}.${opts.extension}`;
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
  return getSignedUrl(getS3Client(), cmd, {
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
  return getSignedUrl(getS3Client(), cmd, {
    expiresIn: opts.ttlSeconds ?? PRESIGN_GET_TTL,
  });
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
  return getSignedUrl(getS3Client(), cmd, {
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
