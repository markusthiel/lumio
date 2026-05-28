"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { api, ApiError, type GalleryDetail, type GalleryFile } from "@/lib/api";
import { uploadFiles, type UploadProgress } from "@/lib/upload";
import { SharePanel } from "@/components/studio/SharePanel";
import { GalleryHeaderEditor } from "@/components/studio/GalleryHeaderEditor";
import { SectionsEditor } from "@/components/studio/SectionsEditor";
import { UploadLinksSection } from "@/components/studio/UploadLinksSection";
import { RejectDialog } from "@/components/studio/RejectDialog";
import { DuplicatesDialog } from "@/components/studio/DuplicatesDialog";
import { SlowConnectionToggle } from "@/components/upload/SlowConnectionToggle";
import { useSlowConnection } from "@/lib/useSlowConnection";
import { PageHeader } from "@/components/studio/PageHeader";
import { AutoTagsToolbar } from "@/components/studio/AutoTagsToolbar";
import { TagPicker } from "@/components/studio/TagPicker";
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
  // Counter für Files, die der User gerade rein gezogen hat, aber für die
  // der Init-Call ans Backend noch läuft. Bei vielen Files (z.B. 1000)
  // dauert das mehrere Sekunden — ohne diesen Counter würde der User
  // sehen "Nichts passiert" obwohl der Browser fleißig Init-Chunks
  // hochpumpt. Wird beim Init-Response pro File dekrementiert (im
  // onProgress wenn status erstmalig 'queued' wird).
  const [pendingInitCount, setPendingInitCount] = useState(0);
  // Dup-Dialog: gezeigt wenn der User Files gedropped hat, deren
  // Dateinamen schon in der Galerie existieren. User entscheidet
  // ob nur neue, alle (auch Duplikate), oder gar nicht hochgeladen
  // werden soll.
  const [dupDialog, setDupDialog] = useState<{
    duplicates: File[];
    newFiles: File[];
  } | null>(null);
  // Duplikate-finden-Modal: SHA-256-basierter Scan der Galerie nach
  // bit-genau identischen Files. Eigenes State weil unabhaengig vom
  // dupDialog (das ist Filename-Konflikt beim Drop, dieser hier ist
  // Inhalt-Vergleich im Bestand).
  const [showDuplicatesDialog, setShowDuplicatesDialog] = useState(false);
  // Slow-Connection-Modus fuer Uploads. Beeinflusst die Anzahl
  // paralleler Streams (1 statt 4 / 1 statt 4). Auto-Detect via
  // navigator.connection oder manuell via Toggle. Wird beim
  // uploadFiles-Aufruf in den options.slowConnection durchgereicht.
  const { slow: slowConnection } = useSlowConnection();
  const [dragOver, setDragOver] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  // Feature-Flags des Tenants — beim Mount via me() geladen. Bestimmt
  // ob optionale UI-Bereiche (z.B. Print-Shop-Override-Toggle) gerendert
  // werden. Wenn null: noch nicht geladen, Toggle erstmal versteckt.
  const [tenantFeatures, setTenantFeatures] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.me();
        if (!cancelled) setTenantFeatures(r.features ?? []);
      } catch {
        if (!cancelled) setTenantFeatures([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Effektives Pro-File-Upload-Limit für die Drop-Zone-Anzeige.
  // Wird aus den Tenant-Settings beim Page-Load geholt; bis das da
  // ist null → Anzeige fällt auf den Hinweis ohne Größenangabe zurück.
  const [maxUploadMib, setMaxUploadMib] = useState<number | null>(null);

  // Live-Activity-Toasts: Aktionen des Kunden zeigen wir kurz oben an.
  // Wir halten max 4 gleichzeitig im State, sonst staucht sich das bei
  // schneller Aktivität (Kunde klickt sich durch 30 Bilder durch).
  // Jeder Toast hat eine eindeutige id für die React-Key-Stabilität.
  const [activity, setActivity] = useState<
    Array<{ id: string; text: string }>
  >([]);
  const activityCounter = useRef(0);
  const pushActivity = useCallback((text: string) => {
    activityCounter.current += 1;
    const id = `a${activityCounter.current}`;
    setActivity((prev) => [...prev.slice(-3), { id, text }]);
    // Nach 4s ausblenden — räumt sich selbst, kein Memory-Leak
    setTimeout(() => {
      setActivity((prev) => prev.filter((a) => a.id !== id));
    }, 4000);
  }, []);

  // Bulk-Selection
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);
  // Eigener Confirm-Dialog statt window.confirm. iPhone Safari kann
  // window.confirm verschlucken nach langem Render (z.B. nach Select-
  // All von 1000+ Files). Eigener Dialog ist robuster und sieht
  // konsistent zur uebrigen UI aus.
  //
  // Generalisiert ueber action-Type: Bulk-Aktionen aus dem Auswahl-
  // Modus ('delete' selected files), Cleanup-Aktionen aus den
  // Bannern (stuck/failed). Der onConfirm-Callback macht den
  // eigentlichen Backend-Call.
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    /** Button-Label fuer die Bestaetigung (z.B. 'Löschen'). */
    confirmLabel: string;
    /** Button-Variant — danger für irreversibles, sonst primary. */
    confirmVariant: "danger" | "primary";
    /** Hint waehrend pending=true (z.B. 'Lösche 1300 Dateien…'). */
    pendingLabel?: string;
    onConfirm: () => Promise<void>;
  } | null>(null);
  // Inline-Fehlermeldung statt alert() — alert() wird auf iOS Safari
  // ebenfalls manchmal verschluckt nach laengeren async-Operationen.
  const [bulkError, setBulkError] = useState<string | null>(null);

  // File-Filter: 'all' (default) oder 'pending' (nur wartende
  // Upload-Link-Files). Wird auch via Header-Counter gesteuert,
  // der direkt darauf umschaltet.
  const [fileFilter, setFileFilter] = useState<"all" | "pending">("all");

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

      // Uploads-State mit der frischen Galerie abgleichen. Wenn ein
      // Eintrag in `uploads` (oben in der UI als "wird verarbeitet"
      // dargestellt) inzwischen in der DB den Status `ready` hat,
      // räumen wir den Eintrag nach kurzem Delay raus. Das deckt
      // zwei Wege ab:
      //   1. Polling-Fallback hat geladen und der WS-Event ist nie
      //      gekommen (Connection-Drop)
      //   2. Page wurde gerade frisch betreten und der Upload-Tracker
      //      war noch alt
      const readyIds = new Set(
        gallery.files
          .filter((f) => f.status === "ready" || f.status === "failed")
          .map((f) => f.id)
      );
      setUploads((prev) => {
        let changed = false;
        const next: typeof prev = { ...prev };
        for (const [fileId, upload] of Object.entries(prev)) {
          if (
            readyIds.has(fileId) &&
            upload.status !== "ready" &&
            upload.status !== "failed"
          ) {
            next[fileId] = { ...upload, status: "ready", progress: 1 };
            changed = true;
            // Verzögert raus
            setTimeout(() => {
              setUploads((cur) => {
                if (!cur[fileId]) return cur;
                const updated = { ...cur };
                delete updated[fileId];
                return updated;
              });
            }, 2000);
          }
        }
        return changed ? next : prev;
      });

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

  // Bulk-Approve: alle ausgewählten pending-Files in einem Call
  // freigeben. Backend filtert no-ops raus (Files die schon visible
  // sind), wir kriegen die Anzahl tatsächlich freigegebener zurück.
  const approveSelected = useCallback(async () => {
    if (!gallery) return;
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkPending(true);
    try {
      const res = await api.approveUploadedFilesBulk(gallery.id, ids);
      pushActivity(
        t("studio.uploadLinks.bulkApproved", { count: res.approved.length })
      );
      setSelected(new Set());
      // file.visibility-Events vom WS aktualisieren den File-State,
      // aber wir laden defensiv noch mal — schneller UI-Feedback.
      await load();
    } finally {
      setBulkPending(false);
    }
  }, [gallery, selected, pushActivity, t, load]);

  // Quickaction für die ganze Galerie — alle wartenden Files in
  // einem Call freigeben. Ohne Selection-Mode erreichbar.
  const approveAllPending = useCallback(async () => {
    if (!gallery) return;
    const pendingIds = gallery.files
      .filter(
        (f) =>
          f.uploadedVia === "upload_link" && f.publicVisibility === "hidden"
      )
      .map((f) => f.id);
    if (pendingIds.length === 0) return;
    if (
      !confirm(
        t("studio.uploadLinks.confirmApproveAll", { count: pendingIds.length })
      )
    ) {
      return;
    }
    setBulkPending(true);
    try {
      const res = await api.approveUploadedFilesBulk(gallery.id, pendingIds);
      pushActivity(
        t("studio.uploadLinks.bulkApproved", { count: res.approved.length })
      );
      await load();
    } finally {
      setBulkPending(false);
    }
  }, [gallery, pushActivity, t, load]);

  // Reject-Dialog State. dialogTarget kann sein:
  //   { type: 'single', fileId }   → ein File ablehnen
  //   { type: 'bulk', fileIds: [] } → mehrere mit gemeinsamem Grund
  //   null                          → kein Dialog offen
  const [rejectDialog, setRejectDialog] = useState<
    | { type: "single"; fileId: string }
    | { type: "bulk"; fileIds: string[] }
    | null
  >(null);

  const performReject = useCallback(
    async (reason: string | null) => {
      if (!gallery || !rejectDialog) return;
      setBulkPending(true);
      try {
        if (rejectDialog.type === "single") {
          await api.rejectUploadedFile(
            gallery.id,
            rejectDialog.fileId,
            reason
          );
          pushActivity(t("studio.uploadLinks.rejectedToast", { count: 1 }));
        } else {
          const res = await api.rejectUploadedFilesBulk(
            gallery.id,
            rejectDialog.fileIds,
            reason
          );
          pushActivity(
            t("studio.uploadLinks.rejectedToast", {
              count: res.rejected.length,
            })
          );
          setSelected(new Set());
        }
        setRejectDialog(null);
        await load();
      } finally {
        setBulkPending(false);
      }
    },
    [gallery, rejectDialog, pushActivity, t, load]
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Tenant-Settings einmalig laden für die Upload-Limit-Anzeige.
  // Separat vom load() weil das pro Tenant gilt, nicht pro Gallery —
  // ändert sich also nicht mit der Page-Navigation. Wenn der User
  // das Limit in den Settings ändert während er auf der Galerie-
  // Page ist, sieht er den neuen Wert erst beim nächsten Page-Load
  // (kein WS für Settings-Updates).
  useEffect(() => {
    void api
      .getTenantSettings()
      .then((res) => {
        setMaxUploadMib(
          res.tenant.maxUploadMib ?? res.uploadLimits.defaultMib
        );
      })
      .catch(() => {
        // Wenn der Fetch scheitert: Anzeige bleibt ohne Größenangabe.
        // Validierung passiert eh server-seitig, Anzeige ist nur Hinweis.
      });
  }, []);

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

      // Uploads-Liste oben in der UI ebenfalls aktualisieren — sonst
      // bleibt der Eintrag ewig auf "processing 100 %" hängen, selbst
      // wenn das File längst fertig verarbeitet ist (der Upload-Code
      // sendet kein "ready"-Update, weil S3-Upload + Worker-Encoding
      // zwei getrennte Stufen sind und nur die erste durch upload.ts
      // observed wird).
      //
      // Strategie:
      //   - status=ready  → nach 2 s aus der Liste entfernen (kurzer
      //                     Bestätigungs-Flash für den User, dann weg)
      //   - status=failed → Eintrag bleibt mit Fehler-Status, damit
      //                     der User die Datei nicht übersieht
      //   - status=processing/uploading → State spiegeln (passiert i.d.R.
      //                     nicht über WS, weil der Upload-Code das schon
      //                     macht; defensiv für später)
      setUploads((prev) => {
        const existing = prev[event.fileId];
        if (!existing) return prev;
        if (event.status === "ready") {
          // Eintrag noch kurz auf "ready" setzen, dann timer entfernt ihn
          return {
            ...prev,
            [event.fileId]: { ...existing, status: "ready", progress: 1 },
          };
        }
        return {
          ...prev,
          [event.fileId]: {
            ...existing,
            status: event.status as typeof existing.status,
          },
        };
      });
      if (event.status === "ready") {
        // Nach 2 s aus der Upload-Liste rauswerfen — File ist jetzt
        // im normalen Galerie-Grid drunter sichtbar, kein doppeltes
        // UI-Element mehr nötig.
        setTimeout(() => {
          setUploads((prev) => {
            if (!prev[event.fileId]) return prev;
            const next = { ...prev };
            delete next[event.fileId];
            return next;
          });
        }, 2000);
        void load();
      }
    } else if (event.type === "file.deleted") {
      setGallery((g) =>
        g ? { ...g, files: g.files.filter((f) => f.id !== event.fileId) } : g
      );
    } else if (event.type === "file.added") {
      void load();
    } else if (event.type === "file.visibility") {
      // Approve/hide vom Studio oder anderem Tab — File-Liste neu laden,
      // damit Tile-Badges + publicVisibility-Feld konsistent sind.
      setGallery((g) => {
        if (!g) return g;
        const idx = g.files.findIndex((f) => f.id === event.fileId);
        if (idx < 0) return g;
        const next = [...g.files];
        next[idx] = { ...next[idx], publicVisibility: event.publicVisibility };
        return { ...g, files: next };
      });
    } else if (event.type === "upload_link.received") {
      // Externer Uploader hat ein File hochgeladen via Upload-Link.
      // Activity-Toast + Galerie reloaden, damit das neue File mit
      // pending-Badge auftaucht.
      pushActivity(
        `${t("studio.uploadLinks.pendingHint")}: ${event.filename}`
      );
      void load();
    } else if (event.type === "selection.changed") {
      // Wir laden hier NICHT die ganze Galerie neu — das ist teuer und der
      // Counter im Customer-View ist hier sowieso nicht sichtbar. Stattdessen
      // ein dezenter Toast, plus ein vollständiger Reload erst wenn der
      // Studio-Nutzer die Auswahl-Übersicht (`/proofing`) öffnet.
      //
      // Was hier sinnvoll wäre, wenn das Studio später einen Live-Marker
      // auf den Tiles haben soll: pro File ein {liked: boolean, color}-
      // Mapping pflegen. Heute ist das Studio-Tile-UI nicht auf Selection-
      // Display ausgelegt, das ist alles im Proofing-Tab. Wir bleiben
      // pragmatisch.
      const filename = gallery?.files.find((f) => f.id === event.fileId)
        ?.originalFilename ?? "(unbekannt)";
      const who = event.accessLabel ?? t("studio.liveCustomerGeneric");
      let action = "";
      if (event.liked) action = t("studio.liveActionLiked");
      else if (event.color)
        action = t("studio.liveActionColored", { color: event.color });
      else if (event.rating !== null)
        action = t("studio.liveActionRated", { rating: event.rating });
      else action = t("studio.liveActionCleared");
      pushActivity(`${who}: ${action} — ${filename}`);
    } else if (event.type === "comment.posted") {
      const filename = gallery?.files.find((f) => f.id === event.fileId)
        ?.originalFilename ?? "(unbekannt)";
      pushActivity(
        `${event.authorLabel}: ${t("studio.liveActionCommented")} — ${filename}`
      );
    } else if (event.type === "selection.finalized") {
      const who = event.accessLabel ?? t("studio.liveCustomerGeneric");
      pushActivity(
        `${who}: ${t("studio.liveActionFinalized", { count: event.count })}`
      );
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

  // Wenn ein Upload wegen Plan-Limit fehlschlägt (402 vom API), zeigen
  // wir einen Dialog statt einer stillen Konsolen-Meldung. Andere Fehler
  // landen normal im Catch und werden später als Toast angezeigt.
  const [limitDialog, setLimitDialog] = useState<{
    title: string;
    message: string;
  } | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const arr = Array.from(files);

    // Dup-Erkennung: Filenames vergleichen mit denen die schon in der
    // Galerie existieren ODER aktuell in der Upload-Pipeline sind
    // (noch nicht in gallery.files weil load() erst nach Init kommt).
    // status-unabhängig — auch ein File das gerade erst hochgeladen
    // wird (status=uploading/processing) wollen wir als Duplikat
    // zählen, sonst lädt der User parallel zweimal das gleiche.
    // 'rejected'-Files würden wir theoretisch wieder zulassen, aber
    // pragmatisch: User soll erst die Reject-Files explizit löschen
    // statt automatisch zu re-uploaden — sonst überschreibt er
    // versehentlich den Reject-Status und die Datei kommt wieder.
    const existingNames = new Set<string>([
      ...(gallery?.files.map((f) => f.originalFilename) ?? []),
      // uploads-State enthält Files, die gerade aktiv hochgeladen
      // oder schon initialisiert wurden — gallery.files holt sie
      // erst nach dem nächsten load(), also vor dem Sync hier
      // abdecken um Race-Condition zu vermeiden.
      ...Object.values(uploads)
        .filter((u) => u.status !== "failed")
        .map((u) => u.filename),
    ]);
    const duplicates = arr.filter((f) => existingNames.has(f.name));
    const newFiles = arr.filter((f) => !existingNames.has(f.name));

    if (duplicates.length > 0) {
      setDupDialog({ duplicates, newFiles });
      return;
    }

    await startUpload(arr);
  }

  // Eigentlicher Upload-Code, ausgelagert damit der Dup-Dialog ihn
  // mit unterschiedlichen File-Listen aufrufen kann (nur neue, oder
  // alle inkl. Duplikate).
  async function startUpload(arr: File[]) {
    if (arr.length === 0) return;
    // Sofort den Counter erhöhen — das zeigt "X Dateien werden
    // vorbereitet…" SOFORT nach dem Drop, bevor der erste Init-Chunk
    // zurück ist. Bei 1000 Files wäre sonst ~30 s lang gar nichts zu
    // sehen.
    setPendingInitCount((n) => n + arr.length);
    // Set von fileIds, die wir schon "verbucht" haben — der erste
    // 'queued'-Event pro fileId dekrementiert den Counter. Spätere
    // Events derselben fileId (uploading/processing/...) zählen nicht
    // doppelt.
    const seen = new Set<string>();
    try {
      await uploadFiles(
        id,
        arr,
        (p) => {
          setUploads((prev) => ({ ...prev, [p.fileId]: p }));
          if (!seen.has(p.fileId)) {
            seen.add(p.fileId);
            setPendingInitCount((n) => Math.max(0, n - 1));
          }
        },
        { slowConnection }
      );
    } catch (err) {
      // 402 Payment Required: Plan-Limit erreicht. Wir zeigen einen
      // Dialog mit der Nachricht aus der API + Link zur Plan-Seite.
      if (err instanceof ApiError && err.status === 402) {
        setLimitDialog({
          title: "Speicher-Limit erreicht",
          message:
            err.message ||
            "Dein Plan erlaubt keinen weiteren Upload. Upgrade auf einen größeren Plan oder kaufe ein Storage-Pack.",
        });
      } else {
        console.error("upload failed", err);
      }
    } finally {
      // Defensiv: falls Init-Chunks teilweise gefailed sind und uns
      // weniger 'queued'-Events erreicht haben als arr.length —
      // Counter auf 0 zwingen, damit der "wird vorbereitet"-Hint
      // nicht hängen bleibt.
      setPendingInitCount((n) => Math.max(0, n - (arr.length - seen.size)));
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
    key:
      | "downloadEnabled"
      | "downloadOriginalsEnabled"
      | "watermarkEnabled"
      | "commentsEnabled",
    next: boolean
  ) {
    if (!gallery) return;
    await api.updateGallery(gallery.id, { [key]: next });
    await load();
  }

  /** Print-Shop-Override-Toggle. Tri-State unter der Haube:
   *    null  = uebernimmt Tenant-Default (DB-Default)
   *    true  = explizit fuer diese Galerie aktiv (override Tenant=off → on)
   *    false = explizit ausgeblendet (override Tenant=on → off)
   *  UI-Mapping: Toggle ist 'ON' wenn !== false (also null oder true).
   *  Off-Klick: false. On-Klick: null (zurueck auf Tenant-Default —
   *  nicht true, sonst koennten wir auf Tenant-off niemals wieder zurueck). */
  async function togglePrintShop(showAsOn: boolean) {
    if (!gallery) return;
    await api.updateGallery(gallery.id, {
      printShopEnabled: showAsOn ? null : false,
    });
    await load();
  }

  /** Helper: bulk-Delete mit Chunking. Wird von runBulk und den
   *  Cleanup-Funktionen (stuck/failed) verwendet. */
  async function bulkDeleteIds(ids: string[]) {
    if (!gallery || ids.length === 0) return;
    // Backend-Endpoint hat ein hartes Limit von 500 Files pro Call.
    // Seriell, nicht parallel — pro File macht das Backend einen
    // DB-Update + S3-Delete, parallel würde S3 nur unnötig schwitzen
    // und ein einzelner Fehler wäre schwerer zu lesen.
    const CHUNK = 500;
    for (let i = 0; i < ids.length; i += CHUNK) {
      await api.bulkFileAction({
        galleryId: gallery.id,
        fileIds: ids.slice(i, i + CHUNK),
        action: "delete",
      });
    }
  }

  /** Generisch: oeffnet den Confirm-Dialog. Der onConfirm-Callback
   *  läuft im Dialog-Button-Handler — bei Erfolg schließt der Dialog
   *  automatisch, bei Fehler bleibt er offen mit Inline-Fehlermeldung. */
  function openConfirm(opts: {
    title: string;
    message: string;
    confirmLabel: string;
    confirmVariant?: "danger" | "primary";
    pendingLabel?: string;
    onConfirm: () => Promise<void>;
  }) {
    setBulkError(null);
    setConfirmDialog({
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.confirmLabel,
      confirmVariant: opts.confirmVariant ?? "danger",
      pendingLabel: opts.pendingLabel,
      onConfirm: opts.onConfirm,
    });
  }

  /** Tap auf 'Löschen' / 'Verbergen' / 'Anzeigen' im Auswahl-Modus.
   *  Bei 'delete' oeffnet das den Confirm-Dialog. Bei 'hide'/'show'
   *  direkt ausfuehren — irreversible Aktion ist nur 'delete'. */
  function runBulk(action: "delete" | "hide" | "show") {
    if (!gallery || selected.size === 0) return;
    const count = selected.size;
    if (action === "delete") {
      const message =
        count === 1
          ? t("studio.confirmDeleteOne")
          : t("studio.confirmDeleteMany", { count });
      openConfirm({
        title: count === 1 ? "Datei löschen?" : `${count} Dateien löschen?`,
        message,
        confirmLabel: "Löschen",
        confirmVariant: "danger",
        pendingLabel:
          count > 500
            ? `Lösche… (${count} Dateien, das dauert kurz)`
            : "Lösche…",
        onConfirm: async () => {
          await bulkDeleteIds(Array.from(selected));
          exitSelectionMode();
          await load();
        },
      });
      return;
    }
    // Non-destructive: direkt durchziehen (hide/show)
    void (async () => {
      if (!gallery) return;
      setBulkPending(true);
      setBulkError(null);
      try {
        const ids = Array.from(selected);
        const CHUNK = 500;
        for (let i = 0; i < ids.length; i += CHUNK) {
          await api.bulkFileAction({
            galleryId: gallery.id,
            fileIds: ids.slice(i, i + CHUNK),
            action,
          });
        }
        exitSelectionMode();
        await load();
      } catch (err) {
        console.error(err);
        setBulkError(err instanceof Error ? err.message : "Fehler");
      } finally {
        setBulkPending(false);
      }
    })();
  }

  /** Löscht hängende Uploads — File-Records die seit >5 Min in
   *  status='uploading' stehen, weil das Frontend-XHR irgendwo
   *  abgebrochen wurde aber den File-Record nicht aufräumen konnte. */
  function cleanupStuckUploads(stuckIds: string[]) {
    if (!gallery || stuckIds.length === 0) return;
    openConfirm({
      title: `${stuckIds.length} hängende Uploads aufräumen?`,
      message: `File-Records werden entfernt und ggf. vorhandene S3-Objekte mit. Du kannst die Dateien danach erneut hochladen.`,
      confirmLabel: "Aufräumen",
      confirmVariant: "danger",
      pendingLabel: "Räume auf…",
      onConfirm: async () => {
        await bulkDeleteIds(stuckIds);
        await load();
      },
    });
  }

  /** Löscht fehlgeschlagene Files (status='failed'). Worker-Pipeline
   *  hat aufgegeben (kaputter Datentyp, ffmpeg-Crash, …). DB-Eintrag
   *  bleibt mit status=failed, kein Thumbnail/Preview. Kunde sieht
   *  sie nicht (Visibility-Filter im API), aber das Studio behält
   *  tote Tiles. */
  function cleanupFailedFiles(failedIds: string[]) {
    if (!gallery || failedIds.length === 0) return;
    openConfirm({
      title: `${failedIds.length} fehlgeschlagene Dateien löschen?`,
      message: `Diese Dateien konnten nicht verarbeitet werden — z.B. wegen ungültigen Formaten oder Worker-Fehlern. File-Records werden entfernt und ggf. vorhandene S3-Objekte mit.`,
      confirmLabel: "Löschen",
      confirmVariant: "danger",
      pendingLabel: "Lösche…",
      onConfirm: async () => {
        await bulkDeleteIds(failedIds);
        await load();
      },
    });
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

  // Derived: Pending-Files (Upload-Link-Uploads, noch nicht freigegeben).
  // Wir zählen pro-Render aus gallery.files — günstig genug bei den
  // typischen 100-2000 Files, und der Code bleibt synchron mit dem
  // gallery-State.
  const pendingFiles = gallery.files.filter(
    (f) => f.uploadedVia === "upload_link" && f.publicVisibility === "hidden"
  );
  const pendingCount = pendingFiles.length;
  const visibleFiles =
    fileFilter === "pending" ? pendingFiles : gallery.files;
  const selectedPendingCount = pendingFiles.filter((f) =>
    selected.has(f.id)
  ).length;
  const selectedHasPending = selectedPendingCount > 0;

  // "Stuck"-Uploads erkennen: status='uploading' UND älter als 5 Min.
  // Frische Uploads (innerhalb 5 Min) sind möglicherweise noch real
  // dabei — die wollen wir nicht versehentlich rauskicken. Bei >5 Min
  // ist es praktisch sicher dass das Frontend-XHR geknallt ist und der
  // File-Record in einer DB-Leiche hängt; S3-Object ist entweder gar
  // nicht oder nur partiell hochgeladen. Cleanup ist sicher.
  const STUCK_THRESHOLD_MS = 5 * 60 * 1000;
  const now = Date.now();
  const stuckFiles = gallery.files.filter(
    (f) =>
      f.status === "uploading" &&
      now - new Date(f.createdAt).getTime() > STUCK_THRESHOLD_MS
  );

  // "Failed"-Files: Worker-Pipeline hat aufgegeben (ungültiges
  // Bildformat, korruptes RAW, ffmpeg-Crash, …). DB-Eintrag bleibt
  // mit status=failed, S3-Object ggf. teilweise hochgeladen. Kein
  // Thumbnail, kein Preview — der Kunde sieht es nicht (Visibility-
  // Filter im API), aber das Studio behaelt einen toten Tile. Cleanup
  // ist sicher: bulk-action/delete entfernt DB-Row + S3-Original +
  // alle (in der Regel keine) Renditions.
  const failedFiles = gallery.files.filter((f) => f.status === "failed");

  return (
    <>
      {/* Live-Activity-Toasts: fixiert oben, rechts der Sidebar.
          z-index hoch genug für andere Sticky-Elemente, pointer-events-none
          damit Klicks darunter ungestört durchgehen. */}
      {activity.length > 0 && (
        <div
          className="fixed top-4 right-6 z-50 flex flex-col gap-2 pointer-events-none"
          aria-live="polite"
        >
          {activity.map((a) => (
            <div
              key={a.id}
              className="px-3 py-2 rounded-sm bg-surface-overlay border border-line-strong text-ui-sm text-ink-primary shadow-lg animate-fade-in max-w-sm"
            >
              {a.text}
            </div>
          ))}
        </div>
      )}

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
              href={`/studio/${gallery.id}/stats`}
              className="text-ui-sm text-ink-secondary hover:text-ink-primary transition-colors duration-motion"
            >
              {t("studio.statsLink")}
            </Link>
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
        {gallery.files.filter((f) => f.status === "failed").length > 0 && (
          <>
            <span className="text-ink-tertiary/40">·</span>
            <span className="text-semantic-danger">
              {gallery.files.filter((f) => f.status === "failed").length}{" "}
              {t("studio.failedCount")}
            </span>
          </>
        )}
        {pendingCount > 0 && (
          <>
            <span className="text-ink-tertiary/40">·</span>
            <button
              onClick={() => setFileFilter("pending")}
              className="text-accent hover:text-accent-hover underline underline-offset-2"
              title={t("studio.uploadLinks.pendingFilterTitle")}
            >
              {t("studio.uploadLinks.pendingHeaderCounter", { count: pendingCount })}
            </button>
          </>
        )}
      </div>

      {/* Tags */}
      <div className="px-6 sm:px-8 py-3 border-b border-line-subtle flex items-center gap-3 flex-wrap">
        <span className="text-ui-xs uppercase tracking-[0.12em] text-ink-tertiary">
          {t("studio.tagsLabel")}
        </span>
        <TagPicker
          current={gallery.tags ?? []}
          onAssign={async (tagId) => {
            await api.assignTagToGallery(gallery.id, tagId);
            void load();
          }}
          onRemove={async (tagId) => {
            await api.removeTagFromGallery(gallery.id, tagId);
            void load();
          }}
        />
      </div>

      <div className="px-6 sm:px-8 py-6 space-y-6 max-w-7xl">
        {/* KI-Auto-Tagging-Toolbar — versteckt sich selbst wenn Feature
            aus. Bei aktivem Flag: Re-Tag + Bulk-Accept-Threshold. */}
        <AutoTagsToolbar galleryId={gallery.id} />

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
            JPEG, PNG, WebP, HEIC, RAW (CR2/NEF/ARW…), MP4, MOV
            {maxUploadMib !== null && (
              <>
                {" — "}
                {t("studio.uploadHint", {
                  size:
                    maxUploadMib >= 1024
                      ? `${(maxUploadMib / 1024).toFixed(maxUploadMib / 1024 >= 10 ? 0 : 1)} GB`
                      : `${maxUploadMib} MB`,
                })}
              </>
            )}
          </div>
        </section>

        {/* Slow-Connection Toggle — eigenständig unter der Drop-Zone,
            damit der Klick darauf nicht den Drop-Zone-Click triggert
            (der File-Picker öffnen würde). */}
        <div className="flex justify-end -mt-3">
          <SlowConnectionToggle />
        </div>

        {/* Aktive Uploads */}
        {(Object.keys(uploads).length > 0 || pendingInitCount > 0) && (
          <section className="rounded-md border border-line-subtle bg-surface-raised">
            <div className="px-4 py-2 border-b border-line-subtle text-ui-sm font-medium text-ink-secondary flex items-center justify-between">
              <span>Aktive Uploads</span>
              {pendingInitCount > 0 && (
                <span className="text-ui-xs text-ink-tertiary font-normal">
                  {pendingInitCount} {pendingInitCount === 1 ? "Datei wird" : "Dateien werden"} vorbereitet…
                </span>
              )}
            </div>
            {(() => {
              // Bei vielen aktiven Uploads (typisch nach einem Drop von
              // hunderten Files) würde das Rendern aller Zeilen sehr
              // langsam werden — jeder Progress-Tick triggert ein
              // Re-Render der ganzen Liste. Limit auf 50 angezeigte
              // Zeilen plus eine zusammengefasste Footer-Zeile.
              const all = Object.values(uploads);
              const MAX_VISIBLE = 50;
              const visible = all.slice(0, MAX_VISIBLE);
              const hidden = all.length - visible.length;
              const summary = {
                uploading: all.filter((u) => u.status === "uploading").length,
                queued: all.filter((u) => u.status === "queued").length,
                processing: all.filter((u) => u.status === "processing").length,
                ready: all.filter((u) => u.status === "ready").length,
                failed: all.filter((u) => u.status === "failed").length,
              };
              return (
                <>
                  <ul className="divide-y divide-line-subtle">
                    {visible.map((u) => (
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
                  {hidden > 0 && (
                    <div className="px-4 py-2 border-t border-line-subtle text-ui-xs text-ink-tertiary">
                      … und {hidden} weitere ({summary.uploading} laden,{" "}
                      {summary.queued} warten, {summary.processing} werden verarbeitet,{" "}
                      {summary.ready} fertig, {summary.failed} fehlgeschlagen)
                    </div>
                  )}
                </>
              );
            })()}
          </section>
        )}

        {/* Share-Panel */}
        <SharePanel galleryId={gallery.id} gallerySlug={gallery.slug} />

        {/* Header-Customization — Hero, Logo, Welcome-Text */}
        <GalleryHeaderEditor
          gallery={gallery}
          files={gallery.files.map((f) => ({
            id: f.id,
            filename: f.originalFilename,
            thumbUrl: f.thumbUrl ?? null,
          }))}
          onChanged={async () => {
            await load();
          }}
        />

        {/* Kapitel/Sections — optional, ordnet Files zu Kapiteln zu */}
        <SectionsEditor
          galleryId={gallery.id}
          files={gallery.files.map((f) => ({
            id: f.id,
            filename: f.originalFilename,
            thumbUrl: f.thumbUrl ?? null,
            sectionId: f.sectionId ?? null,
          }))}
          onChanged={async () => {
            await load();
          }}
        />

        {/* Galerie-Settings */}
        <section className="rounded-md border border-line-subtle bg-surface-raised p-5 space-y-3">
          <h2 className="text-ui-md font-medium text-ink-primary">
            {t("studio.settingsHeading")}
          </h2>

          {/* Mode-Switcher. Zwei Buttons (Toggle-Style) statt Dropdown,
              damit der aktive Modus auf einen Blick sichtbar ist.
              Wechsel auf Presentation triggert eine Confirm-Warnung,
              weil bestehende Customer-Auswahl / Markierungen / Kommen-
              tare zwar in der DB bleiben, aber im Customer-View
              versteckt werden. Wechsel auf Collaboration ist
              unkritisch — alles wird wieder sichtbar. */}
          <div className="space-y-1">
            <div className="text-ui text-ink-primary">Modus</div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  if (gallery.mode === "collaboration") return;
                  // Wechsel zu Collaboration ist unkritisch.
                  void (async () => {
                    await api.updateGallery(gallery.id, {
                      mode: "collaboration",
                    });
                    await load();
                  })();
                }}
                className={`flex-1 rounded-md border px-3 py-2 text-left transition-colors duration-motion ${
                  gallery.mode === "collaboration"
                    ? "border-accent bg-accent/10 text-ink-primary"
                    : "border-line-subtle bg-surface-sunken text-ink-secondary hover:border-line-strong"
                }`}
              >
                <div className="text-ui-sm font-medium">Auswahl / Proofing</div>
                <div className="text-ui-xs text-ink-tertiary mt-0.5">
                  Kunde kann Bilder auswählen, kommentieren und markieren.
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (gallery.mode === "presentation") return;
                  openConfirm({
                    title: "Auf Präsentation umstellen?",
                    message:
                      "Bestehende Kunden-Auswahl, Markierungen und Kommentare bleiben in der Datenbank erhalten, sind aber für Kunden nicht mehr sichtbar. Du kannst jederzeit zurück auf Auswahl/Proofing wechseln.",
                    confirmLabel: "Umstellen",
                    confirmVariant: "primary",
                    pendingLabel: "Stelle um…",
                    onConfirm: async () => {
                      await api.updateGallery(gallery.id, {
                        mode: "presentation",
                      });
                      await load();
                    },
                  });
                }}
                className={`flex-1 rounded-md border px-3 py-2 text-left transition-colors duration-motion ${
                  gallery.mode === "presentation"
                    ? "border-accent bg-accent/10 text-ink-primary"
                    : "border-line-subtle bg-surface-sunken text-ink-secondary hover:border-line-strong"
                }`}
              >
                <div className="text-ui-sm font-medium">Präsentation</div>
                <div className="text-ui-xs text-ink-tertiary mt-0.5">
                  Reine Anzeige. Keine Auswahl, keine Markierungen, keine Kommentare.
                </div>
              </button>
            </div>
          </div>

          {/* Hinweis fuer Presentation-Modus: einige Toggles unten
              (Kommentare/Markierungen, Auswahl-Limit) sind in diesem
              Modus nicht aktiv, weil der Kunde nur anzeigen kann.
              Statt sie zu verstecken — User koennte spaeter den Modus
              umschalten und erwartet dann die alten Einstellungen
              wieder — grauen wir sie aus und erklaeren warum. */}
          {gallery.mode === "presentation" && (
            <div className="rounded-xs bg-surface-sunken px-3 py-2 text-ui-xs text-ink-secondary">
              Diese Galerie ist im{" "}
              <span className="font-medium">Präsentations-Modus</span>. Der
              Kunde kann Bilder ansehen, aber keine Auswahl treffen, Bilder
              markieren oder kommentieren. Einstellungen unten, die nur im
              Auswahl/Proofing-Modus wirken, sind ausgegraut.
            </div>
          )}
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
          {gallery.downloadEnabled && (
            <SettingToggle
              label={t("studio.settingOriginals")}
              description={t("studio.settingOriginalsDesc")}
              value={gallery.downloadOriginalsEnabled}
              onChange={(v) => toggleSetting("downloadOriginalsEnabled", v)}
            />
          )}
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
            disabled={gallery.mode === "presentation"}
            disabledHint={
              gallery.mode === "presentation"
                ? "Nur im Auswahl/Proofing-Modus verfügbar."
                : undefined
            }
          />
          {tenantFeatures?.includes("print_shop") && (
            <SettingToggle
              label="Print-Shop für diese Galerie"
              description={
                gallery.printShopEnabled === false
                  ? "Endkunden sehen den Print-Shop-Button NICHT, auch wenn er für das Studio aktiv ist."
                  : "Wenn der Print-Shop im Studio aktiv ist, sehen Endkunden hier den Bestell-Button."
              }
              value={gallery.printShopEnabled !== false}
              onChange={(v) => togglePrintShop(v)}
            />
          )}
          <SelectionLimitInput
            value={gallery.selectionLimit}
            onChange={async (v) => {
              await api.updateGallery(gallery.id, { selectionLimit: v });
              await load();
            }}
            disabled={gallery.mode === "presentation"}
            disabledHint={
              gallery.mode === "presentation"
                ? "Nur im Auswahl/Proofing-Modus verfügbar."
                : undefined
            }
          />
        </section>

        {/* Upload-Links: öffentliche Drag-and-Drop-Endpunkte */}
        <UploadLinksSection galleryId={gallery.id} />

        {/* Files-Toolbar */}
        {gallery.files.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
              <h2 className="text-ui-md font-medium text-ink-primary flex items-center gap-2 flex-wrap">
                <span>{t("studio.files")}</span>
                {selectionMode && selected.size > 0 && (
                  <span className="text-ui-sm text-ink-tertiary font-normal">
                    · {selected.size} {t("studio.selectedSuffix")}
                  </span>
                )}
                {pendingCount > 0 && (
                  <button
                    onClick={() =>
                      setFileFilter((f) => (f === "pending" ? "all" : "pending"))
                    }
                    className={`text-ui-xs uppercase tracking-wider px-2 py-0.5 rounded-xs font-medium transition-colors duration-motion ${
                      fileFilter === "pending"
                        ? "bg-accent text-accent-contrast"
                        : "bg-accent/15 text-accent hover:bg-accent/25"
                    }`}
                    title={t("studio.uploadLinks.pendingFilterTitle")}
                  >
                    {t("studio.uploadLinks.pendingCounter", { count: pendingCount })}
                  </button>
                )}
              </h2>
              <div className="flex items-center gap-1.5">
                {selectionMode ? (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setSelected(
                          new Set(visibleFiles.map((f) => f.id))
                        )
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
                    {/* Bulk-Approve nur sichtbar wenn pending-Files in der
                        Auswahl sind. Selektive Anzeige verhindert den
                        Klick-Versuch auf einen No-Op. */}
                    {selectedHasPending && (
                      <>
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={approveSelected}
                          disabled={bulkPending || selected.size === 0}
                        >
                          {t("studio.uploadLinks.approveSelected", {
                            count: selectedPendingCount,
                          })}
                        </Button>
                        {/* Bulk-Reject — danger-Variante, öffnet Dialog
                            mit Reason-Eingabe. Wirkt nur auf die pending-
                            Files in der Auswahl (visible werden ignoriert
                            vom Backend). */}
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() =>
                            setRejectDialog({
                              type: "bulk",
                              fileIds: pendingFiles
                                .filter((f) => selected.has(f.id))
                                .map((f) => f.id),
                            })
                          }
                          disabled={bulkPending || selected.size === 0}
                        >
                          {t("studio.uploadLinks.rejectSelected", {
                            count: selectedPendingCount,
                          })}
                        </Button>
                      </>
                    )}
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
                  <>
                    {/* Quickaction: alle wartenden freigeben — sichtbar
                        wenn überhaupt was wartet, unabhängig von Filter. */}
                    {pendingCount > 0 && (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={approveAllPending}
                        disabled={bulkPending}
                      >
                        {t("studio.uploadLinks.approveAll", { count: pendingCount })}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowDuplicatesDialog(true)}
                      title="Bilder mit identischem Inhalt finden und aufräumen"
                    >
                      Duplikate finden
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setSelectionMode(true)}
                    >
                      {t("studio.selectFiles")}
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Hängende-Uploads-Banner: zeigt sich nur wenn >5 Min alte
                Files mit status='uploading' existieren — die sind
                praktisch sicher tote File-Records, weil das Browser-XHR
                irgendwann geknallt ist (Network, Connection-Pool,
                Signature expired). User bekommt einen Cleanup-Button. */}
            {stuckFiles.length > 0 && (
              <div className="mb-3 rounded-md border border-semantic-warning/30 bg-semantic-warning/8 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="text-ui-sm text-ink-secondary">
                  <span className="font-medium text-ink-primary">
                    {stuckFiles.length}{" "}
                    {stuckFiles.length === 1
                      ? "hängender Upload"
                      : "hängende Uploads"}
                  </span>{" "}
                  – seit über 5 Minuten in „wird hochgeladen“. Wahrscheinlich
                  ist das Browser-Upload geknallt. Du kannst sie aufräumen
                  und neu hochladen.
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    cleanupStuckUploads(stuckFiles.map((f) => f.id))
                  }
                  disabled={bulkPending}
                >
                  {bulkPending
                    ? "Räume auf…"
                    : `${stuckFiles.length} aufräumen`}
                </Button>
              </div>
            )}

            {/* Failed-Files-Banner: zeigt sich wenn Files mit
                status='failed' existieren. Der Worker hat die
                Verarbeitung aufgegeben — meist wegen ungültigem
                Bildformat, kaputtem RAW oder ffmpeg-Crash. Studio
                sieht tote Tiles, Kunde sieht nichts (Visibility-
                Filter). Button raeumt sie auf. */}
            {failedFiles.length > 0 && (
              <div className="mb-3 rounded-md border border-semantic-danger/30 bg-semantic-danger/8 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="text-ui-sm text-ink-secondary">
                  <span className="font-medium text-ink-primary">
                    {failedFiles.length}{" "}
                    {failedFiles.length === 1
                      ? "fehlgeschlagene Datei"
                      : "fehlgeschlagene Dateien"}
                  </span>{" "}
                  – Verarbeitung war nicht möglich (ungültiges Format,
                  Worker-Fehler …). Du kannst sie aufräumen und ggf.
                  neu hochladen.
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    cleanupFailedFiles(failedFiles.map((f) => f.id))
                  }
                  disabled={bulkPending}
                >
                  {bulkPending
                    ? "Lösche…"
                    : `${failedFiles.length} löschen`}
                </Button>
              </div>
            )}

            <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
              <SortableContext
                items={visibleFiles.map((f) => f.id)}
                strategy={rectSortingStrategy}
                disabled={selectionMode || fileFilter !== "all"}
              >
                <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5">
                  {visibleFiles.map((f, i) => (
                    <FileTile
                      key={f.id}
                      file={f}
                      index={i}
                      selectionMode={selectionMode}
                      selected={selected.has(f.id)}
                      onToggle={toggleSelected}
                    />
                  ))}
                </ul>
                {visibleFiles.length === 0 && fileFilter === "pending" && (
                  <div className="text-ui-sm text-ink-tertiary text-center py-12">
                    {t("studio.uploadLinks.noPending")}
                  </div>
                )}
              </SortableContext>
            </DndContext>
          </section>
        )}

        {gallery.files.length === 0 && (
          <div className="text-ui text-ink-tertiary">{t("studio.noFiles")}</div>
        )}
      </div>

      {/* Dup-Dialog: zeigt sich wenn der User Files gedropped hat,
          deren Dateinamen schon in der Galerie existieren. Drei
          Optionen: nur neue, alle (auch Duplikate), abbrechen.
          Wichtig: Lumio macht aktuell KEIN Server-seitiges Dedup —
          ohne diesen Dialog hätte der User die Bilder sonst doppelt
          in der Galerie und müsste sie nachträglich aufräumen. */}
      {dupDialog && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setDupDialog(null)}
        >
          <div
            className="bg-surface-base rounded-lg border border-line-subtle shadow-2xl max-w-lg w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-medium text-ink-primary">
              Duplikate erkannt
            </h2>
            <p className="text-ui-sm text-ink-secondary mt-2">
              {dupDialog.duplicates.length}{" "}
              {dupDialog.duplicates.length === 1
                ? "Datei hat denselben Namen wie eine"
                : "Dateien haben denselben Namen wie"}{" "}
              bereits in der Galerie vorhandene{" "}
              {dupDialog.duplicates.length === 1 ? "Datei" : "Dateien"}.{" "}
              {dupDialog.newFiles.length > 0 && (
                <>
                  Die übrigen {dupDialog.newFiles.length}{" "}
                  {dupDialog.newFiles.length === 1
                    ? "Datei ist"
                    : "Dateien sind"}{" "}
                  neu.
                </>
              )}
            </p>
            {/* Bei wenigen Duplikaten Namen direkt zeigen; bei vielen
                in <details> kollabieren, sonst wird der Dialog
                unleserlich. */}
            {dupDialog.duplicates.length <= 8 ? (
              <ul className="mt-3 text-ui-xs text-ink-tertiary font-mono max-h-32 overflow-y-auto bg-surface-sunken rounded-xs px-3 py-2 space-y-0.5">
                {dupDialog.duplicates.map((f) => (
                  <li key={f.name} className="truncate">
                    {f.name}
                  </li>
                ))}
              </ul>
            ) : (
              <details className="mt-3">
                <summary className="text-ui-xs text-ink-tertiary cursor-pointer hover:text-ink-secondary">
                  Liste anzeigen ({dupDialog.duplicates.length})
                </summary>
                <ul className="mt-2 text-ui-xs text-ink-tertiary font-mono max-h-48 overflow-y-auto bg-surface-sunken rounded-xs px-3 py-2 space-y-0.5">
                  {dupDialog.duplicates.map((f) => (
                    <li key={f.name} className="truncate">
                      {f.name}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="flex gap-2 justify-end mt-5 flex-wrap">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDupDialog(null)}
              >
                Abbrechen
              </Button>
              {dupDialog.newFiles.length > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const newOnly = dupDialog.newFiles;
                    setDupDialog(null);
                    void startUpload(newOnly);
                  }}
                >
                  Nur neue hochladen ({dupDialog.newFiles.length})
                </Button>
              )}
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  const all = [
                    ...dupDialog.newFiles,
                    ...dupDialog.duplicates,
                  ];
                  setDupDialog(null);
                  void startUpload(all);
                }}
              >
                Trotzdem alle hochladen (
                {dupDialog.newFiles.length + dupDialog.duplicates.length})
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Duplikate-Finden-Modal: SHA-256-basierte Inhalt-Erkennung.
          Triggert beim Oeffnen einen Worker-Scan (falls noetig),
          zeigt anschliessend die Gruppen mit Side-By-Side-Thumbs
          und Loesch-Auswahl. */}
      {showDuplicatesDialog && (
        <DuplicatesDialog
          galleryId={id}
          onClose={() => setShowDuplicatesDialog(false)}
          onDeleted={() => void load()}
        />
      )}

      {/* Generisches Confirm-Modal. Wird von runBulk (Auswahl-
          Modus-Loeschen), cleanupStuckUploads, cleanupFailedFiles
          und ggf. Mode-Wechsel-Warnung verwendet. Eigener Dialog
          statt window.confirm() weil iOS Safari den nativen Dialog
          nach langen Renders verschluckt. */}
      {confirmDialog && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !bulkPending && setConfirmDialog(null)}
        >
          <div
            className="bg-surface-base rounded-lg border border-line-subtle shadow-2xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-medium text-ink-primary">
              {confirmDialog.title}
            </h2>
            <p className="text-ui-sm text-ink-secondary mt-2">
              {confirmDialog.message}
            </p>
            {bulkError && (
              <p className="text-ui-sm text-semantic-danger mt-3">
                {bulkError}
              </p>
            )}
            <div className="flex gap-2 justify-end mt-5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDialog(null)}
                disabled={bulkPending}
              >
                Abbrechen
              </Button>
              <Button
                variant={confirmDialog.confirmVariant}
                size="sm"
                onClick={async () => {
                  setBulkPending(true);
                  setBulkError(null);
                  try {
                    await confirmDialog.onConfirm();
                    setConfirmDialog(null);
                  } catch (err) {
                    console.error(err);
                    // Bleibt im Dialog stehen mit Inline-Fehler,
                    // User kann retryen oder abbrechen.
                    setBulkError(
                      err instanceof Error ? err.message : "Fehler"
                    );
                  } finally {
                    setBulkPending(false);
                  }
                }}
                disabled={bulkPending}
              >
                {bulkPending
                  ? confirmDialog.pendingLabel ?? "Bitte warten…"
                  : confirmDialog.confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      )}

      {limitDialog && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setLimitDialog(null)}
        >
          <div
            className="bg-surface-base rounded-lg border border-line-subtle shadow-2xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-medium text-ink-primary">
              {limitDialog.title}
            </h2>
            <p className="text-ui-sm text-ink-secondary mt-2">
              {limitDialog.message}
            </p>
            <div className="flex gap-2 justify-end mt-5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLimitDialog(null)}
              >
                Schließen
              </Button>
              <Link
                href="/studio/billing"
                className="inline-flex items-center px-4 h-9 rounded-md bg-accent text-ink-on-accent text-ui-sm font-medium hover:bg-accent-hover transition-colors duration-motion"
                onClick={() => setLimitDialog(null)}
              >
                Plan & Speicher
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Reject-Dialog: Single oder Bulk, mit Reason-Eingabe + Presets */}
      {rejectDialog && (
        <RejectDialog
          count={
            rejectDialog.type === "single" ? 1 : rejectDialog.fileIds.length
          }
          onCancel={() => setRejectDialog(null)}
          onConfirm={performReject}
        />
      )}
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
  disabled,
  disabledHint,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  /** Wenn true, ist der Toggle nicht klickbar und wird ausgegraut.
   *  Sinnvoll fuer Settings die im aktuellen Galerie-Modus keinen
   *  Effekt haben (z.B. Kommentare in einer Presentation-Galerie). */
  disabled?: boolean;
  /** Optionaler Hinweistext der bei disabled unter der Beschreibung
   *  erscheint — erklaert warum der Toggle nicht aktiv ist. */
  disabledHint?: string;
}) {
  return (
    <label
      className={`flex items-start gap-3 py-1 ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      }`}
    >
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => !disabled && onChange(e.target.checked)}
        disabled={disabled}
        className="mt-1 accent-accent"
      />
      <div className="flex-1">
        <div className="text-ui text-ink-primary">{label}</div>
        {description && (
          <div className="text-ui-xs text-ink-tertiary mt-0.5">{description}</div>
        )}
        {disabled && disabledHint && (
          <div className="text-ui-xs text-ink-tertiary mt-0.5 italic">
            {disabledHint}
          </div>
        )}
      </div>
    </label>
  );
}

