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

interface Meta {
  label: string;
  galleryTitle: string;
  hasPassword: boolean;
  unlocked: boolean;
  limits: {
    maxFiles: number | null;
    maxBytesTotal: string | null;
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

    try {
      const initRes = await api.initUploadViaLink(
        token,
        files.map((f) => ({
          filename: f.name,
          sizeBytes: f.size,
          mimeType: f.type || "application/octet-stream",
        }))
      );

      // Map: fileId → Browser-File durch parallel-Index. Backend
      // antwortet in derselben Reihenfolge wie Request.
      const work = initRes.uploads.map((init, i) => ({
        file: files[i],
        init,
      }));

      // Parallelisiert — 3 gleichzeitig, weil Drittparteien oft auf
      // mobilem Netz sind und 4-faches Parallel die Verbindung killt.
      const PARALLEL = 3;
      let cursor = 0;
      async function nextJob(): Promise<void> {
        while (true) {
          const idx = cursor++;
          if (idx >= work.length) return;
          const w = work[idx];
          const key = w.file.name + "::" + w.file.size;
          try {
            setUploads((prev) => ({
              ...prev,
              [key]: { ...prev[key], status: "uploading", progress: 0 },
            }));
            await uploadOne(token, w.file, w.init, (p) => {
              setUploads((prev) => ({
                ...prev,
                [key]: { ...prev[key], progress: p },
              }));
            });
            setUploads((prev) => ({
              ...prev,
              [key]: { ...prev[key], status: "done", progress: 1 },
            }));
          } catch (err) {
            setUploads((prev) => ({
              ...prev,
              [key]: {
                ...prev[key],
                status: "failed",
                error: err instanceof Error ? err.message : String(err),
              },
            }));
          }
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(PARALLEL, work.length) }, nextJob)
      );

      // Meta neu laden — usedFiles + usedBytes sind jetzt höher
      await loadMeta();
    } catch (err) {
      // Init fehlgeschlagen — alle queued auf failed
      const msg = err instanceof Error ? err.message : String(err);
      setUploads((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(next)) {
          if (next[k].status === "queued") {
            next[k] = { ...next[k], status: "failed", error: msg };
          }
        }
        return next;
      });
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
async function uploadOne(
  token: string,
  file: File,
  init: UploadInit,
  onProgress: (p: number) => void
): Promise<void> {
  if (init.method === "single") {
    if (!init.uploadUrl) throw new Error("missing uploadUrl");
    await putWithProgress(init.uploadUrl, file, init.headers ?? {}, onProgress);
    await api.completeUploadViaLink(token, init.fileId);
  } else {
    if (!init.parts || !init.uploadId) throw new Error("missing multipart info");
    const partSize = init.partSize ?? 8 * 1024 * 1024;
    const etags: { partNumber: number; eTag: string }[] = [];
    let bytesDone = 0;

    // Parallele Parts — bei mobilem Netz konservativer als Studio (3
    // statt 4). Network-Effects können sonst die ganze Pipeline blockieren.
    const PARALLEL_PARTS = 3;
    let cursor = 0;
    async function nextPart(): Promise<void> {
      while (true) {
        const idx = cursor++;
        if (idx >= init.parts!.length) return;
        const p = init.parts![idx];
        const start = (p.partNumber - 1) * partSize;
        const end = Math.min(start + partSize, file.size);
        const blob = file.slice(start, end);
        const etag = await putBlob(p.uploadUrl, blob);
        etags.push({ partNumber: p.partNumber, eTag: etag });
        bytesDone += blob.size;
        onProgress(Math.min(bytesDone / file.size, 0.99));
      }
    }
    await Promise.all(
      Array.from(
        { length: Math.min(PARALLEL_PARTS, init.parts.length) },
        nextPart
      )
    );
    // Parts müssen sortiert sein für die S3-CompleteMultipartUpload
    etags.sort((a, b) => a.partNumber - b.partNumber);
    await api.completeUploadViaLink(token, init.fileId, etags, init.uploadId);
    onProgress(1);
  }
}

function putWithProgress(
  url: string,
  body: Blob,
  headers: Record<string, string>,
  onProgress: (p: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`PUT failed: ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(body);
  });
}

async function putBlob(url: string, blob: Blob): Promise<string> {
  const res = await fetch(url, { method: "PUT", body: blob });
  if (!res.ok) throw new Error(`PUT failed: ${res.status}`);
  const etag = res.headers.get("ETag") ?? res.headers.get("etag");
  if (!etag) throw new Error("missing ETag");
  return etag.replace(/"/g, "");
}
