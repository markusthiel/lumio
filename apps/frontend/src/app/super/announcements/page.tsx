"use client";

/**
 * Super-Admin — System-Announcement-Verwaltung
 *
 * Erlaubt das Anlegen, Editieren und Loeschen von Bannern die in jedem
 * Studio-Shell angezeigt werden. Use-Cases: Wartungsfenster ankuendigen,
 * Outage-Hinweise, neue Features promoten.
 *
 * Severity-Optionen:
 *  - info: blauer Akzent, hintergrund hell
 *  - warning: gelb/orange, schwarze Schrift
 *  - critical: rot, weiße Schrift, NICHT dismiss-bar
 *
 * Zeitfenster: activeFrom (null = jetzt) bis activeUntil (null = unbefristet).
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { SuperShell } from "@/components/super/SuperShell";

type Announcement = Awaited<
  ReturnType<typeof api.superListAnnouncements>
>["announcements"][number];

export default function SuperAnnouncementsPage() {
  return (
    <SuperShell>
      <AnnouncementsContent />
    </SuperShell>
  );
}

function AnnouncementsContent() {
  const [rows, setRows] = useState<Announcement[] | null>(null);
  const [editing, setEditing] = useState<
    | { kind: "new" }
    | { kind: "edit"; row: Announcement }
    | null
  >(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const r = await api.superListAnnouncements();
      setRows(r.announcements);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function deleteRow(id: string) {
    if (confirmingDeleteId !== id) {
      setConfirmingDeleteId(id);
      setTimeout(() => {
        setConfirmingDeleteId((c) => (c === id ? null : c));
      }, 4000);
      return;
    }
    setConfirmingDeleteId(null);
    try {
      await api.superDeleteAnnouncement(id);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    }
  }

  return (
    <div className="px-8 py-6 max-w-4xl">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold mb-1">System-Banner</h1>
          <p className="text-ui-sm text-ink-tertiary">
            Sichtbar in jedem Studio im Header. Für Wartungsfenster,
            Status-Hinweise, Feature-Ankündigungen.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing({ kind: "new" })}
          className="text-sm px-3 py-2 rounded-md bg-accent text-accent-contrast hover:bg-accent-hover"
        >
          + Neues Banner
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-semantic-danger/30 bg-semantic-danger/8 px-3 py-2 mb-4 text-sm text-semantic-danger">
          {error}
        </div>
      )}

      {!rows ? (
        <div className="text-sm text-ink-tertiary">Lädt…</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-ink-tertiary italic">
          Noch keine Banner angelegt.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <AnnouncementRowItem
              key={r.id}
              row={r}
              onEdit={() => setEditing({ kind: "edit", row: r })}
              onDelete={() => deleteRow(r.id)}
              confirmingDelete={confirmingDeleteId === r.id}
            />
          ))}
        </div>
      )}

      {editing && (
        <AnnouncementDialog
          initial={editing.kind === "edit" ? editing.row : null}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function AnnouncementRowItem({
  row,
  onEdit,
  onDelete,
  confirmingDelete,
}: {
  row: Announcement;
  onEdit: () => void;
  onDelete: () => void;
  confirmingDelete: boolean;
}) {
  const now = Date.now();
  const isActive =
    (!row.activeFrom || new Date(row.activeFrom).getTime() <= now) &&
    (!row.activeUntil || new Date(row.activeUntil).getTime() > now);

  const sevClasses = (() => {
    switch (row.severity) {
      case "critical":
        return "bg-semantic-danger text-white";
      case "warning":
        return "bg-semantic-warning text-black";
      default:
        return "bg-accent/15 text-ink-primary";
    }
  })();

  return (
    <div
      className={`rounded-md border ${isActive ? "border-line-strong" : "border-line-subtle opacity-60"} bg-surface-raised p-4`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`text-xs px-2 py-0.5 rounded font-mono ${sevClasses}`}>
              {row.severity}
            </span>
            {!isActive && (
              <span className="text-xs px-2 py-0.5 rounded bg-surface-sunken text-ink-tertiary">
                inaktiv
              </span>
            )}
            {!row.dismissible && (
              <span className="text-xs text-ink-tertiary">
                · nicht ausblendbar
              </span>
            )}
            <strong className="text-sm">{row.title}</strong>
          </div>
          <div className="text-sm text-ink-secondary whitespace-pre-wrap mb-2">
            {row.body}
          </div>
          <div className="text-xs text-ink-tertiary">
            {row.activeFrom
              ? `ab ${new Date(row.activeFrom).toLocaleString("de-DE")}`
              : "sofort aktiv"}
            {row.activeUntil
              ? ` bis ${new Date(row.activeUntil).toLocaleString("de-DE")}`
              : " · unbefristet"}
            {" · "}von {row.createdByEmail}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={onEdit}
            className="text-xs px-2 py-1 rounded border border-line-subtle hover:bg-surface-sunken"
          >
            Bearbeiten
          </button>
          <button
            type="button"
            onClick={onDelete}
            className={
              confirmingDelete
                ? "text-xs px-2 py-1 rounded border border-semantic-danger text-semantic-danger font-medium"
                : "text-xs px-2 py-1 rounded border border-line-subtle text-ink-secondary hover:text-semantic-danger hover:bg-surface-sunken"
            }
          >
            {confirmingDelete ? "Sicher?" : "Löschen"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AnnouncementDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: Announcement | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [severity, setSeverity] = useState<"info" | "warning" | "critical">(
    (initial?.severity as "info" | "warning" | "critical" | undefined) ?? "info"
  );
  const [activeFrom, setActiveFrom] = useState(
    initial?.activeFrom ? toLocalDatetime(initial.activeFrom) : ""
  );
  const [activeUntil, setActiveUntil] = useState(
    initial?.activeUntil ? toLocalDatetime(initial.activeUntil) : ""
  );
  const [dismissible, setDismissible] = useState(initial?.dismissible ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const payload = {
      title: title.trim(),
      body: body.trim(),
      severity,
      activeFrom: activeFrom ? new Date(activeFrom).toISOString() : null,
      activeUntil: activeUntil ? new Date(activeUntil).toISOString() : null,
      dismissible,
    };
    try {
      if (initial) {
        await api.superUpdateAnnouncement(initial.id, payload);
      } else {
        await api.superCreateAnnouncement(payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[100]"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-lg bg-surface-raised border border-line-subtle shadow-2xl rounded-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <h2 className="text-lg font-semibold">
          {initial ? "Banner bearbeiten" : "Neues Banner"}
        </h2>

        <div>
          <label className="text-sm font-medium block mb-1">Titel</label>
          <input
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-line-subtle px-3 py-2 text-sm"
            placeholder="z.B. Geplante Wartung am Sonntag"
          />
        </div>

        <div>
          <label className="text-sm font-medium block mb-1">Text</label>
          <textarea
            required
            maxLength={2000}
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full rounded-md border border-line-subtle px-3 py-2 text-sm"
            placeholder="Details — was passiert, wann genau, was muss der User tun?"
          />
        </div>

        <div>
          <label className="text-sm font-medium block mb-1">Schweregrad</label>
          <div className="grid grid-cols-3 gap-2">
            {(["info", "warning", "critical"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSeverity(s)}
                className={
                  severity === s
                    ? "text-sm px-3 py-2 rounded border-2 border-accent bg-accent/10"
                    : "text-sm px-3 py-2 rounded border border-line-subtle hover:bg-surface-sunken"
                }
              >
                {s === "info" ? "Info" : s === "warning" ? "Warnung" : "Kritisch"}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium block mb-1">
              Aktiv ab <span className="text-ink-tertiary">(optional)</span>
            </label>
            <input
              type="datetime-local"
              value={activeFrom}
              onChange={(e) => setActiveFrom(e.target.value)}
              className="w-full rounded-md border border-line-subtle px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">
              Aktiv bis <span className="text-ink-tertiary">(optional)</span>
            </label>
            <input
              type="datetime-local"
              value={activeUntil}
              onChange={(e) => setActiveUntil(e.target.value)}
              className="w-full rounded-md border border-line-subtle px-3 py-2 text-sm"
            />
          </div>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={dismissible}
            onChange={(e) => setDismissible(e.target.checked)}
            className="mt-0.5"
            disabled={severity === "critical"}
          />
          <span>
            User kann den Banner wegklicken
            <span className="block text-xs text-ink-tertiary">
              {severity === "critical"
                ? "Critical-Banner sind nie wegklickbar."
                : "Wegklick wird im localStorage pro Browser gemerkt."}
            </span>
          </span>
        </label>

        {error && (
          <div className="text-sm text-semantic-danger">{error}</div>
        )}

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
            disabled={submitting || !title.trim() || !body.trim()}
            className="text-sm px-3 py-2 rounded-md bg-accent text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
          >
            {submitting ? "Speichert…" : initial ? "Aktualisieren" : "Anlegen"}
          </button>
        </div>
      </form>
    </div>
  );
}

/** ISO-String zu yyyy-MM-ddTHH:mm fuer datetime-local input. */
function toLocalDatetime(iso: string): string {
  const d = new Date(iso);
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
}
