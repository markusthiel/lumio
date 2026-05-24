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

// Wieviele Files pro /uploads/init-Request. Das Backend macht pro File
// 2 DB-Queries + mind. 1 S3-Presign-Call sequentiell — bei 1000 Files in
// einem Init-Call läuft das in ~30+ Sekunden und der HTTP-Request kommt
// in den Proxy-Timeout. Mit Chunks à 50 dauert ein Init <2s, der User
// sieht sofort Progress, und parallel zum Upload der ersten 50 starten
// die nächsten Inits. Das Backend-Schema akzeptiert bis zu 1000 pro
// Call, aber Chunk-Größe 50 ist der Sweet-Spot zwischen Latenz pro
// Init (Round-Trip-Overhead) und Init-Dauer (DB+S3-Last).
const INIT_BATCH_SIZE = 50;

/**
 * Lädt alle übergebenen Files in die Galerie hoch. Ruft `onProgress`
 * pro File für State-Updates auf.
 *
 * Strategie bei vielen Files (z.B. 1000):
 *  1) Init in Chunks à INIT_BATCH_SIZE. Sobald ein Chunk zurück ist,
 *     starten die Uploads dieses Chunks parallel mit den Init-Calls
 *     der weiteren Chunks. Init- und Upload-Phase laufen gleichzeitig
 *     in einer Worker-Pool-Pipeline.
 *  2) `onProgress` wird mit der echten fileId vom Backend gemeldet —
 *     erst sobald der entsprechende Init-Chunk durch ist. UI-Feedback
 *     "X Files ausgewählt" passiert idealerweise im Caller, BEVOR
 *     uploadFiles aufgerufen wird (siehe Upload-Page und Studio-Page).
 *  3) Falls ein Init-Chunk fehlschlägt (z.B. 402 Plan-Limit), werfen
 *     wir den Fehler hoch — Caller entscheidet was angezeigt wird.
 *     Bereits initialisierte/hochgeladene Files in vorherigen Chunks
 *     bleiben erhalten.
 */
export async function uploadFiles(
  galleryId: string,
  files: File[],
  onProgress: ProgressCallback
): Promise<void> {
  if (files.length === 0) return;

  const workQueue: Array<{ file: File; init: UploadInit }> = [];
  let initDone = false;
  let initError: unknown = null;

  let notifyWaiter: (() => void) | null = null;
  function notifyWorkers() {
    if (notifyWaiter) {
      const fn = notifyWaiter;
      notifyWaiter = null;
      fn();
    }
  }
  function waitForWork(): Promise<void> {
    return new Promise((resolve) => {
      notifyWaiter = resolve;
    });
  }

  async function runInits() {
    try {
      for (let off = 0; off < files.length; off += INIT_BATCH_SIZE) {
        const chunk = files.slice(off, off + INIT_BATCH_SIZE);
        const initResp = await api.initUpload(
          galleryId,
          chunk.map((f) => ({
            filename: f.name,
            sizeBytes: f.size,
            mimeType: f.type || "application/octet-stream",
          }))
        );
        for (let i = 0; i < initResp.uploads.length; i++) {
          const init = initResp.uploads[i];
          const file = chunk[i];
          onProgress({
            fileId: init.fileId,
            filename: file.name,
            status: "queued",
            progress: 0,
          });
          workQueue.push({ file, init });
        }
        notifyWorkers();
      }
    } catch (err) {
      initError = err;
    } finally {
      initDone = true;
      notifyWorkers();
    }
  }

  async function uploadWorker(): Promise<void> {
    while (true) {
      const w = workQueue.shift();
      if (!w) {
        if (initDone) return;
        await waitForWork();
        continue;
      }
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

  const workerCount = Math.min(PARALLEL_UPLOADS, files.length);
  const workers = Array.from({ length: workerCount }, uploadWorker);
  await Promise.all([runInits(), ...workers]);

  if (initError) throw initError;
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
