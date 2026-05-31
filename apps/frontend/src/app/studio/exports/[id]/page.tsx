"use client";

/**
 * Lumio Studio — Export-Detail
 *
 * Zeigt alle Items eines Exports (eines pro Galerie). Pro Item:
 * Name + Status + ggf. Download-Button (wenn ready). Polled alle
 * 3 s solange noch ein Item nicht-final ist (pending/building).
 */
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { PageHeader } from "@/components/studio/PageHeader";
import { Button } from "@/components/ui";

interface ExportItem {
  id: string;
  galleryId: string | null;
  gallerySlug: string;
  galleryName: string;
  status: "pending" | "building" | "ready" | "failed";
  sizeBytes: number | null;
  fileCount: number | null;
  errorMessage: string | null;
  downloadUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ExportData {
  id: string;
  source: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  items: ExportItem[];
}

export default function ExportDetailPage() {
  const t = useT();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const [data, setData] = useState<ExportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.getExport(id);
      setData(res.export);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("exportDetail.errorLoad"));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Polling: wenn noch Items pending/building sind, alle 3s neuladen.
  useEffect(() => {
    if (!data) return;
    const hasActive = data.items.some(
      (it) => it.status === "pending" || it.status === "building"
    );
    if (!hasActive) return;
    const t = setInterval(() => {
      void load();
    }, 3000);
    return () => clearInterval(t);
  }, [data, load]);

  async function performDelete() {
    setDeleting(true);
    try {
      await api.deleteExport(id);
      router.push("/studio/exports");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("exportDetail.errorDelete"));
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto py-8 px-6 text-ui-sm text-ink-tertiary">{t("exportDetail.loading")}</div>
    );
  }
  if (error || !data) {
    return (
      <div className="max-w-4xl mx-auto py-8 px-6">
        <div className="text-ui text-semantic-danger mb-4">
          {error ?? t("exportDetail.notFound")}
        </div>
        <Link
          href="/studio/exports"
          className="text-ui-sm text-accent hover:text-accent-hover"
        >{t("exportDetail.backToOverview")}</Link>
      </div>
    );
  }

  const readyCount = data.items.filter((it) => it.status === "ready").length;
  const failedCount = data.items.filter((it) => it.status === "failed").length;
  const activeCount = data.items.filter(
    (it) => it.status === "pending" || it.status === "building"
  ).length;

  return (
    <div className="max-w-4xl mx-auto py-8 px-6">
      <Link
        href="/studio/exports"
        className="text-ui-xs text-ink-tertiary hover:text-ink-secondary mb-3 inline-block"
      >{t("exportDetail.backLink")}</Link>
      <PageHeader
        title={t("exportDetail.title")}
        description={t("exportDetail.createdExpires", { created: new Date(data.createdAt).toLocaleString("de-DE"), expires: new Date(data.expiresAt).toLocaleDateString("de-DE") })}
      />

      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="text-ui-sm text-ink-secondary">
          {readyCount} / {data.items.length} {t("exportDetail.ready")}
          {failedCount > 0 && (
            <span className="text-semantic-danger ml-2">
              {t("exportDetail.failedCount", { n: failedCount })}
            </span>
          )}
          {activeCount > 0 && (
            <span className="text-ink-tertiary ml-2">
              {t("exportDetail.activeCount", { n: activeCount })}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setConfirmDelete(true)}
          disabled={deleting}
        >{t("exportDetail.deleteExport")}</Button>
      </div>

      <section className="rounded-md border border-line-subtle bg-surface-raised divide-y divide-line-subtle">
        {data.items.map((it) => (
          <ItemRow key={it.id} item={it} />
        ))}
      </section>

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !deleting && setConfirmDelete(false)}
        >
          <div
            className="bg-surface-base rounded-lg border border-line-subtle shadow-2xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-medium text-ink-primary">{t("exportDetail.deleteTitle")}</h2>
            <p className="text-ui-sm text-ink-secondary mt-2">
              {t("exportDetail.deleteDesc")}
            </p>
            <div className="flex gap-2 justify-end mt-5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
              >{t("common.cancel")}</Button>
              <Button
                variant="danger"
                size="sm"
                onClick={performDelete}
                disabled={deleting}
              >
                {deleting ? t("exportDetail.deleting") : t("common.delete")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ItemRow({ item }: { item: ExportItem }) {
  const t = useT();
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-ui text-ink-primary truncate">
          {item.galleryName}
        </div>
        <div className="text-ui-xs text-ink-tertiary mt-0.5">
          {item.status === "ready" && item.fileCount !== null
            ? t("exportDetail.itemFiles", { n: item.fileCount, size: formatBytes(item.sizeBytes ?? 0) })
            : item.status === "failed"
            ? t("exportDetail.itemError", { msg: item.errorMessage ?? t("exportDetail.unknown") })
            : t(`exportDetail.status_${item.status}`)}
        </div>
      </div>
      <div>
        {item.status === "ready" && item.downloadUrl ? (
          <a
            href={item.downloadUrl}
            className="inline-flex items-center h-8 px-3 rounded text-ui-sm bg-accent text-accent-contrast hover:bg-accent-hover transition-colors duration-motion"
            download={`${item.gallerySlug}.zip`}
          >{t("exportDetail.download")}</a>
        ) : item.status === "failed" ? (
          <span className="text-ui-xs text-semantic-danger">{t("exportDetail.failedShort")}</span>
        ) : (
          <span className="text-ui-xs text-ink-tertiary">
            {t(`exportDetail.status_${item.status}`)}…
          </span>
        )}
      </div>
    </div>
  );
}

function formatBytes(b: number): string {
  if (b >= 1024 * 1024 * 1024)
    return `${(b / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(0)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${b} B`;
}
