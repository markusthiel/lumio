"use client";

import { useEffect, useState } from "react";
import { api, type GalleryAccess } from "@/lib/api";

export function SharePanel({
  galleryId,
  gallerySlug,
}: {
  galleryId: string;
  gallerySlug: string;
}) {
  const [accesses, setAccesses] = useState<GalleryAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api.listAccesses(galleryId);
      setAccesses(res.accesses);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryId]);

  function buildShareUrl(token?: string): string {
    if (typeof window === "undefined") return `/g/${gallerySlug}`;
    const base = window.location.origin;
    return token
      ? `${base}/g/${gallerySlug}?t=${token}`
      : `${base}/g/${gallerySlug}`;
  }

  async function copyLink(label: string, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // ignore
    }
  }

  async function deleteAccess(id: string) {
    if (!confirm("Share-Link wirklich widerrufen?")) return;
    await api.deleteAccess(galleryId, id);
    void load();
  }

  return (
    <section className="rounded-lg border border-line-subtle bg-surface-raised">
      <header className="px-4 py-3 border-b border-line-subtle flex items-center justify-between">
        <h2 className="text-sm font-medium">Share-Links</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="text-xs px-2.5 py-1 rounded bg-accent text-accent-contrast hover:bg-accent-hover"
        >
          + Neuer Link
        </button>
      </header>

      <div className="px-4 py-3">
        {/* Public link (ohne Token) */}
        <div className="border border-line-subtle rounded p-3 mb-3 bg-surface-sunken">
          <div className="text-xs font-medium text-ink-secondary">
            Öffentlicher Link
          </div>
          <div className="text-xs text-ink-tertiary mb-2">
            Anonyme Vorschau ohne Auswahl/Kommentare.
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-surface-raised border border-line-subtle rounded px-2 py-1 truncate">
              {buildShareUrl()}
            </code>
            <button
              onClick={() => copyLink("public", buildShareUrl())}
              className="text-xs px-2 py-1 rounded border border-line-subtle hover:bg-surface-sunken"
            >
              {copied === "public" ? "Kopiert!" : "Kopieren"}
            </button>
          </div>
        </div>

        {/* Access-Token-Links */}
        {loading ? (
          <div className="text-xs text-ink-tertiary">Lädt…</div>
        ) : accesses.length === 0 ? (
          <div className="text-xs text-ink-tertiary">
            Noch keine personalisierten Links. Lege einen an, damit Kunden
            Auswahl und Kommentare zugeordnet werden.
          </div>
        ) : (
          <ul className="space-y-2">
            {accesses.map((a) => {
              const url = buildShareUrl(a.token);
              return (
                <li
                  key={a.id}
                  className="border border-line-subtle rounded p-3 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">{a.label}</div>
                      {a.email && (
                        <div className="text-xs text-ink-tertiary">{a.email}</div>
                      )}
                    </div>
                    <button
                      onClick={() => deleteAccess(a.id)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Widerrufen
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-surface-sunken border border-line-subtle rounded px-2 py-1 truncate">
                      {url}
                    </code>
                    <button
                      onClick={() => copyLink(a.id, url)}
                      className="text-xs px-2 py-1 rounded border border-line-subtle hover:bg-surface-sunken"
                    >
                      {copied === a.id ? "Kopiert!" : "Kopieren"}
                    </button>
                  </div>
                  <div className="text-[10px] text-ink-tertiary flex gap-2">
                    {a.canDownload && <span>↓ Download</span>}
                    {a.canSelect && <span>● Auswahl</span>}
                    {a.canComment && <span>● Kommentare</span>}
                    {a.canSeeOthers && <span>● Andere sehen</span>}
                    <span className="ml-auto">
                      {a.accessCount} Aufrufe
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {showCreate && (
        <CreateAccessDialog
          galleryId={galleryId}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            void load();
          }}
        />
      )}
    </section>
  );
}

function CreateAccessDialog({
  galleryId,
  onClose,
  onCreated,
}: {
  galleryId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [label, setLabel] = useState("");
  const [email, setEmail] = useState("");
  const [canDownload, setCanDownload] = useState(true);
  const [canComment, setCanComment] = useState(true);
  const [canSelect, setCanSelect] = useState(true);
  const [canSeeOthers, setCanSeeOthers] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api.createAccess(galleryId, {
        label,
        email: email || undefined,
        canDownload,
        canComment,
        canSelect,
        canSeeOthers,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
        className="w-full max-w-md bg-surface-raised rounded-lg p-6 space-y-4"
      >
        <h2 className="text-lg font-semibold">Neuer Share-Link</h2>

        <div className="space-y-1">
          <label htmlFor="label" className="text-sm font-medium">
            Bezeichnung
          </label>
          <input
            id="label"
            required
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full rounded-md border border-line-subtle px-3 py-2 text-sm"
            placeholder="z.B. Brautpaar, Agentur, Eltern"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-medium">
            E-Mail <span className="text-ink-tertiary">(optional, für Notifications)</span>
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-line-subtle px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <div className="text-sm font-medium">Berechtigungen</div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={canDownload}
              onChange={(e) => setCanDownload(e.target.checked)}
            />
            Darf Dateien herunterladen
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={canSelect}
              onChange={(e) => setCanSelect(e.target.checked)}
            />
            Darf Auswahl treffen (Like, Color-Tag)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={canComment}
              onChange={(e) => setCanComment(e.target.checked)}
            />
            Darf kommentieren
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={canSeeOthers}
              onChange={(e) => setCanSeeOthers(e.target.checked)}
            />
            Sieht Auswahl/Kommentare anderer Teams
          </label>
        </div>

        {error && (
          <div className="text-sm text-semantic-danger bg-semantic-danger/10 border border-semantic-danger/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-3 py-2 rounded-md border border-line-subtle hover:bg-surface-sunken"
          >
            Abbrechen
          </button>
          <button
            type="submit"
            disabled={pending}
            className="text-sm px-3 py-2 rounded-md bg-accent text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
          >
            {pending ? "Wird erstellt…" : "Erstellen"}
          </button>
        </div>
      </form>
    </div>
  );
}
