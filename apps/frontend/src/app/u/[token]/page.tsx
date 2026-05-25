"use client";

/**
 * Lumio Public Upload-Page — Drag-and-Drop für externe Uploader
 *
 * Wird über /u/<token> aufgerufen (Token kommt aus dem geteilten Link).
 * Kein Login. Optional Passwort-Eingabe wenn der Link mit Passwort
 * erstellt wurde.
 *
 * Datenschutz: der Uploader sieht NICHT was andere hochgeladen haben.
 * Wir zeigen nach erfolgreichem Upload nur "X hochgeladen", keine
 * Vorschau. Das schützt die Privatsphäre der anderen Gäste.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { api, type UploadInit, ApiError } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useSlowConnection } from "@/lib/useSlowConnection";
import { SlowConnectionToggle } from "@/components/upload/SlowConnectionToggle";

interface Meta {
  label: string;
  galleryTitle: string;
  hasPassword: boolean;
  unlocked: boolean;
  limits: {
    maxFiles: number | null;
    maxBytesTotal: string | null;
    maxFileBytes: string | null;
    /** Effektives Pro-File-Limit aus Tenant + Link + Hard-Cap, als
     * Bytes-String (kommt vom Backend, BigInt-serialisiert). */
    effectivePerFileBytes: string;
    usedFiles: number;
    usedBytes: string;
  };
}

interface FileProgress {
  filename: string;
  status: "queued" | "uploading" | "done" | "failed";
  progress: number;
  error?: string;
}

