"use client";

import { useEffect, useState } from "react";
import { api, type GalleryAccess } from "@/lib/api";
import { EmailChipsInput } from "@/components/studio/EmailChipsInput";

export function SharePanel({
  galleryId,
  gallerySlug,
  initialPublicAccess = true,
}: {
  galleryId: string;
  gallerySlug: string;
  initialPublicAccess?: boolean;
}) {
  const [publicAccess, setPublicAccess] = useState(initialPublicAccess);
  const [savingAccessMode, setSavingAccessMode] = useState(false);

  async function toggleAccessMode(next: boolean) {
    setSavingAccessMode(true);
    const prev = publicAccess;
    setPublicAccess(next);
    try {
      await api.updateGallery(galleryId, { publicAccess: next });
    } catch {
      setPublicAccess(prev);
    } finally {
      setSavingAccessMode(false);
    }
  }

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
  // Inline-Bearbeitung des Ablaufdatums eines bestehenden Links.
  const [editingExpiryId, setEditingExpiryId] = useState<string | null>(null);
  const [expiryDraft, setExpiryDraft] = useState("");
  const [savingExpiry, setSavingExpiry] = useState(false);

  /** ISO-UTC-String → datetime-local-Wert ("YYYY-MM-DDTHH:mm") in lokaler
   *  Zeit, damit der native Picker den richtigen Moment anzeigt. */
  function isoToLocalInput(iso: string): string {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
      d.getHours()
    )}:${p(d.getMinutes())}`;
  }

  function startEditExpiry(a: GalleryAccess) {
    setEditingExpiryId(a.id);
    setExpiryDraft(a.expiresAt ? isoToLocalInput(a.expiresAt) : "");
  }

  async function saveExpiry(accessId: string) {
    setSavingExpiry(true);
    try {
      await api.updateAccess(galleryId, accessId, {
        expiresAt: expiryDraft ? new Date(expiryDraft).toISOString() : null,
      });
      setEditingExpiryId(null);
      await load();
    } finally {
      setSavingExpiry(false);
    }
  }

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

  /** Direkt-Versand. Optional Override-Empfänger und Save-as-Default. */
  async function performSendInvitation(
    accessId: string,
    payload: {
      personalMessage?: string;
      recipients?: string[];
      updateDefaults?: boolean;
    }
  ) {
    setInvitingId(accessId);
    try {
      const res = await api.sendAccessInvitation(galleryId, accessId, payload);
      if (res.sent) {
        setInvitedId(accessId);
        setTimeout(() => setInvitedId(null), 2000);
        // Wenn defaults geupdatet wurden, neu laden damit die Card
        // die neuen Adressen zeigt
        if (payload.updateDefaults) void load();
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
    <div className="space-y-4">
      <section className="rounded-lg border border-line-subtle bg-surface-raised p-4 space-y-3">
        <div>
          <h2 className="text-sm font-medium">Zugriff</h2>
          <p className="text-xs text-ink-tertiary mt-0.5">
            Wer diese Galerie öffnen kann.
          </p>
        </div>
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="radio"
            name="accessMode"
            checked={publicAccess}
            disabled={savingAccessMode}
            onChange={() => void toggleAccessMode(true)}
            className="mt-1"
          />
          <span>
            <span className="font-medium">Öffentlich</span>
            <span className="block text-xs text-ink-tertiary">
              Jeder mit dem Galerie-Link kann sie öffnen. Freigabe-Links
              geben Zusatzrechte (Auswahl, Kommentare).
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="radio"
            name="accessMode"
            checked={!publicAccess}
            disabled={savingAccessMode}
            onChange={() => void toggleAccessMode(false)}
            className="mt-1"
          />
          <span>
            <span className="font-medium">Nur über Freigabe-Links</span>
            <span className="block text-xs text-ink-tertiary">
              Nur mit einem gültigen, nicht abgelaufenen Freigabe-Link
              erreichbar. Der reine Galerie-Link und abgelaufene Links
              sind gesperrt.
            </span>
          </span>
        </label>
      </section>

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
            <a
              href={buildShareUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-2 py-1 rounded border border-line-subtle hover:bg-surface-sunken inline-flex items-center gap-1"
              title="In neuem Tab öffnen"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M15 3h6v6" />
                <path d="M10 14 21 3" />
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              </svg>
              Öffnen
            </a>
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
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{a.label}</div>
                      {a.emails.length > 0 && (
                        <div className="text-xs text-ink-tertiary truncate">
                          {a.emails.length === 1
                            ? a.emails[0]
                            : `${a.emails[0]} +${a.emails.length - 1} weitere`}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {a.emails.length > 0 && (
                        <button
                          onClick={() => setInviteFor(a)}
                          disabled={invitingId === a.id}
                          className="text-xs text-accent hover:underline disabled:opacity-50"
                          title="Einladungs-Mail verschicken"
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
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs px-2 py-1 rounded border border-line-subtle hover:bg-surface-sunken inline-flex items-center gap-1"
                      title="In neuem Tab öffnen"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M15 3h6v6" />
                        <path d="M10 14 21 3" />
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      </svg>
                      Öffnen
                    </a>
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
                  <div className="text-[11px] flex items-center gap-2 flex-wrap pt-0.5">
                    {editingExpiryId === a.id ? (
                      <>
                        <input
                          type="datetime-local"
                          value={expiryDraft}
                          onChange={(e) => setExpiryDraft(e.target.value)}
                          className="rounded border border-line-subtle px-2 py-1 text-xs"
                        />
                        <button
                          onClick={() => void saveExpiry(a.id)}
                          disabled={savingExpiry}
                          className="text-accent hover:underline disabled:opacity-50"
                        >
                          {savingExpiry ? "Speichern…" : "Speichern"}
                        </button>
                        {expiryDraft && (
                          <button
                            onClick={() => setExpiryDraft("")}
                            className="text-ink-tertiary hover:text-ink-secondary"
                          >
                            Kein Ablauf
                          </button>
                        )}
                        <button
                          onClick={() => setEditingExpiryId(null)}
                          className="text-ink-tertiary hover:text-ink-secondary"
                        >
                          Abbrechen
                        </button>
                      </>
                    ) : (
                      <>
                        {a.expiresAt ? (
                          new Date(a.expiresAt) < new Date() ? (
                            <span className="text-red-600">
                              Abgelaufen —{" "}
                              {new Date(a.expiresAt).toLocaleString("de-DE", {
                                dateStyle: "medium",
                                timeStyle: "short",
                              })}
                            </span>
                          ) : (
                            <span className="text-ink-tertiary">
                              Läuft ab:{" "}
                              {new Date(a.expiresAt).toLocaleString("de-DE", {
                                dateStyle: "medium",
                                timeStyle: "short",
                              })}
                            </span>
                          )
                        ) : (
                          <span className="text-ink-tertiary">Kein Ablauf</span>
                        )}
                        <button
                          onClick={() => startEditExpiry(a)}
                          className="text-accent hover:underline"
                        >
                          {a.expiresAt ? "Ändern" : "Ablauf setzen"}
                        </button>
                      </>
                    )}
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
          onSend={(payload) => {
            const id = inviteFor.id;
            setInviteFor(null);
            void performSendInvitation(id, payload);
          }}
        />
      )}
    </section>
    </div>
  );
}

/**
 * Versand-Modal. Standardmaessig sind die hinterlegten Empfaenger
 * vorausgefuellt; der Studio-User kann anpassen (mehr/weniger
 * Adressen) und optional als neuen Default speichern.
 */
function InviteDialog({
  access,
  onClose,
  onSend,
}: {
  access: GalleryAccess;
  onClose: () => void;
  onSend: (payload: {
    personalMessage?: string;
    recipients?: string[];
    updateDefaults?: boolean;
  }) => void;
}) {
  const [recipients, setRecipients] = useState<string[]>(access.emails);
  const [message, setMessage] = useState("");
  /** Hat der User die hinterlegten Adressen veraendert? Nur dann
   *  macht der Save-as-Default-Switch Sinn. */
  const changed =
    recipients.length !== access.emails.length ||
    recipients.some((e, i) => e !== access.emails[i]);
  const [saveAsDefault, setSaveAsDefault] = useState(false);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (recipients.length === 0) return;
    onSend({
      personalMessage: message || undefined,
      // recipients nur mitschicken wenn geaendert — sonst nutzt Backend
      // die hinterlegten Defaults
      recipients: changed ? recipients : undefined,
      updateDefaults: changed && saveAsDefault,
    });
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
          </p>
        </div>

        <div className="space-y-1">
          <label htmlFor="invite-emails" className="text-sm font-medium">
            E-Mail-Adressen
          </label>
          <EmailChipsInput
            id="invite-emails"
            value={recipients}
            onChange={setRecipients}
            placeholder="Adresse eintippen + Enter"
          />
          <p className="text-xs text-ink-tertiary">
            Pro Adresse wird eine eigene Mail versendet.
          </p>
        </div>

        {changed && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={saveAsDefault}
              onChange={(e) => setSaveAsDefault(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Geänderte Liste als Standard speichern
              <span className="block text-xs text-ink-tertiary">
                Bei der nächsten „Einladung senden" werden diese Adressen
                automatisch vorgeschlagen.
              </span>
            </span>
          </label>
        )}

        <div className="space-y-1">
          <label htmlFor="invite-msg" className="text-sm font-medium">
            Persönliche Nachricht{" "}
            <span className="text-ink-tertiary">(optional)</span>
          </label>
          <textarea
            id="invite-msg"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            maxLength={1000}
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
            disabled={recipients.length === 0}
            className="text-sm px-3 py-2 rounded-md bg-accent text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
          >
            {recipients.length === 1
              ? "Einladung verschicken"
              : `An ${recipients.length} Adressen schicken`}
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
  const [emails, setEmails] = useState<string[]>([]);
  const [canDownload, setCanDownload] = useState(true);
  const [canComment, setCanComment] = useState(true);
  const [canSelect, setCanSelect] = useState(true);
  const [canSeeOthers, setCanSeeOthers] = useState(false);
  /** Ablauf des Links als datetime-local-Wert ("2026-07-15T14:30"),
   *  leer = kein Ablauf. */
  const [expiresAt, setExpiresAt] = useState("");
  /** Wenn keine Adressen drin: Option unwirksam, wird nicht angezeigt. */
  const [sendInvitation, setSendInvitation] = useState(true);
  const [personalMessage, setPersonalMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wantsInvitation = emails.length > 0 && sendInvitation;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api.createAccess(galleryId, {
        label,
        emails: emails.length > 0 ? emails : undefined,
        canDownload,
        canComment,
        canSelect,
        canSeeOthers,
        expiresAt: expiresAt
          ? new Date(expiresAt).toISOString()
          : undefined,
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
      className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[100]"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
        className="w-full max-w-md bg-surface-raised border border-line-subtle shadow-2xl rounded-lg p-6 space-y-4"
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
          <label htmlFor="emails" className="text-sm font-medium">
            E-Mail-Adressen{" "}
            <span className="text-ink-tertiary">(optional)</span>
          </label>
          <EmailChipsInput
            id="emails"
            value={emails}
            onChange={setEmails}
            placeholder="Adresse + Enter — mehrere möglich"
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

        <div className="space-y-1">
          <label htmlFor="expiresAt" className="text-sm font-medium">
            Läuft ab <span className="text-ink-tertiary">(optional)</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              id="expiresAt"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="flex-1 rounded-md border border-line-subtle px-3 py-2 text-sm"
            />
            {expiresAt && (
              <button
                type="button"
                onClick={() => setExpiresAt("")}
                className="text-xs text-ink-tertiary hover:text-ink-secondary px-2"
              >
                Zurücksetzen
              </button>
            )}
          </div>
          <p className="text-xs text-ink-tertiary">
            Nach diesem Zeitpunkt kann der Kunde die Galerie nicht mehr
            öffnen. Leer = kein Ablauf.
          </p>
        </div>

        {/* Einladungs-Optionen — nur sichtbar wenn mindestens eine Adresse
            angegeben ist. */}
        {emails.length > 0 && (
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
