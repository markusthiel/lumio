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

/** Optionale Upload-Konfiguration. Wird vom Caller (Studio-Page,
 *  Upload-Link-Page) gesetzt — typischerweise basierend auf
 *  `navigator.connection.effectiveType` oder einem manuellen Toggle. */
export interface UploadOptions {
  /** Wenn true: nur 1 paralleles File, 1 paralleler Part. Sonst zwei
   *  Lanes (4 Bilder + 2 Videos/Multipart parallel, je bis 4 Parts).
   *  Spart bei langsamem Mobilnetz Bandbreite (parallele Streams
   *  konkurrieren um die schmale Uplink-Connection und reduzieren
   *  den Gesamt-Durchsatz). Default false. */
  slowConnection?: boolean;
}

// Anzahl paralleler Uploads, getrennt nach Lanes: Bilder/kleine Dateien
// laufen in der Fast-Lane, Videos und Multipart-Uploads (grosse Dateien)
// in der Heavy-Lane. Ohne Trennung belegten drei Videos drei der vier
// Slots ueber Minuten und viele kleine Bilder tropften einzeln durch —
// dieselbe Verhungerungs-Klasse wie beim Worker (v0.53.0). Bei langsamer
// Verbindung (slowConnection=true) laeuft alles strikt seriell.
const PARALLEL_IMAGE_UPLOADS_FAST = 4;
const PARALLEL_VIDEO_UPLOADS_FAST = 2;
const PARALLEL_PARTS_FAST = 4;
const PARALLEL_PARTS_SLOW = 1;

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
  onProgress: ProgressCallback,
  options?: UploadOptions
): Promise<void> {
  if (files.length === 0) return;
  const slow = options?.slowConnection ?? false;
  const parallelParts = slow ? PARALLEL_PARTS_SLOW : PARALLEL_PARTS_FAST;

  type Work = { file: File; init: UploadInit };
  // Zwei Lanes: Videos und Multipart-Uploads (= grosse Dateien, auch
  // z.B. RAW/PSD) in die Heavy-Queue, alles andere in die Image-Queue.
  const imageQueue: Work[] = [];
  const videoQueue: Work[] = [];
  let initDone = false;
  let initError: unknown = null;

  // ALLE wartenden Worker wecken. Vorher wurde nur der zuletzt
  // registrierte Waiter gespeichert — gingen zwei Worker gleichzeitig
  // in den Wartezustand (Init langsamer als die Uploads), wurde einer
  // nie wieder geweckt und uploadFiles resolvte nie: die Upload-Anzeige
  // blieb dann trotz fertiger Dateien fuer immer stehen.
  let waiters: Array<() => void> = [];
  function notifyWorkers() {
    const toWake = waiters;
    waiters = [];
    for (const fn of toWake) fn();
  }
  function waitForWork(): Promise<void> {
    return new Promise((resolve) => {
      waiters.push(resolve);
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
          const heavy =
            init.method === "multipart" || file.type.startsWith("video/");
          (heavy ? videoQueue : imageQueue).push({ file, init });
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

  async function uploadWorker(queues: Work[][]): Promise<void> {
    while (true) {
      let w: Work | undefined;
      for (const q of queues) {
        w = q.shift();
        if (w) break;
      }
      if (!w) {
        if (initDone) return;
        await waitForWork();
        continue;
      }
      try {
        await uploadOne(
          w.file,
          w.init,
          (p) => {
            onProgress({
              fileId: w.init.fileId,
              filename: w.file.name,
              status: "uploading",
              progress: p,
            });
          },
          parallelParts
        );
        onProgress({
          fileId: w.init.fileId,
          filename: w.file.name,
          status: "processing",
          progress: 1,
        });
      } catch (err) {
        reportFailure(w.init.fileId, err);
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

  const workers: Array<Promise<void>> = [];
  if (slow) {
    // Langsame Verbindung: strikt seriell ueber beide Lanes — parallele
    // Streams wuerden sich die schmale Uplink-Connection zerteilen.
    workers.push(uploadWorker([imageQueue, videoQueue]));
  } else {
    const imgWorkers = Math.min(PARALLEL_IMAGE_UPLOADS_FAST, files.length);
    for (let i = 0; i < imgWorkers; i++) {
      workers.push(uploadWorker([imageQueue]));
    }
    for (let i = 0; i < PARALLEL_VIDEO_UPLOADS_FAST; i++) {
      workers.push(uploadWorker([videoQueue]));
    }
  }
  await Promise.all([runInits(), ...workers]);

  if (initError) throw initError;
}

// ---------------------------------------------------------------------------
// Robustness-Konstanten
// ---------------------------------------------------------------------------
// Wieviele Sekunden ohne ANY Progress-Event bevor wir das XHR abbrechen
// und retryen. Browser geben uns kein Signal wenn ein XHR "hängt" — die
// Connection könnte auf eine TCP-Retransmission warten, auf einen
// Connection-Pool-Slot, oder S3 antwortet einfach nicht mehr. 30 s ist
// großzügig genug für RAW-Uploads über langsame Verbindungen, knapp
// genug dass User nicht 5 Min auf eine tote Connection warten.
const STALL_TIMEOUT_MS = 30_000;

// Pro Single-PUT bzw. Multipart-Part: wieviele Versuche insgesamt?
// 1 = nur einmal versuchen, kein Retry. 3 = original + 2 retries.
const MAX_ATTEMPTS = 3;

// Exponential Backoff zwischen Retries: 1s, 2s, 4s, ...
const BACKOFF_BASE_MS = 1_000;

// HTTP-Status die "presigned URL ist abgelaufen / kaputt" bedeuten.
// Bei diesen Codes lohnt sich ein Resign — bei 5xx oder Network-Fail
// retryen wir mit derselben URL (kurze Pause).
const RESIGN_HTTP_CODES = new Set([400, 403, 410]);

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Single-File-Upload
// ---------------------------------------------------------------------------
async function uploadOne(
  file: File,
  init: UploadInit,
  onProgress: (p: number) => void,
  parallelParts: number
): Promise<void> {
  if (init.method === "single") {
    await uploadSingle(file, init, onProgress);
  } else {
    await uploadMultipart(file, init, onProgress, parallelParts);
  }
}

async function uploadSingle(
  file: File,
  init: UploadInit,
  onProgress: (p: number) => void
): Promise<void> {
  if (!init.uploadUrl) throw new Error("missing uploadUrl");

  let url = init.uploadUrl;
  let headers = init.headers ?? {};
  let lastErr: PutError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await putWithProgress(url, file, headers, onProgress);
      lastErr = null;
      break;
    } catch (err) {
      const pe = err as PutError;
      lastErr = pe;

      if (attempt >= MAX_ATTEMPTS) break;

      // Bei expired/forbidden frische URL holen
      if (pe.httpStatus && RESIGN_HTTP_CODES.has(pe.httpStatus)) {
        try {
          const fresh = await api.resignUpload(init.fileId);
          if (fresh.method === "single" && fresh.uploadUrl) {
            url = fresh.uploadUrl;
            headers = fresh.headers ?? headers;
          }
        } catch {
          // Resign selbst gefailed (z.B. 409 weil File schon ready) — kein
          // weiterer Retry, Original-Fehler bleibt
          break;
        }
      }

      await sleep(BACKOFF_BASE_MS * Math.pow(2, attempt - 1));
    }
  }
  if (lastErr) throw lastErr;

  await api.completeUpload({ fileId: init.fileId });
}

async function uploadMultipart(
  file: File,
  init: UploadInit,
  onProgress: (p: number) => void,
  parallelParts: number
): Promise<void> {
  if (!init.parts || !init.partSize || !init.uploadId) {
    throw new Error("invalid multipart init");
  }
  const partSize = init.partSize;
  const uploadId = init.uploadId;
  // partUrls können bei Resign aktualisiert werden — daher mutable Map
  // partNumber → uploadUrl.
  const partUrls = new Map<number, string>(
    init.parts.map((p) => [p.partNumber, p.uploadUrl])
  );
  const partNumbers = init.parts.map((p) => p.partNumber);

  const partProgress = new Array(partNumbers.length).fill(0);
  const reportTotal = () => {
    const total =
      partProgress.reduce((sum, x) => sum + x, 0) / partNumbers.length;
    onProgress(total);
  };

  const completed: { partNumber: number; eTag: string }[] = [];

  // Worker-Pool für Parts
  let nextPartIdx = 0;
  async function uploadNextPart(): Promise<void> {
    while (true) {
      const idx = nextPartIdx++;
      if (idx >= partNumbers.length) return;
      const partNumber = partNumbers[idx];
      const start = (partNumber - 1) * partSize;
      const end = Math.min(start + partSize, file.size);
      const blob = file.slice(start, end);

      let lastErr: PutError | null = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const url = partUrls.get(partNumber)!;
        try {
          const eTag = await putPartWithProgress(url, blob, (p) => {
            partProgress[idx] = p;
            reportTotal();
          });
          completed.push({ partNumber, eTag });
          lastErr = null;
          break;
        } catch (err) {
          const pe = err as PutError;
          lastErr = pe;

          if (attempt >= MAX_ATTEMPTS) break;

          if (pe.httpStatus && RESIGN_HTTP_CODES.has(pe.httpStatus)) {
            // Frische URL nur für DIESEN Part holen — die anderen
            // Parts haben evtl. noch valide URLs (selbe Init-Response,
            // selbe TTL — meist alle gleichzeitig expired, aber wir
            // resignen pro Part on-demand und sind dadurch robust
            // gegen partielle Probleme).
            try {
              const fresh = await api.resignUpload(init.fileId, {
                uploadId,
                partNumbers: [partNumber],
              });
              if (fresh.method === "multipart" && fresh.parts) {
                for (const p of fresh.parts) {
                  partUrls.set(p.partNumber, p.uploadUrl);
                }
              }
            } catch {
              break;
            }
          }

          await sleep(BACKOFF_BASE_MS * Math.pow(2, attempt - 1));
        }
      }
      if (lastErr) throw lastErr;
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(parallelParts, partNumbers.length) },
      uploadNextPart
    )
  );

  await api.completeUpload({
    fileId: init.fileId,
    uploadId,
    parts: completed.sort((a, b) => a.partNumber - b.partNumber),
  });
}

// ---------------------------------------------------------------------------
// PUT mit Progress (XHR — fetch hat keinen Upload-Progress)
// ---------------------------------------------------------------------------
/** Fehler aus putWithProgress / putPartWithProgress. Trägt den HTTP-Status
 *  als Feld (falls vorhanden), damit der Caller "expired" von "transient
 *  network glitch" unterscheiden kann. */
type PutErrorKind = "network" | "http" | "stall" | "etag";

class PutError extends Error {
  httpStatus?: number;
  kind: PutErrorKind;
  /** Host der Upload-URL (ohne Pfad/Query — die Query trägt die Signatur
   *  und darf nie in Logs landen). */
  targetHost?: string;
  constructor(
    message: string,
    httpStatus?: number,
    kind: PutErrorKind = httpStatus ? "http" : "network",
    url?: string
  ) {
    super(message);
    this.httpStatus = httpStatus;
    this.kind = kind;
    this.targetHost = hostOf(url);
  }
}

function hostOf(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/** Meldet einen endgültig gescheiterten Upload an die API, damit er im
 *  API-Log auftaucht. Ein blockierter Browser-Upload (z.B. CORS am Bucket)
 *  erreicht weder Lumio noch den Storage — ohne diese Meldung sieht ihn
 *  nur der Browser des Nutzers. Best-effort: Fehler hier werden geschluckt. */
function reportFailure(fileId: string, err: unknown) {
  const pe = err instanceof PutError ? err : null;
  void api
    .reportUploadFailure(fileId, {
      kind: pe?.kind ?? "other",
      httpStatus: pe?.httpStatus,
      targetHost: pe?.targetHost,
      pageHost: typeof location !== "undefined" ? location.host : undefined,
      message: (err instanceof Error ? err.message : String(err)).slice(0, 300),
    })
    .catch(() => {});
}

function putWithProgress(
  url: string,
  body: Blob | File,
  headers: Record<string, string>,
  onProgress: (p: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    let lastProgressAt = Date.now();

    function resetStallTimer() {
      lastProgressAt = Date.now();
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        // Kein Progress-Event in STALL_TIMEOUT_MS — XHR abbrechen, der
        // onerror/onabort-Handler löst dann das Promise mit Fehler.
        try {
          xhr.abort();
        } catch {
          /* noop */
        }
      }, STALL_TIMEOUT_MS);
    }

    function cleanup() {
      if (stallTimer) {
        clearTimeout(stallTimer);
        stallTimer = null;
      }
    }

    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) {
      xhr.setRequestHeader(k, v);
    }
    xhr.upload.onprogress = (e) => {
      resetStallTimer();
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve();
      } else {
        reject(new PutError(`upload failed: HTTP ${xhr.status}`, xhr.status, "http", url));
      }
    };
    xhr.onerror = () => {
      cleanup();
      reject(new PutError("network error during upload", undefined, "network", url));
    };
    xhr.onabort = () => {
      cleanup();
      const sinceProgress = Date.now() - lastProgressAt;
      reject(
        new PutError(
          `upload stalled (no progress for ${Math.round(sinceProgress / 1000)}s)`,
          undefined,
          "stall",
          url
        )
      );
    };

    resetStallTimer();
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
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    let lastProgressAt = Date.now();

    function resetStallTimer() {
      lastProgressAt = Date.now();
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        try {
          xhr.abort();
        } catch {
          /* noop */
        }
      }, STALL_TIMEOUT_MS);
    }
    function cleanup() {
      if (stallTimer) {
        clearTimeout(stallTimer);
        stallTimer = null;
      }
    }

    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => {
      resetStallTimer();
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        const eTag = xhr.getResponseHeader("ETag");
        if (!eTag) {
          reject(
            new PutError(
              "S3 did not return ETag — check CORS ExposedHeaders",
              undefined,
              "etag",
              url
            )
          );
          return;
        }
        onProgress(1);
        resolve(eTag.replace(/"/g, ""));
      } else {
        reject(
          new PutError(`part upload failed: HTTP ${xhr.status}`, xhr.status, "http", url)
        );
      }
    };
    xhr.onerror = () => {
      cleanup();
      reject(new PutError("network error during part upload", undefined, "network", url));
    };
    xhr.onabort = () => {
      cleanup();
      const sinceProgress = Date.now() - lastProgressAt;
      reject(
        new PutError(
          `part upload stalled (no progress for ${Math.round(sinceProgress / 1000)}s)`,
          undefined,
          "stall",
          url
        )
      );
    };

    resetStallTimer();
    xhr.send(body);
  });
}
