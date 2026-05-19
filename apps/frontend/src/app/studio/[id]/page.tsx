"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { api, type GalleryDetail, type GalleryFile } from "@/lib/api";
import { uploadFiles, type UploadProgress } from "@/lib/upload";
import { SharePanel } from "@/components/studio/SharePanel";
import { PageHeader } from "@/components/studio/PageHeader";
import { Button } from "@/components/ui";
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

  // DnD-Sensoren (siehe Sprint 17)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
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
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

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
      if (event.status === "ready") void load();
    } else if (event.type === "file.deleted") {
      setGallery((g) =>
        g ? { ...g, files: g.files.filter((f) => f.id !== event.fileId) } : g
      );
    } else if (event.type === "file.added") {
      void load();
    }
  });

  // Fallback-Polling, falls die WS-Verbindung mal weg ist
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
      if (!confirm(msg)) return;
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
      <div className="flex items-center justify-center h-screen text-ui text-ink-tertiary">
        {t("common.loading")}
      </div>
    );
  }
  if (!gallery) {
    return (
      <div className="flex items-center justify-center h-screen text-ui text-ink-tertiary">
        {t("studio.notFound")}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "Studio", href: "/studio" },
          { label: gallery.title },
        ]}
        title={gallery.title}
        description={gallery.description || undefined}
        actions={
          <>
            <Link
              href={`/studio/${gallery.id}/proofing`}
              className="text-ui-sm text-ink-secondary hover:text-ink-primary transition-colors duration-motion"
            >
              {t("studio.proofingLink")}
            </Link>
            <Button
              variant={gallery.status === "live" ? "secondary" : "primary"}
              onClick={toggleLive}
              disabled={togglingStatus}
            >
              {togglingStatus
                ? "…"
                : gallery.status === "live"
                ? t("studio.setDraft")
                : t("studio.setLive")}
            </Button>
          </>
        }
      />

      {/* Meta-Strip unter dem Header */}
      <div className="px-6 sm:px-8 py-3 border-b border-line-subtle text-ui-xs text-ink-tertiary flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1.5">
          <Dot
            className={
              gallery.status === "live"
                ? "bg-semantic-success"
                : gallery.status === "draft"
                ? "bg-ink-tertiary"
                : "bg-semantic-warning"
            }
          />
          <span className="capitalize text-ink-secondary">
            {gallery.status}
          </span>
        </span>
        <span className="text-ink-tertiary/40">·</span>
        <span>
          Slug:{" "}
          <code className="font-mono bg-surface-sunken px-1 py-0.5 rounded-xs text-ink-secondary">
            {gallery.slug}
          </code>
        </span>
        <span className="text-ink-tertiary/40">·</span>
        <span className="capitalize text-ink-secondary">{gallery.mode}</span>
        <span className="text-ink-tertiary/40">·</span>
        <span>{gallery.files.length} Files</span>
      </div>

      <div className="px-6 sm:px-8 py-6 space-y-6 max-w-7xl">
        {/* Upload-Zone */}
        <section
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`rounded-md border border-dashed p-6 text-center cursor-pointer transition-colors duration-motion ease-out ${
            dragOver
              ? "border-accent bg-accent/8"
              : "border-line-subtle bg-surface-sunken hover:border-line-strong hover:bg-surface-raised"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <div className="text-ui text-ink-primary font-medium">
            Dateien hier ablegen oder klicken zum Auswählen
          </div>
          <div className="text-ui-xs text-ink-tertiary mt-1">
            JPEG, PNG, WebP, HEIC, RAW (CR2/NEF/ARW…), MP4, MOV — bis 2 GiB pro File
          </div>
        </section>

        {/* Aktive Uploads */}
        {Object.keys(uploads).length > 0 && (
          <section className="rounded-md border border-line-subtle bg-surface-raised">
            <div className="px-4 py-2 border-b border-line-subtle text-ui-sm font-medium text-ink-secondary">
              Aktive Uploads
            </div>
            <ul className="divide-y divide-line-subtle">
              {Object.values(uploads).map((u) => (
                <li key={u.fileId} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-ui text-ink-primary truncate">
                      {u.filename}
                    </div>
                    <div className="mt-1 h-1 bg-surface-sunken rounded-xs overflow-hidden">
                      <div
                        className={`h-full transition-all duration-motion ${
                          u.status === "failed"
                            ? "bg-semantic-danger"
                            : u.status === "ready"
                            ? "bg-semantic-success"
                            : "bg-accent"
                        }`}
                        style={{ width: `${Math.round(u.progress * 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-ui-xs w-20 text-right text-ink-tertiary">
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

        {/* Galerie-Settings */}
        <section className="rounded-md border border-line-subtle bg-surface-raised p-5 space-y-3">
          <h2 className="text-ui-md font-medium text-ink-primary">
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

        {/* Files-Toolbar */}
        {gallery.files.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
              <h2 className="text-ui-md font-medium text-ink-primary">
                {t("studio.files")}
                {selectionMode && selected.size > 0 && (
                  <span className="ml-2 text-ui-sm text-ink-tertiary font-normal">
                    · {selected.size} {t("studio.selectedSuffix")}
                  </span>
                )}
              </h2>
              <div className="flex items-center gap-1.5">
                {selectionMode ? (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setSelected(new Set(gallery.files.map((f) => f.id)))
                      }
                    >
                      {t("studio.selectAll")}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setSelected(new Set())}
                      disabled={selected.size === 0}
                    >
                      {t("studio.selectNone")}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => runBulk("hide")}
                      disabled={bulkPending || selected.size === 0}
                    >
                      {t("studio.hide")}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => runBulk("show")}
                      disabled={bulkPending || selected.size === 0}
                    >
                      {t("studio.show")}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => runBulk("delete")}
                      disabled={bulkPending || selected.size === 0}
                    >
                      {t("studio.deleteAction")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={exitSelectionMode}
                      aria-label="Auswahl-Modus beenden"
                    >
                      ✕
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setSelectionMode(true)}
                  >
                    {t("studio.selectFiles")}
                  </Button>
                )}
              </div>
            </div>

            <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
              <SortableContext
                items={gallery.files.map((f) => f.id)}
                strategy={rectSortingStrategy}
                disabled={selectionMode}
              >
                <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5">
                  {gallery.files.map((f, i) => (
                    <FileTile
                      key={f.id}
                      file={f}
                      index={i}
                      selectionMode={selectionMode}
                      selected={selected.has(f.id)}
                      onToggle={() => toggleSelected(f.id)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          </section>
        )}

        {gallery.files.length === 0 && (
          <div className="text-ui text-ink-tertiary">{t("studio.noFiles")}</div>
        )}
      </div>
    </>
  );
}

