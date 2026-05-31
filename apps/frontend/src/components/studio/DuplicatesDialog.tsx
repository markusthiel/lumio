"use client";

/**
 * Lumio Studio — Duplikate-Finden-Modal
 *
 * Workflow:
 *  1. Beim Oeffnen wird POST /duplicates/scan getriggert. Wenn das
 *     Backend antwortet { scanRequired: false }, koennen wir direkt
 *     die Gruppen laden. Sonst pollen wir den Progress-Endpoint, bis
 *     der Worker fertig ist, und laden dann die Gruppen.
 *
 *  2. Gruppen werden untereinander angezeigt. Pro Gruppe: alle
 *     Duplikate als Thumbnails nebeneinander (max 2 in einer Reihe,
 *     scrollbar bei groesseren Gruppen). Pro File eine Checkbox
 *     "loeschen" — standardmaessig sind die NEUEREN angehakt
 *     (= aelteste behalten wir, weil Benutzer "neuere = mehr Drops
 *     aus Versehen" denkt; aber pro Gruppe das ALLERAELTESTE ist
 *     defensiv-default behalten).
 *
 *  3. Klick auf "Auswahl loeschen" → POST /files/bulk-action mit
 *     den angehakten IDs. Loescht + raeumt S3 + invalidiert ZIP-Cache.
 *
 * Pragmatik:
 *  - Nicht-modaler Side-By-Side-Vergleich: bei 200 Gruppen wuerde ein
 *    Lightbox-Compare pro Gruppe zu klick-intensiv. Stattdessen ein
 *    Klick auf das Thumbnail vergroessert es als Overlay.
 *  - Bei 1000+ Files in einer Galerie kann das Modal viele Tiles
 *    laden. Wir holen die Gruppen einmalig (groupCount + totalDups
 *    werden in der Header-Zeile angezeigt) und rendern alle. Bei
 *    extrem grossen Galerien koennte man virtualisieren — fuer
 *    typische Use-Cases (10-100 Dup-Gruppen) ist das nicht noetig.
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { useT } from "@/lib/i18n";

interface DupFile {
  id: string;
  originalFilename: string;
  sizeBytes: number;
  createdAt: string;
  width: number | null;
  height: number | null;
  thumbUrl: string | null;
}

interface DupGroup {
  sha256: string;
  count: number;
  files: DupFile[];
}

interface Props {
  galleryId: string;
  onClose: () => void;
  /** Wird aufgerufen wenn Files geloescht wurden — Studio-Page
   *  reloaded daraufhin die Galerie. */
  onDeleted: () => void;
}

type Phase = "initial" | "scanning" | "loading" | "ready" | "error";

const POLL_INTERVAL_MS = 2000;

