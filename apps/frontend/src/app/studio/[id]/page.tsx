"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { api, type GalleryDetail, type GalleryFile } from "@/lib/api";
import { uploadFiles, type UploadProgress } from "@/lib/upload";
import { SharePanel } from "@/components/studio/SharePanel";
import { useT } from "@/lib/i18n";
import { useGalleryEvents } from "@/lib/useGalleryEvents";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  sortableKeyboardCoordinates,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export default function GalleryDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const t = useT();
  const [gallery, setGallery] = useState<GalleryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploads, setUploads] = useState<Record<string, UploadProgress>>({});
  const [dragOver, setDragOver] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);

  // Bulk-Selection
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);

  // Drag-and-Drop-Sortierung läuft via @dnd-kit. Drei Sensoren:
  //   - PointerSensor: Mouse + Stylus (desktop default)
  //   - TouchSensor: Finger. Activation-Constraint 250ms long-press, damit
  //     normales Scrollen auf dem Phone nicht jedes Tile triggert.
  //   - KeyboardSensor: Pfeiltasten + Space für Accessibility.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const toggleSelected = useCallback((fileId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelected(new Set());
  }, []);

  // dnd-kit feuert handleDragEnd mit { active, over }; over kann null
  // sein, wenn der User außerhalb aller Sortable-Items losgelassen hat.
  // Wir bauen aus arrayMove die neue Reihenfolge, persistieren, und
  // revertieren bei API-Fehler.
  const handleDragEnd = useCallback(
    async (e: DragEndEvent) => {
      if (!gallery || !e.over || e.active.id === e.over.id) return;
      const files = gallery.files;
      const fromIdx = files.findIndex((f) => f.id === e.active.id);
      const toIdx = files.findIndex((f) => f.id === e.over!.id);
      if (fromIdx < 0 || toIdx < 0) return;

      const next = arrayMove(files, fromIdx, toIdx);
      const previous = files;
      setGallery({ ...gallery, files: next });

      try {
        await api.reorderFiles({
          galleryId: gallery.id,
          order: next.map((f, i) => ({ id: f.id, sortIndex: i })),
        });
      } catch (err) {
        console.error("reorder failed:", err);
        setGallery({ ...gallery, files: previous });
      }
    },
    [gallery]
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Polling-Timer als Fallback — wenn der WebSocket weg ist (z.B. Proxy
  // wirft uns raus und Reconnect klappt nicht), wollen wir nicht ewig auf
  // einen festsitzenden processing-Status starren. Polling läuft DESHALB
  // immer noch, aber mit größerem Intervall (10s) und nur, solange
  // Files in nicht-finalem Status sind. Bei normalem Betrieb sieht der
  // User die Updates über den WebSocket schon vorher, das Polling
  // korrigiert nur den seltenen Edge-Case.
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initialer Load
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

  // WebSocket-Subscription für Live-Updates
  useGalleryEvents(gallery?.id, (event) => {
    if (event.type === "file.status") {
      setGallery((g) => {
        if (!g) return g;
        const idx = g.files.findIndex((f) => f.id === event.fileId);
        if (idx < 0) {
          // Unbekanntes File — lieber neu laden als raten
          void load();
          return g;
        }
        const next = [...g.files];
        next[idx] = {
          ...next[idx],
          status: event.status,
          width: event.width ?? next[idx].width,
          height: event.height ?? next[idx].height,
        };
        return { ...g, files: next };
      });
      // Bei status=ready haben wir noch keine thumbUrl in der Payload —
      // einmal neu fetchen, damit der Browser die signierte URL bekommt
      if (event.status === "ready") void load();
    } else if (event.type === "file.deleted") {
      setGallery((g) =>
        g ? { ...g, files: g.files.filter((f) => f.id !== event.fileId) } : g
      );
    } else if (event.type === "file.added") {
      // Vollständiger Reload — wir brauchen die signierte thumbUrl
      void load();
    }
  });

  // Fallback-Polling: nur solange noch Files in transienten Stati hängen,
  // und nur alle 10 Sekunden (WebSocket liefert die Updates eigentlich).
  useEffect(() => {
    if (!gallery) return;
    const hasTransient = gallery.files.some(
      (f) => f.status === "processing" || f.status === "uploading"
    );
    if (hasTransient && !pollTimer.current) {
      pollTimer.current = setInterval(() => void load(), 10_000);
    } else if (!hasTransient && pollTimer.current) {
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

  async function runBulk(action: "delete" | "hide" | "show") {
    if (!gallery || selected.size === 0) return;
    const count = selected.size;
    if (action === "delete") {
      const msg =
        count === 1
          ? t("studio.confirmDeleteOne")
          : t("studio.confirmDeleteMany", { count });
      if (!confirm(msg)) {
        return;
      }
    }
    setBulkPending(true);
    try {
      await api.bulkFileAction({
        galleryId: gallery.id,
        fileIds: Array.from(selected),
        action,
      });
      exitSelectionMode();
      await load();
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Fehler");
    } finally {
      setBulkPending(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-slate-500">{t("common.loading")}</div>
      </main>
    );
  }
  if (!gallery) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-slate-500">{t("studio.notFound")}</div>
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
                ? t("studio.setDraft")
                : t("studio.setLive")}
            </button>
          </div>
        </header>

        {/* Quick-Nav */}
        <nav className="flex gap-2 text-sm">
          <Link
            href={`/studio/${gallery.id}/proofing`}
            className="px-3 py-1.5 rounded border border-slate-200 hover:bg-slate-50"
          >
            {t("studio.proofingLink")}
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
          <h2 className="text-sm font-medium mb-1">
            {t("studio.settingsHeading")}
          </h2>
          <BrandingPicker
            currentBrandingId={gallery.brandingId ?? null}
            onChange={async (v) => {
              await api.updateGallery(gallery.id, { brandingId: v });
              await load();
            }}
          />
          <SettingToggle
            label={t("studio.settingDownload")}
            value={gallery.downloadEnabled}
            onChange={(v) => toggleSetting("downloadEnabled", v)}
          />
          <SettingToggle
            label={t("studio.settingWatermark")}
            description={t("studio.settingWatermarkDesc")}
            value={gallery.watermarkEnabled}
            onChange={(v) => toggleSetting("watermarkEnabled", v)}
          />
          <SettingToggle
            label={t("studio.settingComments")}
            value={gallery.commentsEnabled}
            onChange={(v) => toggleSetting("commentsEnabled", v)}
          />
        </section>

        {/* File-Grid */}
        {gallery.files.length > 0 ? (
          <section>
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <h2 className="text-sm font-medium">
                {t("studio.files")}
                {selectionMode && selected.size > 0 && (
                  <span className="ml-2 text-xs text-slate-500 font-normal">
                    · {selected.size} {t("studio.selectedSuffix")}
                  </span>
                )}
              </h2>
              <div className="flex items-center gap-2">
                {selectionMode ? (
                  <>
                    <button
                      onClick={() =>
                        setSelected(new Set(gallery.files.map((f) => f.id)))
                      }
                      className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50"
                    >
                      {t("studio.selectAll")}
                    </button>
                    <button
                      onClick={() => setSelected(new Set())}
                      className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50"
                      disabled={selected.size === 0}
                    >
                      {t("studio.selectNone")}
                    </button>
                    <button
                      onClick={() => runBulk("hide")}
                      disabled={bulkPending || selected.size === 0}
                      className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {t("studio.hide")}
                    </button>
                    <button
                      onClick={() => runBulk("show")}
                      disabled={bulkPending || selected.size === 0}
                      className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {t("studio.show")}
                    </button>
                    <button
                      onClick={() => runBulk("delete")}
                      disabled={bulkPending || selected.size === 0}
                      className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {t("studio.deleteAction")}
                    </button>
                    <button
                      onClick={exitSelectionMode}
                      className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50"
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setSelectionMode(true)}
                    className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50"
                  >
                    {t("studio.selectFiles")}
                  </button>
                )}
              </div>
            </div>
            <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
              <SortableContext
                items={gallery.files.map((f) => f.id)}
                strategy={rectSortingStrategy}
                disabled={selectionMode}
              >
                <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {gallery.files.map((f) => (
                    <FileTile
                      key={f.id}
                      file={f}
                      selectionMode={selectionMode}
                      selected={selected.has(f.id)}
                      onToggle={() => toggleSelected(f.id)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          </section>
        ) : (
          <div className="text-sm text-slate-500">
            {t("studio.noFiles")}
          </div>
        )}
      </div>
    </main>
  );
}

function BrandingPicker({
  currentBrandingId,
  onChange,
}: {
  currentBrandingId: string | null;
  onChange: (id: string | null) => void | Promise<void>;
}) {
  const t = useT();
  const [brandings, setBrandings] = useState<
    { id: string; name: string }[]
  >([]);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.listBrandings();
        setBrandings(
          res.brandings.map((b) => ({ id: b.id, name: b.name }))
        );
        setDefaultId(res.defaultBrandingId);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  if (!loaded) return null;
  if (brandings.length === 0) {
    return (
      <div className="text-xs text-slate-500 py-1">
        {t("studio.brandingNoneYet")}{" "}
        <Link
          href="/studio/brandings"
          className="text-brand-accent hover:underline"
        >
          {t("studio.brandingCreateNow")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 py-1">
      <label htmlFor="branding-pick" className="text-sm">
        {t("studio.branding")}
      </label>
      <select
        id="branding-pick"
        value={currentBrandingId ?? ""}
        onChange={(e) => void onChange(e.target.value || null)}
        className="text-sm rounded-md border border-slate-300 px-2 py-1 bg-white"
      >
        <option value="">
          {t("studio.brandingTenantDefault")}
          {defaultId
            ? ` (${brandings.find((b) => b.id === defaultId)?.name ?? "?"})`
            : ""}
        </option>
        {brandings.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </div>
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

function FileTile({
  file,
  selectionMode,
  selected,
  onToggle,
}: {
  file: GalleryFile;
  selectionMode: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const isHidden = file.status === "hidden";

  // useSortable verkabelt das Tile mit dem äußeren SortableContext.
  // Die transform/transition-Werte produzieren das CSS für das
  // smoothe Verschieben während des Drags. listeners enthält die
  // pointer/touch/keyboard-Event-Handler, die den Drag starten.
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: file.id, disabled: selectionMode });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Während des Drags transparent machen — das DragOverlay-Pattern
    // würde mehr Code kosten, und transparent reicht visuell.
    opacity: isDragging ? 0.4 : 1,
    // Während des Drags darüber liegen, damit es nicht hinter anderen
    // Tiles verschwindet
    zIndex: isDragging ? 10 : "auto",
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`aspect-square rounded-md border bg-slate-50 overflow-hidden relative ${
        selected
          ? "border-brand-accent ring-2 ring-brand-accent"
          : "border-slate-200"
      } ${
        selectionMode
          ? "cursor-pointer"
          : "cursor-grab active:cursor-grabbing touch-none"
      }`}
      onClick={selectionMode ? onToggle : undefined}
      {...(selectionMode ? {} : attributes)}
      {...(selectionMode ? {} : listeners)}
    >
      {file.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={file.thumbUrl}
          alt={file.originalFilename}
          className={`w-full h-full object-cover ${
            isHidden ? "opacity-40" : ""
          }`}
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
                : file.status === "hidden"
                ? "Versteckt"
                : file.originalFilename}
            </div>
          </div>
        </div>
      )}

      {/* Selection-Checkbox */}
      {selectionMode && (
        <div
          className={`absolute top-1.5 left-1.5 w-5 h-5 rounded border-2 flex items-center justify-center text-[10px] font-bold ${
            selected
              ? "bg-brand-accent border-brand-accent text-neutral-950"
              : "bg-white/80 border-white shadow"
          }`}
        >
          {selected ? "✓" : ""}
        </div>
      )}

      {/* Hidden-Badge */}
      {isHidden && (
        <div className="absolute top-1.5 right-1.5 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500 text-white font-medium">
          versteckt
        </div>
      )}

      <div className="absolute bottom-0 inset-x-0 p-1.5 bg-gradient-to-t from-black/60 to-transparent text-white text-[10px] truncate">
        {file.originalFilename}
      </div>
    </li>
  );
}