function Dot({ className }: { className?: string }) {
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${className ?? ""}`} />;
}

function BrandingPicker({
  currentBrandingId,
  onChange,
}: {
  currentBrandingId: string | null;
  onChange: (id: string | null) => void | Promise<void>;
}) {
  const t = useT();
  const [brandings, setBrandings] = useState<{ id: string; name: string }[]>([]);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.listBrandings();
        setBrandings(res.brandings.map((b) => ({ id: b.id, name: b.name })));
        setDefaultId(res.defaultBrandingId);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  if (!loaded) return null;
  if (brandings.length === 0) {
    return (
      <div className="text-ui-sm text-ink-tertiary py-1">
        {t("studio.brandingNoneYet")}{" "}
        <Link href="/studio/brandings" className="text-accent hover:text-accent-hover">
          {t("studio.brandingCreateNow")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 py-1">
      <label htmlFor="branding-pick" className="text-ui text-ink-secondary min-w-[80px]">
        {t("studio.branding")}
      </label>
      <select
        id="branding-pick"
        value={currentBrandingId ?? ""}
        onChange={(e) => void onChange(e.target.value || null)}
        className="text-ui rounded border border-line-subtle bg-surface-sunken text-ink-primary px-2 py-1 hover:border-line-strong focus:border-accent focus:outline-none transition-colors duration-motion"
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
        className="mt-1 accent-accent"
      />
      <div className="flex-1">
        <div className="text-ui text-ink-primary">{label}</div>
        {description && (
          <div className="text-ui-xs text-ink-tertiary mt-0.5">{description}</div>
        )}
      </div>
    </label>
  );
}

function FileTile({
  file,
  index,
  selectionMode,
  selected,
  onToggle,
}: {
  file: GalleryFile;
  index: number;
  selectionMode: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const isHidden = file.status === "hidden";

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: file.id, disabled: selectionMode });

  // Reveal-Animation nur für die ersten 24 Tiles staffeln. Bei großen
  // Galerien wäre der totale Delay sonst > 1s, was sich schleppend anfühlt.
  const animationDelay = `${Math.min(index, 24) * 30}ms`;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : "auto",
    animationDelay,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`group aspect-square rounded-sm overflow-hidden relative bg-surface-sunken border animate-reveal ${
        selected
          ? "border-accent ring-1 ring-accent"
          : "border-line-subtle hover:border-line-strong"
      } ${
        selectionMode
          ? "cursor-pointer"
          : "cursor-grab active:cursor-grabbing touch-none"
      } transition-colors duration-motion`}
      onClick={selectionMode ? onToggle : undefined}
      {...(selectionMode ? {} : attributes)}
      {...(selectionMode ? {} : listeners)}
    >
      {file.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={file.thumbUrl}
          alt={file.originalFilename}
          className={`w-full h-full object-cover ${isHidden ? "opacity-40" : ""}`}
          loading="lazy"
          draggable={false}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-ui-xs text-ink-tertiary text-center p-2">
          <div>
            <div className="font-mono uppercase text-ui-xs text-ink-tertiary/70">
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
          className={`absolute top-1.5 left-1.5 w-5 h-5 rounded-xs border flex items-center justify-center text-ui-xs font-bold transition-colors duration-motion ${
            selected
              ? "bg-accent border-accent text-accent-contrast"
              : "bg-surface-overlay/80 backdrop-blur-sm border-line-strong text-transparent"
          }`}
        >
          {selected ? "✓" : ""}
        </div>
      )}

      {/* Hidden-Badge */}
      {isHidden && (
        <div className="absolute top-1.5 right-1.5 text-ui-xs uppercase tracking-wider px-1.5 py-0.5 rounded-xs bg-semantic-warning/90 text-surface-canvas font-medium">
          versteckt
        </div>
      )}

      {/* Format-Badge für RAW + HEIC. Nicht für reguläres image/video — dort
          wäre das nur visueller Lärm. Sitzt unten-rechts, damit es sich nicht
          mit der Selection-Checkbox (oben-links) oder dem Hidden-Badge
          (oben-rechts) prügelt. */}
      {(file.kind === "raw" || file.kind === "heic") && (
        <div
          className="absolute bottom-1.5 right-1.5 text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-xs bg-black/60 backdrop-blur-sm text-white/85"
          title={
            file.kind === "raw"
              ? "Camera RAW"
              : "HEIC/HEIF (iPhone-Format)"
          }
        >
          {file.kind === "raw" ? "RAW" : "HEIC"}
        </div>
      )}

      {/* Filename-Overlay erscheint auf Hover */}
      <div className="absolute bottom-0 inset-x-0 p-1.5 bg-gradient-to-t from-black/80 via-black/40 to-transparent text-white text-ui-xs truncate opacity-0 group-hover:opacity-100 transition-opacity duration-motion">
        {file.originalFilename}
      </div>
    </li>
  );
}