/**
 * Input für `selectionLimit`. Leeres Feld = unbegrenzt (null). Wir speichern
 * onBlur und nur, wenn sich der Wert wirklich geändert hat — sonst pingt
 * jedes Klicken auf das Feld unnötig die API. State spiegelt während der
 * Eingabe den Roh-String wider; konvertiert wird beim Commit.
 */
function SelectionLimitInput({
  value,
  onChange,
  disabled,
  disabledHint,
}: {
  value: number | null;
  onChange: (next: number | null) => void | Promise<void>;
  disabled?: boolean;
  disabledHint?: string;
}) {
  const t = useT();
  const [raw, setRaw] = useState<string>(value !== null ? String(value) : "");
  const [pending, setPending] = useState(false);

  // Wenn die Galerie reloaded wird, kann sich `value` extern ändern.
  // Wir resynchronisieren raw — aber nur, wenn der User gerade nicht
  // editiert. Eine Detail-State `dirty`-Flag wäre robuster, aber für
  // dieses simple Feld reicht es, raw nachzuziehen wenn value sich
  // wirklich ändert.
  useEffect(() => {
    setRaw(value !== null ? String(value) : "");
  }, [value]);

  async function commit() {
    if (disabled) return;
    const trimmed = raw.trim();
    let parsed: number | null;
    if (trimmed === "") {
      parsed = null;
    } else {
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n < 1) {
        // ungültig — zurücksetzen
        setRaw(value !== null ? String(value) : "");
        return;
      }
      parsed = n;
    }
    if (parsed === value) return; // kein Change
    setPending(true);
    try {
      await onChange(parsed);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={`flex items-start gap-3 py-1 ${disabled ? "opacity-50" : ""}`}>
      <div className="mt-1 w-4 flex-shrink-0" /> {/* gleicher Einzug wie die Checkboxes */}
      <div className="flex-1">
        <label className="text-ui text-ink-primary block">
          {t("studio.settingSelectionLimit")}
        </label>
        <div className="text-ui-xs text-ink-tertiary mt-0.5 mb-2">
          {t("studio.settingSelectionLimitDesc")}
        </div>
        {disabled && disabledHint && (
          <div className="text-ui-xs text-ink-tertiary italic mb-2">
            {disabledHint}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            placeholder={t("studio.settingSelectionLimitPlaceholder")}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            disabled={pending || disabled}
            className="w-24 h-9 px-2.5 rounded bg-surface-sunken border border-line-subtle hover:border-line-strong focus:border-accent text-ui text-ink-primary placeholder:text-ink-tertiary focus:outline-none transition-colors duration-motion disabled:opacity-50 disabled:cursor-not-allowed"
          />
          {pending && (
            <span className="text-ui-xs text-ink-tertiary">
              {t("common.saving")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** FileTile — eine Kachel in der Studio-Gallery-Grid.
 *
 *  WICHTIG: memoized. Bei grossen Galerien (1000+ Files) wuerde
 *  jeder setSelected-Update sonst alle Tiles re-rendern. Auf iPhone
 *  Safari kann das mehrere Sekunden blocken — der Folge-Tap auf
 *  einen Button (z.B. 'Loeschen') wird dann verworfen.
 *  Memo greift, weil:
 *   - file, selectionMode, onToggle stabile Identitaeten haben
 *     (onToggle ist useCallback im Parent, file kommt aus stabiler
 *     gallery.files-Array, selectionMode ist Boolean).
 *   - selected ist Boolean, also nur das EINE getoggelte Tile
 *     re-rendert beim Single-Click.
 *  Bei Select-All bleibt der initiale Render mit allen Tiles
 *  unvermeidlich (alle aendern selected=true gleichzeitig), aber
 *  jeder spaetere Einzel-Toggle ist schnell.
 */
const FileTile = memo(_FileTile);

function _FileTile({
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
  /** Bekommt die file.id als Argument, damit der Caller keinen
   *  Arrow-Wrapper () => onToggle(file.id) bauen muss — der wuerde
   *  bei jedem Render eine neue Funktion erzeugen und memo brechen. */
  onToggle: (fileId: string) => void;
}) {
  const t = useT();
  const isHidden = file.status === "hidden";
  const isFailed = file.status === "failed";
  // Pending-Approval: File kam via UploadLink und ist noch nicht
  // freigegeben. Studio sieht es mit Badge; Customer noch nicht
  // (publicVisibility-Filter im API). Freigabe läuft über die
  // Bulk-Toolbar oben, nicht über den Tile selbst.
  const isPending =
    file.uploadedVia === "upload_link" &&
    file.publicVisibility === "hidden";
  // Rejected: Studio hat aktiv abgelehnt. S3-Objekte sind weg, DB-Row
  // bleibt. Tile zeigt einen dunklen Platzhalter mit Reject-Badge und
  // dem Grund als Tooltip — kein Thumbnail mehr verfügbar.
  const isRejected = file.publicVisibility === "rejected";

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
          : isFailed
          ? "border-semantic-danger/40 hover:border-semantic-danger/70"
          : isRejected
          ? "border-semantic-danger/30 hover:border-semantic-danger/50"
          : "border-line-subtle hover:border-line-strong"
      } ${
        selectionMode
          ? "cursor-pointer"
          : "cursor-grab active:cursor-grabbing touch-none"
      } transition-colors duration-motion`}
      onClick={selectionMode ? () => onToggle(file.id) : undefined}
      title={
        isRejected
          ? file.rejectedReason
            ? `${t("studio.uploadLinks.rejectedBadge")}: ${file.rejectedReason}`
            : t("studio.uploadLinks.rejectedBadge")
          : isFailed
          ? file.errorMessage ?? "Verarbeitung fehlgeschlagen"
          : undefined
      }
      {...(selectionMode ? {} : attributes)}
      {...(selectionMode ? {} : listeners)}
    >
      {isRejected ? (
        // Rejected: S3-Objekte sind weg, kein Thumbnail mehr verfügbar.
        // Wir zeigen einen dunklen Platzhalter mit Grund. Wenn der User
        // den Cursor drüber hält bekommt er den vollen Reject-Reason im
        // title-Tooltip (siehe oben).
        <div className="w-full h-full flex items-center justify-center bg-semantic-danger/10 p-2">
          <div className="text-center">
            <div className="text-2xl opacity-40">⊘</div>
            <div className="text-ui-xs text-ink-tertiary mt-1 line-clamp-2">
              {file.rejectedReason ?? t("studio.uploadLinks.rejectedNoReason")}
            </div>
          </div>
        </div>
      ) : file.thumbUrl ? (
        // Bei failed: Thumbnail trotzdem anzeigen wenn vorhanden, aber stark
        // abgedunkelt und mit klarem Failed-Badge oben rechts. Das nimmt der
        // UI die "alles ok"-Illusion, die uns beim events-Import-Bug Stunden
        // gekostet hat. Studio-Detail-Seite blieb damals zeigend, weil
        // thumb-Renditions vor dem Status-Fail geschrieben wurden.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={file.thumbUrl}
          alt={file.originalFilename}
          className={`w-full h-full object-cover ${
            isHidden ? "opacity-40" : isFailed ? "opacity-30 grayscale" : ""
          }`}
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

      {/* Failed-Badge — überlagert ggf. den Hidden-Badge, weil failed das
          spezifischere Problem ist */}
      {isFailed && (
        <div className="absolute top-1.5 right-1.5 text-ui-xs uppercase tracking-wider px-1.5 py-0.5 rounded-xs bg-semantic-danger/90 text-surface-canvas font-medium">
          Fehler
        </div>
      )}

      {/* Hidden-Badge (nur wenn nicht failed — sonst Doppel-Badge) */}
      {isHidden && !isFailed && (
        <div className="absolute top-1.5 right-1.5 text-ui-xs uppercase tracking-wider px-1.5 py-0.5 rounded-xs bg-semantic-warning/90 text-surface-canvas font-medium">
          versteckt
        </div>
      )}

      {/* Pending-Approval: File kam via UploadLink, Studio muss freigeben.
          Badge oben-rechts (überschneidet sich nicht mit isHidden, weil
          publicVisibility=hidden ≠ status=hidden — File ist ready, nur
          nicht für Customer sichtbar). Freigabe passiert über die
          Toolbar (Bulk-Action), nicht über den Tile selbst — auf dem
          Tile würde der Approve-Button mit dem Drag-and-Drop kollidieren
          (Klick wird als Drag-Start interpretiert). */}
      {isPending && !isFailed && (
        <div
          className="absolute top-1.5 right-1.5 text-ui-xs uppercase tracking-wider px-1.5 py-0.5 rounded-xs bg-accent/90 text-accent-contrast font-medium"
          title={t("studio.uploadLinks.pendingHint")}
        >
          {t("studio.uploadLinks.pendingBadge")}
        </div>
      )}

      {/* Rejected-Badge — abgewiesener Upload, S3-Objekte sind weg.
          Im Reject-Pattern legitim mit dem Hidden-Badge zu kollidieren,
          weil rejected-Files NICHT gleichzeitig status='hidden' sind
          (das wäre ein Studio-Workflow-State, getrennt von publicVis-
          ibility). */}
      {isRejected && (
        <div
          className="absolute top-1.5 right-1.5 text-ui-xs uppercase tracking-wider px-1.5 py-0.5 rounded-xs bg-semantic-danger/90 text-surface-canvas font-medium"
          title={
            file.rejectedReason
              ? `${t("studio.uploadLinks.rejectedBadge")}: ${file.rejectedReason}`
              : t("studio.uploadLinks.rejectedBadge")
          }
        >
          {t("studio.uploadLinks.rejectedBadge")}
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
