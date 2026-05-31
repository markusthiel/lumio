"use client";

/**
 * Lumio — Public Datenexport (Token-basiert)
 *
 * URL-Form: /e/<token>
 *
 * Wird vom Super-Admin via Mail an archivierte Tenants verschickt.
 * Kein Login nötig. Zeigt:
 *   - Header mit Tenant-Name + Hinweistext
 *   - Liste der Galerien mit Status + Download-Button
 *
 * Selbe Polling-Logik wie die Studio-Detail-Page: wenn noch ein Item
 * nicht-final ist, alle 3 s neuladen.
 *
 * Downloads gehen über /api/v1/e/<token>/items/<itemId>/download —
 * Backend liefert 302-Redirect auf signed S3-URL. Browser folgt
 * automatisch.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";

interface PublicExportItem {
  id: string;
  gallerySlug: string;
  galleryName: string;
  status: "pending" | "building" | "ready" | "failed";
  sizeBytes: number | null;
  fileCount: number | null;
  errorMessage: string | null;
}

interface PublicExportData {
  tenant: { id: string; name: string; slug: string };
  export: {
    id: string;
    status: string;
    expiresAt: string;
    createdAt: string;
    items: PublicExportItem[];
  };
}

const STATUS_LABEL: Record<string, string> = {
  pending: "exportPage.statusPending",
  building: "exportPage.statusBuilding",
  ready: "exportPage.statusReady",
  failed: "exportPage.statusFailed",
};

export default function PublicExportPage() {
  const t = useT();
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [data, setData] = useState<PublicExportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{
    code: "expired" | "not_found" | "generic";
    message: string;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getPublicExport(token);
      setData(res);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("common.error");
      // Backend-Fehler: 404 = not_found, 410 = expired
      const code: "expired" | "not_found" | "generic" = msg.includes("expired")
        ? "expired"
        : msg.includes("not_found")
        ? "not_found"
        : "generic";
      setError({ code, message: msg });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // Polling solange noch was läuft.
  useEffect(() => {
    if (!data) return;
    const hasActive = data.export.items.some(
      (it) => it.status === "pending" || it.status === "building"
    );
    if (!hasActive) return;
    const t = setInterval(() => {
      void load();
    }, 3000);
    return () => clearInterval(t);
  }, [data, load]);

  if (loading) {
    return (
      <FullScreenCenter>
        <div className="text-ui text-ink-tertiary">Wird geladen…</div>
      </FullScreenCenter>
    );
  }
  if (error) {
    return (
      <FullScreenCenter>
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-2xl font-semibold text-ink-primary">
            {error.code === "expired"
              ? t("exportPage.titleExpired")
              : error.code === "not_found"
              ? t("exportPage.titleInvalid")
              : t("common.error")}
          </h1>
          <p className="text-ui-sm text-ink-secondary">
            {error.code === "expired"
              ? t("exportPage.bodyExpired")
              : error.code === "not_found"
              ? t("exportPage.bodyInvalid")
              : error.message}
          </p>
        </div>
      </FullScreenCenter>
    );
  }
  if (!data) return null;

  const readyCount = data.export.items.filter((it) => it.status === "ready")
    .length;
  const activeCount = data.export.items.filter(
    (it) => it.status === "pending" || it.status === "building"
  ).length;
  const failedCount = data.export.items.filter((it) => it.status === "failed")
    .length;

  return (
    <div className="min-h-screen bg-surface-base">
      <div className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-semibold text-ink-primary">
          {t("exportPage.heading")}
        </h1>
        <div className="text-ui-md text-ink-secondary mt-1">
          {data.tenant.name}
        </div>

        <div className="mt-6 rounded-md bg-surface-raised border border-line-subtle p-4 space-y-2">
          <p className="text-ui-sm text-ink-secondary">
            {t("exportPage.intro")}
          </p>
          <ul className="list-disc pl-5 text-ui-sm text-ink-secondary space-y-0.5">
            <li>
              {t("exportPage.liOriginalsPre")} <span className="font-mono">originals/</span> {t("exportPage.liOriginalsPost")}
            </li>
            <li>
              <span className="font-mono">metadata.json</span> {t("exportPage.liMetadataPost")}
            </li>
            <li>
              <span className="font-mono">README.txt</span> {t("exportPage.liReadmePost")}
            </li>
          </ul>
          <p className="text-ui-xs text-ink-tertiary pt-2">
            {t("exportPage.availableUntil", { date: new Date(data.export.expiresAt).toLocaleDateString("de-DE") })}
          </p>
        </div>

        <div className="mt-6 mb-3 text-ui-sm text-ink-secondary">
          {t("exportPage.readyProgress", { ready: readyCount, total: data.export.items.length })}
          {failedCount > 0 && (
            <span className="text-semantic-danger ml-2">
              {t("exportPage.failedSuffix", { n: failedCount })}
            </span>
          )}
          {activeCount > 0 && (
            <span className="text-ink-tertiary ml-2">
              {t("exportPage.activeSuffix", { n: activeCount })}
            </span>
          )}
        </div>

        <section className="rounded-md border border-line-subtle bg-surface-raised divide-y divide-line-subtle">
          {data.export.items.map((it) => (
            <ItemRow key={it.id} item={it} token={token} />
          ))}
        </section>

        <p className="text-ui-xs text-ink-tertiary text-center mt-8">
          {t("exportPage.footer")}
        </p>
      </div>
    </div>
  );
}

function ItemRow({
  item,
  token,
}: {
  item: PublicExportItem;
  token: string;
}) {
  const t = useT();
  const downloadHref = api.getPublicExportItemDownloadUrl(token, item.id);
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-ui text-ink-primary truncate">
          {item.galleryName}
        </div>
        <div className="text-ui-xs text-ink-tertiary mt-0.5">
          {item.status === "ready" && item.fileCount !== null
            ? t("exportPage.itemReady", { n: item.fileCount, size: formatBytes(item.sizeBytes ?? 0) })
            : item.status === "failed"
            ? t("exportPage.itemError", { msg: item.errorMessage ?? t("exportPage.unknown") })
            : t(STATUS_LABEL[item.status])}
        </div>
      </div>
      <div>
        {item.status === "ready" ? (
          <a
            href={downloadHref}
            className="inline-flex items-center h-8 px-3 rounded text-ui-sm bg-accent text-accent-contrast hover:bg-accent-hover transition-colors duration-motion"
            download={`${item.gallerySlug}.zip`}
          >
            {t("exportPage.download")}
          </a>
        ) : item.status === "failed" ? (
          <span className="text-ui-xs text-semantic-danger">
            {t("exportPage.failedShort")}
          </span>
        ) : (
          <span className="text-ui-xs text-ink-tertiary">
            {t(STATUS_LABEL[item.status])}…
          </span>
        )}
      </div>
    </div>
  );
}

function FullScreenCenter({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface-base flex items-center justify-center p-6">
      {children}
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