export default function UploadPage() {
  const t = useT();
  const params = useParams();
  const token = String(params.token ?? "");

  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [uploads, setUploads] = useState<Record<string, FileProgress>>({});
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { slow: slowConnection } = useSlowConnection();

  const loadMeta = useCallback(async () => {
    try {
      const m = await api.getUploadLinkMeta(token);
      setMeta(m);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError(t("upload.notFound"));
      } else {
        setError(err instanceof Error ? err.message : "Error");
      }
    }
  }, [token, t]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;
    setUnlocking(true);
    setError(null);
    try {
      await api.unlockUploadLink(token, password);
      // Re-fetch Meta — server bestätigt unlocked: true via cookie.
      await loadMeta();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError(t("upload.wrongPassword"));
      } else {
        setError(err instanceof Error ? err.message : "Error");
      }
    } finally {
      setUnlocking(false);
    }
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);

    // Initial Status-Map vorbefüllen — User sieht sofort die Liste
    // (statt einer Verzögerung während der Init-Call läuft).
    setUploads((prev) => {
      const next = { ...prev };
      for (const f of files) {
        next[f.name + "::" + f.size] = {
          filename: f.name,
          status: "queued",
          progress: 0,
        };
      }
      return next;
    });

    // Init in Chunks à INIT_BATCH_SIZE — bei vielen Files (z.B. 1000)
    // würde ein einzelner Init-Call mit allen Files in den HTTP-
    // Timeout laufen, weil das Backend pro File 2 DB-Queries + 1+
    // S3-Presign-Calls sequentiell macht. Mit Chunks à 50 sind die
    // ersten Files in <2s upload-bereit, während die nächsten Chunks
    // parallel initialisiert werden. Konservativer als im Studio (3
    // parallele Uploads), Init-Chunks aber identisch.
    const INIT_BATCH_SIZE = 50;
    // Anzahl paralleler Files. 3 als Default (konservativer als Studio
    // wegen Mobil-Netze), aber 1 wenn der Slow-Connection-Modus aktiv
    // ist. Slow-Mode beeinflusst auch parallel-parts in uploadOne unten.
    const PARALLEL = slowConnection ? 1 : 3;
    const PARALLEL_PARTS_THIS_RUN = slowConnection ? 1 : 3;

    const workQueue: Array<{ file: File; init: UploadInit; key: string }> = [];
    let initDone = false;
    let initErr: unknown = null;
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
          try {
            const initRes = await api.initUploadViaLink(
              token,
              chunk.map((f) => ({
                filename: f.name,
                sizeBytes: f.size,
                mimeType: f.type || "application/octet-stream",
              }))
            );
            for (let i = 0; i < initRes.uploads.length; i++) {
              const file = chunk[i];
              const init = initRes.uploads[i];
              workQueue.push({
                file,
                init,
                key: file.name + "::" + file.size,
              });
            }
            notifyWorkers();
          } catch (err) {
            // Diesen Chunk auf 'failed' markieren — andere Chunks
            // könnten noch erfolgreich sein. Wir setzen den Fehler
            // aber als globalen initErr, sodass der finally-Block
            // unten ein 402/Plan-Limit z.B. korrekt verarbeiten kann.
            const msg = err instanceof Error ? err.message : String(err);
            setUploads((prev) => {
              const next = { ...prev };
              for (const f of chunk) {
                const k = f.name + "::" + f.size;
                if (next[k]?.status === "queued") {
                  next[k] = { ...next[k], status: "failed", error: msg };
                }
              }
              return next;
            });
            throw err;
          }
        }
      } catch (err) {
        initErr = err;
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
          setUploads((prev) => ({
            ...prev,
            [w.key]: { ...prev[w.key], status: "uploading", progress: 0 },
          }));
          await uploadOne(
            token,
            w.file,
            w.init,
            (p) => {
              setUploads((prev) => ({
                ...prev,
                [w.key]: { ...prev[w.key], progress: p },
              }));
            },
            PARALLEL_PARTS_THIS_RUN
          );
          setUploads((prev) => ({
            ...prev,
            [w.key]: { ...prev[w.key], status: "done", progress: 1 },
          }));
        } catch (err) {
          setUploads((prev) => ({
            ...prev,
            [w.key]: {
              ...prev[w.key],
              status: "failed",
              error: err instanceof Error ? err.message : String(err),
            },
          }));
        }
      }
    }

    const workerCount = Math.min(PARALLEL, files.length);
    await Promise.all([
      runInits(),
      ...Array.from({ length: workerCount }, uploadWorker),
    ]);

    // Meta neu laden — usedFiles + usedBytes sind jetzt höher
    await loadMeta();

    if (initErr) {
      // Inits sind bereits per-Chunk auf 'failed' gesetzt; hier nur
      // noch defensiv loggen, damit auch der letzte Stand sichtbar ist.
      console.error("upload-link init error", initErr);
    }
  }

  if (error && !meta) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-canvas px-4">
        <div className="max-w-md w-full text-center space-y-4">
          <h1 className="text-display-md text-ink-primary">{t("upload.notFoundHeading")}</h1>
          <p className="text-ui text-ink-tertiary">{error}</p>
        </div>
      </div>
    );
  }

  if (!meta) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-canvas">
        <div className="text-ui text-ink-tertiary">{t("upload.loading")}</div>
      </div>
    );
  }

  // Passwort-Gate
  if (meta.hasPassword && !meta.unlocked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-canvas px-4">
        <form
          onSubmit={unlock}
          className="max-w-sm w-full bg-surface-raised border border-line-subtle rounded-lg p-6 space-y-4"
        >
          <div className="text-center space-y-1">
            <h1 className="text-display-sm text-ink-primary">{meta.label}</h1>
            <p className="text-ui-sm text-ink-tertiary">
              {t("upload.passwordHeading")}
            </p>
          </div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("upload.passwordPlaceholder")}
            autoFocus
            className="w-full bg-surface-canvas border border-line-subtle rounded px-3 py-2 text-ink-primary focus:outline-none focus:border-accent transition-colors duration-motion"
          />
          {error && (
            <div className="text-ui-sm text-semantic-danger">{error}</div>
          )}
          <button
            type="submit"
            disabled={unlocking || !password.trim()}
            className="w-full h-10 rounded bg-accent text-accent-contrast font-medium disabled:opacity-50 hover:bg-accent-hover transition-colors duration-motion"
          >
            {unlocking ? t("common.verifying") : t("common.verify")}
          </button>
        </form>
      </div>
    );
  }

  // Upload-Bereich
  const uploadList = Object.values(uploads);
  const totalDone = uploadList.filter((u) => u.status === "done").length;
  const totalFailed = uploadList.filter((u) => u.status === "failed").length;
  const uploading = uploadList.some(
    (u) => u.status === "uploading" || u.status === "queued"
  );

  // Limit-Hinweis berechnen
  let limitHint: string | null = null;
  if (meta.limits.maxFiles !== null) {
    const remaining = meta.limits.maxFiles - meta.limits.usedFiles;
    if (remaining <= 0) {
      limitHint = t("upload.limitReachedFiles");
    } else if (remaining < 10) {
      limitHint = t("upload.limitRemainingFiles", { count: remaining });
    }
  }
  if (!limitHint && meta.limits.maxBytesTotal) {
    const max = Number(meta.limits.maxBytesTotal);
    const used = Number(meta.limits.usedBytes);
    const usedPct = (used / max) * 100;
    if (usedPct >= 100) {
      limitHint = t("upload.limitReachedBytes");
    } else if (usedPct >= 90) {
      const remainingMB = ((max - used) / 1024 / 1024).toFixed(0);
      limitHint = t("upload.limitRemainingBytes", { mb: remainingMB });
    }
  }

  const limitExhausted =
    (meta.limits.maxFiles !== null &&
      meta.limits.usedFiles >= meta.limits.maxFiles) ||
    (meta.limits.maxBytesTotal !== null &&
      Number(meta.limits.usedBytes) >= Number(meta.limits.maxBytesTotal));

  return (
    <div className="min-h-screen bg-surface-canvas px-4 py-8 flex flex-col items-center">
      <div className="max-w-2xl w-full space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-display-md text-ink-primary">{meta.label}</h1>
          {meta.galleryTitle && (
            <p className="text-ui-sm text-ink-tertiary">
              {t("upload.forGallery", { title: meta.galleryTitle })}
            </p>
          )}
        </div>

        {/* Drop-Zone */}
        {!limitExhausted && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void handleFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg py-16 text-center cursor-pointer transition-colors duration-motion ${
              dragging
                ? "border-accent bg-accent/5"
                : "border-line-subtle hover:border-line-strong"
            }`}
          >
            <div className="text-ui-md text-ink-secondary mb-2">
              {dragging ? t("upload.dropNow") : t("upload.dropHint")}
            </div>
            <div className="text-ui-sm text-ink-tertiary">
              {t("upload.dropOrClick")}
            </div>
            {/* Per-File-Limit-Hinweis: zeigt dem Uploader BEVOR er
                upload-Versuche macht was möglich ist. Spart Frust
                bei großen Video-Files die der Server eh ablehnen
                würde. */}
            <div className="text-ui-xs text-ink-tertiary mt-2">
              {t("upload.maxPerFile", {
                size: formatBytes(
                  Number(meta.limits.effectivePerFileBytes)
                ),
              })}
            </div>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="image/*,video/*"
              className="hidden"
              onChange={(e) => void handleFiles(e.target.files)}
            />
          </div>
        )}

        {/* Slow-Connection Toggle — eigenes Element AUSSERHALB der
            Drop-Zone, damit Klick darauf nicht den File-Picker
            triggert. Auto-Detect via navigator.connection. */}
        {!limitExhausted && (
          <div className="flex justify-end mt-2">
            <SlowConnectionToggle />
          </div>
        )}

        {limitExhausted && (
          <div className="border border-semantic-warning/40 bg-semantic-warning/10 text-ink-primary rounded-lg p-4 text-center">
            {t("upload.limitReachedHeading")}
          </div>
        )}

        {limitHint && (
          <div className="text-ui-sm text-ink-tertiary text-center">
            {limitHint}
          </div>
        )}

        {/* Upload-Liste */}
        {uploadList.length > 0 && (
          <div className="border border-line-subtle rounded-lg divide-y divide-line-subtle">
            {uploadList.map((u, i) => (
              <div key={i} className="p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-ui-sm text-ink-primary truncate">
                    {u.filename}
                  </div>
                  {u.status === "uploading" && (
                    <div className="h-1 mt-1 bg-surface-sunken rounded overflow-hidden">
                      <div
                        className="h-full bg-accent transition-all duration-motion"
                        style={{ width: `${Math.round(u.progress * 100)}%` }}
                      />
                    </div>
                  )}
                  {u.error && (
                    <div className="text-ui-xs text-semantic-danger mt-1">
                      {u.error}
                    </div>
                  )}
                </div>
                <div className="text-ui-xs">
                  {u.status === "queued" && (
                    <span className="text-ink-tertiary">
                      {t("upload.queued")}
                    </span>
                  )}
                  {u.status === "uploading" && (
                    <span className="text-ink-secondary">
                      {Math.round(u.progress * 100)}%
                    </span>
                  )}
                  {u.status === "done" && (
                    <span className="text-semantic-success">✓</span>
                  )}
                  {u.status === "failed" && (
                    <span className="text-semantic-danger">✕</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Success-Summary */}
        {uploadList.length > 0 && !uploading && totalDone > 0 && (
          <div className="border border-semantic-success/40 bg-semantic-success/10 rounded-lg p-4 text-center">
            <div className="text-ui-md text-ink-primary font-medium">
              {t("upload.doneHeading", { count: totalDone })}
            </div>
            <div className="text-ui-sm text-ink-tertiary mt-1">
              {t("upload.doneHint")}
            </div>
            {totalFailed > 0 && (
              <div className="text-ui-sm text-semantic-danger mt-1">
                {t("upload.doneFailed", { count: totalFailed })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upload-Logik — analog zu lib/upload.ts, aber gegen /u/:token-Endpoints
// ---------------------------------------------------------------------------
// Robustheit identisch zum Studio-Upload:
//  - 30 s Stall-Watchdog (kein Progress-Event → abort)
//  - 3 Versuche pro Single-PUT / Multipart-Part mit Exponential Backoff
//  - Bei HTTP 400/403/410: frische URL via resignUploadViaLink holen
const STALL_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 1_000;
const RESIGN_HTTP_CODES = new Set([400, 403, 410]);

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

class PutError extends Error {
  httpStatus?: number;
  constructor(message: string, httpStatus?: number) {
    super(message);
    this.httpStatus = httpStatus;
  }
}

async function uploadOne(
  token: string,
  file: File,
  init: UploadInit,
  onProgress: (p: number) => void,
  parallelParts: number
): Promise<void> {
  if (init.method === "single") {
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
        if (pe.httpStatus && RESIGN_HTTP_CODES.has(pe.httpStatus)) {
          try {
            const fresh = await api.resignUploadViaLink(token, init.fileId);
            if (fresh.method === "single" && fresh.uploadUrl) {
              url = fresh.uploadUrl;
              headers = fresh.headers ?? headers;
            }
          } catch {
            break;
          }
        }
        await sleep(BACKOFF_BASE_MS * Math.pow(2, attempt - 1));
      }
    }
    if (lastErr) throw lastErr;
    await api.completeUploadViaLink(token, init.fileId);
    return;
  }

  // Multipart
  if (!init.parts || !init.uploadId) throw new Error("missing multipart info");
  const partSize = init.partSize ?? 8 * 1024 * 1024;
  const uploadId = init.uploadId;
  const partUrls = new Map<number, string>(
    init.parts.map((p) => [p.partNumber, p.uploadUrl])
  );
  const partNumbers = init.parts.map((p) => p.partNumber);

  // Pro Part: Fortschritt 0..1. Gesamt-Progress = Mittel ueber alle Parts.
  // Vorher: bytesDone nur am Part-Ende — bei einem haengenden grossen
  // Part sah man stundenlang keinen Fortschritt.
  const partProgress = new Array(partNumbers.length).fill(0);
  const reportTotal = () => {
    const total =
      partProgress.reduce((s, x) => s + x, 0) / partNumbers.length;
    onProgress(Math.min(total, 0.99));
  };

  const etags: { partNumber: number; eTag: string }[] = [];

  // parallelParts kommt aus dem Caller (handleFiles in der Komponente)
  // und reflektiert den Slow-Connection-Modus.
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
          etags.push({ partNumber, eTag });
          lastErr = null;
          break;
        } catch (err) {
          const pe = err as PutError;
          lastErr = pe;
          if (attempt >= MAX_ATTEMPTS) break;
          if (pe.httpStatus && RESIGN_HTTP_CODES.has(pe.httpStatus)) {
            try {
              const fresh = await api.resignUploadViaLink(token, init.fileId, {
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
  etags.sort((a, b) => a.partNumber - b.partNumber);
  await api.completeUploadViaLink(token, init.fileId, etags, uploadId);
  onProgress(1);
}

function putWithProgress(
  url: string,
  body: Blob,
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

    xhr.open("PUT", url, true);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
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
        reject(new PutError(`PUT failed: HTTP ${xhr.status}`, xhr.status));
      }
    };
    xhr.onerror = () => {
      cleanup();
      reject(new PutError("network error during upload"));
    };
    xhr.onabort = () => {
      cleanup();
      const sec = Math.round((Date.now() - lastProgressAt) / 1000);
      reject(new PutError(`upload stalled (${sec}s without progress)`));
    };

    resetStallTimer();
    xhr.send(body);
  });
}

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

    xhr.open("PUT", url, true);
    xhr.upload.onprogress = (e) => {
      resetStallTimer();
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        const eTag =
          xhr.getResponseHeader("ETag") ?? xhr.getResponseHeader("etag");
        if (!eTag) {
          reject(
            new PutError("S3 did not return ETag — check CORS ExposedHeaders")
          );
          return;
        }
        onProgress(1);
        resolve(eTag.replace(/"/g, ""));
      } else {
        reject(
          new PutError(`part upload failed: HTTP ${xhr.status}`, xhr.status)
        );
      }
    };
    xhr.onerror = () => {
      cleanup();
      reject(new PutError("network error during part upload"));
    };
    xhr.onabort = () => {
      cleanup();
      const sec = Math.round((Date.now() - lastProgressAt) / 1000);
      reject(new PutError(`part upload stalled (${sec}s without progress)`));
    };

    resetStallTimer();
    xhr.send(body);
  });
}

// Bytes → "X GB" / "Y MB" für User-facing Display in der Drop-Zone.
// Mirror zum formatLimit-Helper im Backend (services/upload-limit.ts).
function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  if (mb >= 1024) {
    const gb = mb / 1024;
    return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  }
  return `${Math.round(mb)} MB`;
}