export function DuplicatesDialog({ galleryId, onClose, onDeleted }: Props) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>("initial");
  const [scanProgress, setScanProgress] = useState<{
    total: number;
    done: number;
    ok: number;
    failed: number;
  }>({ total: 0, done: 0, ok: 0, failed: 0 });
  const [groups, setGroups] = useState<DupGroup[]>([]);
  const [groupCount, setGroupCount] = useState(0);
  const [totalDuplicates, setTotalDuplicates] = useState(0);
  const [selectedToDelete, setSelectedToDelete] = useState<Set<string>>(
    new Set(),
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [zoomFile, setZoomFile] = useState<DupFile | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Default-Auswahl: pro Gruppe wird das ALTESTE behalten (Index 0
  // nach createdAt-asc), alle anderen werden zum Loeschen vorgeschlagen.
  // Logisch: das aelteste ist mit hoher Wahrscheinlichkeit das
  // "Original" und die neueren sind versehentliche Re-Uploads.
  // Frage hatten wir: "Neueres behalten, Aelteres loeschen" — habe
  // mich pragmatisch fuer "Aelteres behalten" entschieden, weil das
  // Original-File alle Metadaten (Tags, Selections, Comments) hat,
  // die spaeter beim Re-Upload nicht mehr da waeren. User kann pro
  // Gruppe umkehren.
  const initDefaultSelection = useCallback((newGroups: DupGroup[]) => {
    const sel = new Set<string>();
    for (const g of newGroups) {
      // alle ausser dem ersten (= aeltesten) anhaken
      for (let i = 1; i < g.files.length; i++) {
        sel.add(g.files[i].id);
      }
    }
    setSelectedToDelete(sel);
  }, []);

  const loadGroups = useCallback(async () => {
    setPhase("loading");
    try {
      const res = await api.findDuplicates(galleryId);
      setGroups(res.groups);
      setGroupCount(res.groupCount);
      setTotalDuplicates(res.totalDuplicates);
      initDefaultSelection(res.groups);
      setPhase("ready");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t("dupes.errorLoad"));
      setPhase("error");
    }
  }, [galleryId, initDefaultSelection]);

  // Initial: Scan triggern, dann je nach Antwort Polling oder direkt laden
  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    async function start() {
      try {
        const r = await api.scanDuplicates(galleryId);
        if (cancelled) return;
        if (!r.scanRequired) {
          await loadGroups();
          return;
        }
        // Scan laeuft im Hintergrund → Progress pollen
        setPhase("scanning");
        setScanProgress({
          total: r.missingCount,
          done: 0,
          ok: 0,
          failed: 0,
        });

        async function poll() {
          if (cancelled) return;
          try {
            const s = await api.getDuplicateScanStatus(galleryId);
            if (cancelled) return;
            setScanProgress({
              total: s.total,
              done: s.done,
              ok: s.ok,
              failed: s.failed,
            });
            if (s.status === "done") {
              await loadGroups();
              return;
            }
            if (s.status === "failed") {
              setErrorMsg("Scan fehlgeschlagen");
              setPhase("error");
              return;
            }
            // idle, queued, running → weiter pollen
            pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
          } catch (err) {
            if (cancelled) return;
            setErrorMsg(err instanceof Error ? err.message : t("dupes.errorPoll"));
            setPhase("error");
          }
        }
        pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : t("dupes.errorScanStart"));
        setPhase("error");
      }
    }

    void start();
    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
    // galleryId aendert sich nicht innerhalb des Modal-Lifecycles
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryId]);

  function toggle(fileId: string) {
    setSelectedToDelete((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  }

  async function performDelete() {
    if (selectedToDelete.size === 0) return;
    const ids = Array.from(selectedToDelete);
    const msg = `${ids.length} Duplikate löschen? Die S3-Objekte werden mit entfernt — das lässt sich nicht rückgängig machen.`;
    if (!confirm(msg)) return;
    setDeleting(true);
    try {
      // bulk-action Endpoint hat Limit 500 Files pro Call → chunken
      const CHUNK = 500;
      for (let i = 0; i < ids.length; i += CHUNK) {
        await api.bulkFileAction({
          galleryId,
          fileIds: ids.slice(i, i + CHUNK),
          action: "delete",
        });
      }
      onDeleted();
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t("dupes.errorDelete"));
      setDeleting(false);
    }
  }

  const scanPercent =
    scanProgress.total > 0
      ? Math.round((scanProgress.done / scanProgress.total) * 100)
      : 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={() => !deleting && onClose()}
    >
      <div
        className="bg-surface-base rounded-lg border border-line-subtle shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line-subtle">
          <div>
            <h2 className="text-lg font-medium text-ink-primary">{t("dupes.title")}</h2>
            {phase === "ready" && (
              <p className="text-ui-sm text-ink-tertiary mt-0.5">
                {groupCount === 0
                  ? t("dupes.noneFoundShort")
                  : t("dupes.summary", { groups: groupCount, groupWord: t(groupCount === 1 ? "dupes.group" : "dupes.groups"), dupes: totalDuplicates, dupeWord: t(totalDuplicates === 1 ? "dupes.duplicate" : "dupes.duplicates") })}
              </p>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>{t("common.close")}</Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {phase === "initial" && (
            <div className="text-center py-12 text-ui-sm text-ink-tertiary">{t("dupes.starting")}</div>
          )}

          {phase === "scanning" && (
            <div className="py-12 max-w-md mx-auto text-center space-y-4">
              <div className="text-ui text-ink-primary">{t("dupes.scanning")}</div>
              <div className="text-ui-sm text-ink-tertiary">
                {t("dupes.scanningDesc")}
              </div>
              <div className="h-2 bg-surface-sunken rounded-xs overflow-hidden">
                <div
                  className="h-full bg-accent transition-all duration-motion"
                  style={{ width: `${scanPercent}%` }}
                />
              </div>
              <div className="text-ui-xs text-ink-tertiary tabular-nums">
                {scanProgress.done} / {scanProgress.total} ({scanPercent}%)
                {scanProgress.failed > 0 &&
                  t("dupes.failedSuffix", { n: scanProgress.failed })}
              </div>
            </div>
          )}

          {phase === "loading" && (
            <div className="text-center py-12 text-ui-sm text-ink-tertiary">{t("dupes.loadingGroups")}</div>
          )}

          {phase === "error" && (
            <div className="py-12 max-w-md mx-auto text-center space-y-3">
              <div className="text-ui text-semantic-danger">
                {errorMsg ?? t("dupes.genericError")}
              </div>
              <Button variant="secondary" size="sm" onClick={onClose}>{t("common.close")}</Button>
            </div>
          )}

          {phase === "ready" && groups.length === 0 && (
            <div className="text-center py-12">
              <div className="text-ui text-ink-primary">{t("dupes.noneBitExact")}</div>
              <div className="text-ui-sm text-ink-tertiary mt-2">
                {t("dupes.noneBitExactDesc")}
              </div>
            </div>
          )}

          {phase === "ready" && groups.length > 0 && (
            <div className="space-y-6">
              {groups.map((g) => (
                <DupGroupCard
                  key={g.sha256}
                  group={g}
                  selectedIds={selectedToDelete}
                  onToggle={toggle}
                  onZoom={setZoomFile}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer: Auswahl + Loeschen */}
        {phase === "ready" && groups.length > 0 && (
          <div className="px-6 py-3 border-t border-line-subtle flex items-center justify-between gap-3 flex-wrap">
            <div className="text-ui-sm text-ink-secondary">
              {selectedToDelete.size === 0
                ? t("dupes.selectHint")
                : t("dupes.selectedCount", { n: selectedToDelete.size, fileWord: t(selectedToDelete.size === 1 ? "dupes.file" : "dupes.files") })}
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                disabled={deleting}
              >{t("common.cancel")}</Button>
              <Button
                variant="danger"
                size="sm"
                onClick={performDelete}
                disabled={deleting || selectedToDelete.size === 0}
              >
                {deleting
                  ? t("dupes.deleting")
                  : t("dupes.deleteCount", { n: selectedToDelete.size, fileWord: t(selectedToDelete.size === 1 ? "dupes.file" : "dupes.files") })}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Zoom-Overlay: Klick auf ein Thumbnail vergroessert es als
          Bildschirm-fuellendes Overlay. Einfach gehalten — kein Pan,
          kein Multi-Image-Compare, das wuerde den Code unnoetig
          aufblasen. */}
      {zoomFile && (
        <div
          className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-8"
          onClick={() => setZoomFile(null)}
        >
          {zoomFile.thumbUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={zoomFile.thumbUrl}
              alt={zoomFile.originalFilename}
              className="max-h-full max-w-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      )}
    </div>
  );
}

function DupGroupCard({
  group,
  selectedIds,
  onToggle,
  onZoom,
}: {
  group: DupGroup;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onZoom: (f: DupFile) => void;
}) {
  const t = useT();
  return (
    <div className="rounded-md border border-line-subtle bg-surface-raised p-4">
      <div className="flex items-baseline justify-between mb-3 gap-2">
        <div className="text-ui-sm text-ink-secondary">
          {group.count}× <span className="font-medium text-ink-primary">{group.files[0].originalFilename}</span>
        </div>
        <div className="text-ui-xs text-ink-tertiary font-mono truncate">
          sha256:{group.sha256.slice(0, 12)}…
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {group.files.map((f, idx) => {
          const isSelected = selectedIds.has(f.id);
          const isOldest = idx === 0;
          return (
            <div
              key={f.id}
              className={`rounded-md border overflow-hidden transition-colors duration-motion ${
                isSelected
                  ? "border-semantic-danger/60 bg-semantic-danger/8"
                  : "border-line-subtle bg-surface-base"
              }`}
            >
              <button
                type="button"
                className="block w-full aspect-square bg-surface-sunken relative group"
                onClick={() => onZoom(f)}
                title={t("dupes.zoomTitle")}
              >
                {f.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={f.thumbUrl}
                    alt={f.originalFilename}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-ui-xs text-ink-tertiary">{t("dupes.noThumbnail")}</div>
                )}
                {isOldest && (
                  <div className="absolute top-2 left-2 bg-accent text-accent-contrast text-ui-xs font-medium px-2 py-0.5 rounded-xs">{t("dupes.original")}</div>
                )}
              </button>
              <div className="p-2.5 flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-ui-xs text-ink-primary truncate">
                    {f.originalFilename}
                  </div>
                  <div className="text-ui-xs text-ink-tertiary mt-0.5">
                    {formatBytes(f.sizeBytes)} ·{" "}
                    {new Date(f.createdAt).toLocaleDateString()}
                    {f.width && f.height && ` · ${f.width}×${f.height}`}
                  </div>
                </div>
                <label className="flex items-center gap-1.5 text-ui-xs text-ink-secondary cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggle(f.id)}
                    className="accent-semantic-danger"
                  />{t("common.delete")}</label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatBytes(b: number): string {
  if (b >= 1024 * 1024 * 1024) return `${(b / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${b} B`;
}
