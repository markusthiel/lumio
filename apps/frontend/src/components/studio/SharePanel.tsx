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
  /** Welcher Access-Eintrag schickt gerade eine Einladung? Bremst Doppelklicks. */
  const [invitingId, setInvitingId] = useState<string | null>(null);
  /** Welche Access-Einladung wurde gerade erfolgreich verschickt? Reset nach 2s. */
  const [invitedId, setInvitedId] = useState<string | null>(null);
  /** Welcher Access soll gerade eine Einladung verschicken? Dann zeigt das
   *  InviteModal. Wir uebergeben die Access-Daten damit das Modal Label/Email
   *  anzeigen kann. */
  const [inviteFor, setInviteFor] = useState<GalleryAccess | null>(null);
  /** Welcher Access ist im Zwei-Klick-Confirm-Modus für Widerrufen? */
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null
  );

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

  /** Direkt-Versand ohne Nachricht (z.B. nach Bestaetigung im Modal). */
  async function performSendInvitation(
    accessId: string,
    personalMessage: string | undefined
  ) {
    setInvitingId(accessId);
    try {
      const res = await api.sendAccessInvitation(galleryId, accessId, {
        personalMessage,
      });
      if (res.sent) {
        setInvitedId(accessId);
        setTimeout(() => setInvitedId(null), 2000);
      } else {
        alert("Einladung konnte nicht verschickt werden.");
      }
    } catch (err) {
      alert(
        err instanceof Error
          ? `Fehler: ${err.message}`
          : "Einladung konnte nicht verschickt werden."
      );
    } finally {
      setInvitingId(null);
    }
  }

  /** Widerrufen mit Zwei-Klick-Confirm (kein confirm()-Dialog,
   *  weil viele Browser den unterdruecken). Erster Klick markiert
   *  den Eintrag, zweiter Klick fuehrt durch. Auto-Reset nach 4s. */
  async function onDeleteClick(id: string) {
    if (confirmingDeleteId !== id) {
      setConfirmingDeleteId(id);
      setTimeout(() => {
        setConfirmingDeleteId((curr) => (curr === id ? null : curr));
      }, 4000);
      return;
    }
    setConfirmingDeleteId(null);
    try {
      await api.deleteAccess(galleryId, id);
      void load();
    } catch (err) {
      alert(
        err instanceof Error
          ? `Fehler beim Widerrufen: ${err.message}`
          : "Fehler beim Widerrufen"
      );
    }
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
                    <div className="flex items-center gap-2">
                      {a.email && (
                        <button
                          onClick={() => setInviteFor(a)}
                          disabled={invitingId === a.id}
                          className="text-xs text-accent hover:underline disabled:opacity-50"
                          title="Einladungs-Mail an diese Adresse schicken"
                        >
                          {invitingId === a.id
                            ? "Senden…"
                            : invitedId === a.id
                              ? "Gesendet ✓"
                              : "Einladung senden"}
                        </button>
                      )}
                      <button
                        onClick={() => onDeleteClick(a.id)}
                        className={
                          confirmingDeleteId === a.id
                            ? "text-xs text-red-600 font-medium hover:underline"
                            : "text-xs text-red-600 hover:underline"
                        }
                      >
                        {confirmingDeleteId === a.id
                          ? "Sicher? Nochmal klicken"
                          : "Widerrufen"}
                      </button>
                    </div>
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

      {inviteFor && (
        <InviteDialog
          access={inviteFor}
          onClose={() => setInviteFor(null)}
          onSent={(message) => {
            const id = inviteFor.id;
            setInviteFor(null);
            void performSendInvitation(id, message || undefined);
          }}
        />
      )}
    </section>
  );
}

/**
 * Mini-Modal fuer "Einladung senden" — zeigt Empfaenger-Adresse + Textarea
 * fuer optionale persoenliche Nachricht. Bewusst klein gehalten, der eigentliche
 * Versand passiert nach Submit ueber den Parent-Callback.
 */
function InviteDialog({
  access,
  onClose,
  onSent,
}: {
  access: GalleryAccess;
  onClose: () => void;
  onSent: (personalMessage: string) => void;
}) {
  const [message, setMessage] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSent(message);
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[100]"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
        className="w-full max-w-md bg-surface-raised border border-line-subtle shadow-2xl rounded-lg p-6 space-y-4"
      >
        <div>
          <h2 className="text-lg font-semibold">Einladung senden</h2>
          <p className="text-sm text-ink-secondary mt-1">
            Empfänger: <strong>{access.label}</strong>
            {access.email && (
              <>
                {" "}
                <span className="text-ink-tertiary">({access.email})</span>
              </>
            )}
          </p>
        </div>

        <div className="space-y-1">
          <label htmlFor="invite-msg" className="text-sm font-medium">
            Persönliche Nachricht{" "}
            <span className="text-ink-tertiary">(optional)</span>
          </label>
          <textarea
            id="invite-msg"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            maxLength={1000}
            autoFocus
            className="w-full rounded-md border border-line-subtle px-3 py-2 text-sm"
            placeholder="z.B. Liebe Anna, hier sind eure Hochzeitsbilder. Viel Freude beim Anschauen!"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-line-subtle">
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-3 py-2 rounded-md border border-line-subtle hover:bg-surface-sunken"
          >
            Abbrechen
          </button>
          <button
            type="submit"
            className="text-sm px-3 py-2 rounded-md bg-accent text-accent-contrast hover:bg-accent-hover"
          >
            Einladung verschicken
          </button>
        </div>
      </form>
    </div>
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
  /** Wenn die Email leer ist, ist die Option unwirksam — wir blenden
   *  die Eingaben deshalb erst ein, wenn email gesetzt ist. */
  const [sendInvitation, setSendInvitation] = useState(true);
  const [personalMessage, setPersonalMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wantsInvitation = !!email && sendInvitation;

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
        sendInvitation: wantsInvitation,
        personalMessage:
          wantsInvitation && personalMessage ? personalMessage : undefined,
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

        {/* Einladungs-Optionen — nur sichtbar wenn eine E-Mail gesetzt ist.
            Ohne E-Mail koennen wir nichts schicken, also auch nichts anbieten. */}
        {email && (
          <div className="space-y-1.5 border-t border-line-subtle pt-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={sendInvitation}
                onChange={(e) => setSendInvitation(e.target.checked)}
              />
              Einladungs-Mail jetzt verschicken
            </label>
            {sendInvitation && (
              <div className="space-y-1 pl-6">
                <label
                  htmlFor="personalMessage"
                  className="text-xs text-ink-tertiary"
                >
                  Persönliche Nachricht (optional)
                </label>
                <textarea
                  id="personalMessage"
                  value={personalMessage}
                  onChange={(e) => setPersonalMessage(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  className="w-full rounded-md border border-line-subtle px-3 py-2 text-sm"
                  placeholder="z.B. Liebe Anna, lieber Tim — eure Hochzeitsbilder sind da! Viel Freude beim Anschauen."
                />
              </div>
            )}
          </div>
        )}

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
            {pending
              ? "Wird erstellt…"
              : wantsInvitation
                ? "Erstellen & einladen"
                : "Erstellen"}
          </button>
        </div>
      </form>
    </div>
  );
}
