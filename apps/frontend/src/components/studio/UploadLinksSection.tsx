"use client";

/**
 * Lumio Studio — Upload-Links-Section
 *
 * Verwaltung der öffentlichen Drag-and-Drop-Endpunkte pro Galerie.
 * Studio erstellt einen Link mit Label, optional Passwort + Limits;
 * teilt die URL an Dritte; Empfänger laden Bilder via /u/<token>.
 *
 * Files die über einen Link reinkommen landen mit
 * publicVisibility="hidden" → Studio sieht sie sofort (mit Badge im
 * Tile), Customer-Galerie erst nach manueller Freigabe.
 */
import { useEffect, useState } from "react";
import { api, type UploadLink } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useT } from "@/lib/i18n";

interface Props {
  galleryId: string;
}

export function UploadLinksSection({ galleryId }: Props) {
  const t = useT();
  const [links, setLinks] = useState<UploadLink[] | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    const res = await api.listUploadLinks(galleryId);
    setLinks(res);
  }

  useEffect(() => {
    void load();
  }, [galleryId]);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-ui-md font-medium text-ink-primary">
          {t("studio.uploadLinks.heading")}
        </h2>
        <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
          {t("studio.uploadLinks.newButton")}
        </Button>
      </div>
      <p className="text-ui-sm text-ink-tertiary">
        {t("studio.uploadLinks.description")}
      </p>

      {creating && (
        <CreateLinkDialog
          galleryId={galleryId}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void load();
          }}
        />
      )}

      {links === null ? (
        <div className="text-ui-sm text-ink-tertiary">
          {t("studio.uploadLinks.loading")}
        </div>
      ) : links.length === 0 ? (
        <div className="text-ui-sm text-ink-tertiary border border-line-subtle rounded p-4 text-center">
          {t("studio.uploadLinks.empty")}
        </div>
      ) : (
        <ul className="divide-y divide-line-subtle border border-line-subtle rounded">
          {links.map((link) => (
            <LinkRow
              key={link.id}
              link={link}
              galleryId={galleryId}
              onChanged={load}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// LinkRow — eine Zeile in der Liste
// ---------------------------------------------------------------------------
function LinkRow({
  link,
  galleryId,
  onChanged,
}: {
  link: UploadLink;
  galleryId: string;
  onChanged: () => void | Promise<void>;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const url = typeof window !== "undefined"
    ? `${window.location.origin}/u/${link.token}`
    : `/u/${link.token}`;

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard nicht verfügbar — silent */
    }
  }

  async function toggleActive() {
    setBusy(true);
    try {
      await api.updateUploadLink(galleryId, link.id, { active: !link.active });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(t("studio.uploadLinks.confirmDelete"))) return;
    setBusy(true);
    try {
      await api.deleteUploadLink(galleryId, link.id);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  const expired = link.expiresAt && new Date(link.expiresAt) < new Date();

  return (
    <li className="p-3 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-ink-primary">{link.label}</span>
          {link.hasPassword && (
            <span className="text-[10px] uppercase tracking-wide bg-surface-sunken text-ink-secondary px-1.5 py-0.5 rounded">
              {t("studio.uploadLinks.passwordBadge")}
            </span>
          )}
          {!link.active && (
            <span className="text-[10px] uppercase tracking-wide bg-semantic-warning/15 text-semantic-warning px-1.5 py-0.5 rounded">
              {t("studio.uploadLinks.inactiveBadge")}
            </span>
          )}
          {expired && (
            <span className="text-[10px] uppercase tracking-wide bg-semantic-danger/15 text-semantic-danger px-1.5 py-0.5 rounded">
              {t("studio.uploadLinks.expiredBadge")}
            </span>
          )}
        </div>
        <div className="mt-1 text-ui-xs text-ink-tertiary flex items-center gap-3 flex-wrap font-mono">
          <span className="truncate max-w-md">{url}</span>
          <button
            onClick={copyUrl}
            className="text-accent hover:text-accent-hover underline"
          >
            {copied ? t("studio.uploadLinks.copied") : t("studio.uploadLinks.copy")}
          </button>
        </div>
        <div className="mt-1 text-ui-xs text-ink-tertiary">
          {t("studio.uploadLinks.stats", {
            count: link.uploadCount,
            mb: (Number(link.bytesUploaded) / 1024 / 1024).toFixed(1),
          })}
          {link.maxFiles !== null && ` · max ${link.maxFiles}`}
          {link.expiresAt &&
            ` · ${t("studio.uploadLinks.expires")} ${new Date(link.expiresAt).toLocaleDateString()}`}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          onClick={toggleActive}
          disabled={busy}
        >
          {link.active
            ? t("studio.uploadLinks.disable")
            : t("studio.uploadLinks.enable")}
        </Button>
        <Button size="sm" variant="ghost" onClick={remove} disabled={busy}>
          {t("studio.uploadLinks.delete")}
        </Button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// CreateLinkDialog — Modal zum Anlegen
// ---------------------------------------------------------------------------
function CreateLinkDialog({
  galleryId,
  onClose,
  onCreated,
}: {
  galleryId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useT();
  const [label, setLabel] = useState("");
  const [password, setPassword] = useState("");
  const [maxFiles, setMaxFiles] = useState("");
  const [maxGB, setMaxGB] = useState("");
  // Per-File-Limit in MB für DIESEN Link. Leer = Tenant-Limit erben.
  const [maxPerFileMB, setMaxPerFileMB] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!label.trim()) {
      setError(t("studio.uploadLinks.labelRequired"));
      return;
    }
    setBusy(true);
    try {
      const maxBytes =
        maxGB.trim() && !isNaN(Number(maxGB))
          ? Math.floor(Number(maxGB) * 1024 * 1024 * 1024)
          : null;
      const maxFilesNum =
        maxFiles.trim() && !isNaN(Number(maxFiles)) ? Number(maxFiles) : null;
      const maxPerFile =
        maxPerFileMB.trim() && !isNaN(Number(maxPerFileMB))
          ? Math.floor(Number(maxPerFileMB) * 1024 * 1024)
          : null;
      const expiresIso = expiresAt
        ? new Date(expiresAt).toISOString()
        : null;
      await api.createUploadLink(galleryId, {
        label: label.trim(),
        password: password.trim() || undefined,
        maxFiles: maxFilesNum,
        maxBytesTotal: maxBytes,
        maxFileBytes: maxPerFile,
        expiresAt: expiresIso,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface-canvas border border-line-subtle rounded-lg p-5 max-w-md w-full space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-ui-md font-medium text-ink-primary">
          {t("studio.uploadLinks.dialogHeading")}
        </h3>

        <label className="block">
          <span className="text-ui-sm text-ink-secondary">
            {t("studio.uploadLinks.labelField")}
          </span>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("studio.uploadLinks.labelPlaceholder")}
            autoFocus
          />
        </label>

        <label className="block">
          <span className="text-ui-sm text-ink-secondary">
            {t("studio.uploadLinks.passwordField")}
          </span>
          <Input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("studio.uploadLinks.passwordPlaceholder")}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-ui-sm text-ink-secondary">
              {t("studio.uploadLinks.maxFilesField")}
            </span>
            <Input
              type="number"
              min="1"
              value={maxFiles}
              onChange={(e) => setMaxFiles(e.target.value)}
              placeholder="50"
            />
          </label>
          <label className="block">
            <span className="text-ui-sm text-ink-secondary">
              {t("studio.uploadLinks.maxGBField")}
            </span>
            <Input
              type="number"
              min="0.1"
              step="0.1"
              value={maxGB}
              onChange={(e) => setMaxGB(e.target.value)}
              placeholder="2"
            />
          </label>
        </div>

        {/* Per-File-Limit für DIESEN Link (in MB). Leer = Tenant-Wert.
            Wenn gesetzt: Backend prüft dass es ≤ Tenant-Limit ist
            (link_limit_exceeds_tenant Error). Sinnvoll z.B. wenn man
            den Junggesellenabend-Trauzeugen auf 500 MB pro File
            limitieren will, weil deren Smartphones eh nicht mehr
            schaffen, aber der Tenant-Default 10 GB ist. */}
        <label className="block">
          <span className="text-ui-sm text-ink-secondary">
            {t("studio.uploadLinks.maxPerFileField")}
          </span>
          <Input
            type="number"
            min="1"
            value={maxPerFileMB}
            onChange={(e) => setMaxPerFileMB(e.target.value)}
            placeholder={t("studio.uploadLinks.maxPerFilePlaceholder")}
          />
        </label>

        <label className="block">
          <span className="text-ui-sm text-ink-secondary">
            {t("studio.uploadLinks.expiresField")}
          </span>
          <Input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </label>

        {error && (
          <div className="text-ui-sm text-semantic-danger bg-semantic-danger/10 border border-semantic-danger/30 rounded px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={busy} variant="primary">
            {busy ? t("studio.uploadLinks.creating") : t("studio.uploadLinks.create")}
          </Button>
        </div>
      </div>
    </div>
  );
}
