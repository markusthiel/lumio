/**
 * Lumio Frontend — Direkt-zu-S3 Upload
 *
 * Lädt Files direkt von Browser zu S3 hoch (via Presigned URLs).
 * Unterstützt sowohl Single-PUT als auch Multipart-Uploads.
 *
 * Pro File:
 *   1. initUpload() — API liefert UploadInit
 *   2. Single-Modus:    fetch PUT mit Progress
 *      Multipart-Modus: parallele Part-PUTs, ETag pro Part sammeln
 *   3. completeUpload() — API teilt S3 das Multipart-Completion mit
 *                          und queued Worker-Job
 */
import { api, type UploadInit } from "./api";

export interface UploadProgress {
  fileId: string;
  filename: string;
  status: "queued" | "uploading" | "processing" | "ready" | "failed";
  progress: number; // 0..1
  error?: string;
}

export type ProgressCallback = (p: UploadProgress) => void;

// Anzahl paralleler Single-PUTs bzw. Multipart-Parts
const PARALLEL_UPLOADS = 4;
const PARALLEL_PARTS = 4;

/**
 * Lädt alle übergebenen Files in die Galerie hoch. Ruft `onProgress`
 * pro File für State-Updates auf.
 */
export async function uploadFiles(
  galleryId: string,
  files: File[],
  onProgress: ProgressCallback
): Promise<void> {
  // 1) Init holen — alle Files in einem Request
  const initResp = await api.initUpload(
    galleryId,
    files.map((f) => ({
      filename: f.name,
      sizeBytes: f.size,
      mimeType: f.type || "application/octet-stream",
    }))
  );

  // Map fileId → File (Browser-Objekt) und UploadInit zusammenführen
  const work: Array<{ file: File; init: UploadInit }> = initResp.uploads.map(
    (init, i) => ({ file: files[i], init })
  );

  // Initialer State pro File
  for (const w of work) {
    onProgress({
      fileId: w.init.fileId,
      filename: w.file.name,
      status: "queued",
      progress: 0,
    });
  }

  // 2) Parallelisierter Upload mit Worker-Pool-Pattern
  let cursor = 0;
  async function nextJob(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= work.length) return;
      const w = work[idx];
      try {
        await uploadOne(w.file, w.init, (p) => {
          onProgress({
            fileId: w.init.fileId,
            filename: w.file.name,
            status: "uploading",
            progress: p,
          });
        });
        onProgress({
          fileId: w.init.fileId,
          filename: w.file.name,
          status: "processing",
          progress: 1,
        });
      } catch (err) {
        onProgress({
          fileId: w.init.fileId,
          filename: w.file.name,
          status: "failed",
          progress: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(PARALLEL_UPLOADS, work.length) }, nextJob)
  );
}

// ---------------------------------------------------------------------------
// Einzelner File-Upload
// ---------------------------------------------------------------------------
async function uploadOne(
  file: File,
  init: UploadInit,
  onProgress: (p: number) => void
): Promise<void> {
  if (init.method === "single") {
    await uploadSingle(file, init, onProgress);
  } else {
    await uploadMultipart(file, init, onProgress);
  }
}

async function uploadSingle(
  file: File,
  init: UploadInit,
  onProgress: (p: number) => void
): Promise<void> {
  if (!init.uploadUrl) throw new Error("missing uploadUrl");
  await putWithProgress(init.uploadUrl, file, init.headers ?? {}, onProgress);
  await api.completeUpload({ fileId: init.fileId });
}

async function uploadMultipart(
  file: File,
  init: UploadInit,
  onProgress: (p: number) => void
): Promise<void> {
  if (!init.parts || !init.partSize || !init.uploadId) {
    throw new Error("invalid multipart init");
  }
  const partSize = init.partSize;
  const parts = init.parts;

  const partProgress = new Array(parts.length).fill(0);
  const reportTotal = () => {
    const total = partProgress.reduce((sum, x) => sum + x, 0) / parts.length;
    onProgress(total);
  };

  const completed: { partNumber: number; eTag: string }[] = [];

  // Worker-Pool für Parts
  let nextPartIdx = 0;
  async function uploadNextPart(): Promise<void> {
    while (true) {
      const idx = nextPartIdx++;
      if (idx >= parts.length) return;
      const part = parts[idx];
      const start = (part.partNumber - 1) * partSize;
      const end = Math.min(start + partSize, file.size);
      const blob = file.slice(start, end);

      const eTag = await putPartWithProgress(
        part.uploadUrl,
        blob,
        (p) => {
          partProgress[idx] = p;
          reportTotal();
        }
      );
      completed.push({ partNumber: part.partNumber, eTag });
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(PARALLEL_PARTS, parts.length) }, uploadNextPart)
  );

  await api.completeUpload({
    fileId: init.fileId,
    uploadId: init.uploadId,
    parts: completed.sort((a, b) => a.partNumber - b.partNumber),
  });
}

// ---------------------------------------------------------------------------
// PUT mit Progress (XHR — fetch hat keinen Upload-Progress)
// ---------------------------------------------------------------------------
function putWithProgress(
  url: string,
  body: Blob | File,
  headers: Record<string, string>,
  onProgress: (p: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) {
      xhr.setRequestHeader(k, v);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve();
      } else {
        reject(new Error(`upload failed: HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("network error during upload"));
    xhr.send(body);
  });
}

// Wie putWithProgress, aber gibt den ETag-Response-Header zurück (für Multipart)
function putPartWithProgress(
  url: string,
  body: Blob,
  onProgress: (p: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const eTag = xhr.getResponseHeader("ETag");
        if (!eTag) {
          reject(new Error("S3 did not return ETag — check CORS ExposedHeaders"));
          return;
        }
        onProgress(1);
        resolve(eTag.replace(/"/g, ""));
      } else {
        reject(new Error(`part upload failed: HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("network error during part upload"));
    xhr.send(body);
  });
}
