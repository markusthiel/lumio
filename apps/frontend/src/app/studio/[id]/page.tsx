"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { api, type GalleryDetail, type GalleryFile } from "@/lib/api";
import { uploadFiles, type UploadProgress } from "@/lib/upload";
import { SharePanel } from "@/components/studio/SharePanel";

export default function GalleryDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [gallery, setGallery] = useState<GalleryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploads, setUploads] = useState<Record<string, UploadProgress>>({});
  const [dragOver, setDragOver] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initialer Load + Polling während Files in "processing" sind
  const load = useCallback(async () => {
    try {
      const { gallery } = await api.getGallery(id);
      setGallery(gallery);
      return gallery;
    } catch (err) {
      if (err instanceof Error && err.message.includes("401")) {
        router.replace("/login");
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    void load();
  }, [load]);

  // Wenn Files in processing sind, alle 2s neu laden, bis alle ready/failed
  useEffect(() => {
    if (!gallery) return;
    const hasProcessing = gallery.files.some(
      (f) => f.status === "processing" || f.status === "uploading"
    );
    if (hasProcessing && !pollTimer.current) {
      pollTimer.current = setInterval(() => void load(), 2_000);
    } else if (!hasProcessing && pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    return () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [gallery, load]);

  // Upload-Handler
  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const arr = Array.from(files);
    try {
      await uploadFiles(id, arr, (p) =>
        setUploads((prev) => ({ ...prev, [p.fileId]: p }))
      );
    } catch (err) {
      console.error("upload failed", err);
    }
    void load();
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    void handleFiles(e.dataTransfer.files);
  }

  async function toggleLive() {
    if (!gallery) return;
    setTogglingStatus(true);
    try {
      const nextStatus = gallery.status === "live" ? "draft" : "live";
      await api.updateGallery(gallery.id, { status: nextStatus });
      await load();
    } finally {
      setTogglingStatus(false);
    }
  }

  async function toggleSetting(
    key: "downloadEnabled" | "watermarkEnabled" | "commentsEnabled",
    next: boolean
  ) {
    if (!gallery) return;
    await api.updateGallery(gallery.id, { [key]: next });
    await load();
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-slate-500">Lädt…</div>
      </main>
    );
  }
  if (!gallery) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-slate-500">Galerie nicht gefunden.</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="border-b border-slate-200 pb-4">
          <div className="text-xs">
            <Link
              href="/studio"
              className="text-slate-500 hover:text-slate-900"
            >
              ← Studio
            </Link>
          </div>
          <div className="flex items-end justify-between mt-2">
            <div>
              <h1 className="text-2xl font-semibold">{gallery.title}</h1>
              {gallery.description && (
                <p className="text-sm text-slate-500 mt-1">
                  {gallery.description}
                </p>
              )}
              <div className="text-xs text-slate-400 mt-2 flex gap-3">
                <span>
                  Slug:{" "}
                  <code className="bg-slate-100 px-1 rounded">
                    {gallery.slug}
                  </code>
                </span>
                <span>·</span>
                <span className="capitalize">{gallery.status}</span>
                <span>·</span>
                <span>{gallery.files.length} Files</span>
              </div>
            </div>
            <button
              onClick={toggleLive}
              disabled={togglingStatus}
              className={`text-sm px-3 py-1.5 rounded-md transition ${
                gallery.status === "live"
                  ? "border border-amber-300 text-amber-700 hover:bg-amber-50"
                  : "bg-green-600 text-white hover:bg-green-700"
              } disabled:opacity-50`}
            >
              {togglingStatus
                ? "…"
                : gallery.status === "live"
                ? "Auf Draft setzen"
                : "Live schalten"}
            </button>
          </div>
        </header>

        {/* Quick-Nav */}
        <nav className="flex gap-2 text-sm">
          <Link
            href={`/studio/${gallery.id}/proofing`}
            className="px-3 py-1.5 rounded border border-slate-200 hover:bg-slate-50"
          >
            Auswahl-Übersicht →
          </Link>
        </nav>

        {/* Upload-Zone */}
        <section
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition ${
            dragOver
              ? "border-brand-accent bg-amber-50"
              : "border-slate-200 hover:border-slate-400 hover:bg-slate-50"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <div className="text-sm font-medium">
            Dateien hier ablegen oder klicken zum Auswählen
          </div>
          <div className="text-xs text-slate-500 mt-1">
            JPEG, PNG, WebP, RAW (CR2/NEF/ARW…), MP4, MOV — bis 2 GiB pro File
          </div>
        </section>

        {/* Aktive Uploads */}
        {Object.keys(uploads).length > 0 && (
          <section className="rounded-lg border border-slate-200 bg-white">
            <div className="px-4 py-2 border-b border-slate-100 text-sm font-medium">
              Aktive Uploads
            </div>
            <ul className="divide-y divide-slate-100">
              {Object.values(uploads).map((u) => (
                <li
                  key={u.fileId}
                  className="px-4 py-3 flex items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{u.filename}</div>
                    <div className="mt-1 h-1.5 bg-slate-100 rounded overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          u.status === "failed"
                            ? "bg-red-500"
                            : u.status === "ready"
                            ? "bg-green-500"
                            : "bg-brand-accent"
                        }`}
                        style={{
                          width: `${Math.round(u.progress * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div className="text-xs w-20 text-right text-slate-500">
                    {u.status === "uploading"
                      ? `${Math.round(u.progress * 100)} %`
                      : u.status}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Share-Panel */}
        <SharePanel galleryId={gallery.id} gallerySlug={gallery.slug} />

        {/* Settings */}
        <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-2">
          <h2 className="text-sm font-medium mb-1">Einstellungen</h2>
          <SettingToggle
            label="Download für Kunden erlauben"
            value={gallery.downloadEnabled}
            onChange={(v) => toggleSetting("downloadEnabled", v)}
          />
          <SettingToggle
            label="Wasserzeichen auf Vorschaubildern"
            description="Wird automatisch generiert. Studio-Watermark-Text in den Tenant-Settings festlegen."
            value={gallery.watermarkEnabled}
            onChange={(v) => toggleSetting("watermarkEnabled", v)}
          />
          <SettingToggle
            label="Kommentare aktivieren"
            value={gallery.commentsEnabled}
            onChange={(v) => toggleSetting("commentsEnabled", v)}
          />
        </section>

        {/* File-Grid */}
        {gallery.files.length > 0 ? (
          <section>
            <h2 className="text-sm font-medium mb-2">Dateien</h2>
            <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {gallery.files.map((f) => (
                <FileTile key={f.id} file={f} />
              ))}
            </ul>
          </section>
        ) : (
          <div className="text-sm text-slate-500">
            Noch keine Dateien hochgeladen.
          </div>
        )}
      </div>
    </main>
  );
}

function SettingToggle({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer py-1">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 rounded border-slate-300"
      />
      <div className="flex-1">
        <div className="text-sm">{label}</div>
        {description && (
          <div className="text-xs text-slate-500 mt-0.5">{description}</div>
        )}
      </div>
    </label>
  );
}

function FileTile({ file }: { file: GalleryFile }) {
  return (
    <li className="aspect-square rounded-md border border-slate-200 bg-slate-50 overflow-hidden relative">
      {file.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={file.thumbUrl}
          alt={file.originalFilename}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-xs text-slate-400 text-center p-2">
          <div>
            <div className="font-mono uppercase text-[10px] text-slate-500">
              {file.kind}
            </div>
            <div className="mt-1">
              {file.status === "processing"
                ? "Wird verarbeitet…"
                : file.status === "uploading"
                ? "Wird hochgeladen…"
                : file.status === "failed"
                ? "Fehler"
                : file.originalFilename}
            </div>
          </div>
        </div>
      )}
      <div className="absolute bottom-0 inset-x-0 p-1.5 bg-gradient-to-t from-black/60 to-transparent text-white text-[10px] truncate">
        {file.originalFilename}
      </div>
    </li>
  );
}
