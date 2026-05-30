"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Member = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  alwaysHasAccess: boolean;
  isCreator: boolean;
  shared: boolean;
};

/**
 * Team-Zugriff einer Galerie verwalten (granulare Freigabe).
 * Listet alle aktiven Team-Mitglieder; Ersteller und Studio-Inhaber haben
 * immer Zugriff (nicht abwählbar), alle anderen können freigegeben werden.
 */
export function GalleryShareSection({ galleryId }: { galleryId: string }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .galleryCollaborators(galleryId)
      .then((r) => {
        if (alive) setMembers(r.members);
      })
      .catch(() => {
        if (alive) setError("Freigaben konnten nicht geladen werden.");
      });
    return () => {
      alive = false;
    };
  }, [galleryId]);

  async function toggle(m: Member) {
    if (m.alwaysHasAccess || busy) return;
    const next = !m.shared;
    setBusy(m.id);
    setError(null);
    setMembers(
      (cur) =>
        cur?.map((x) => (x.id === m.id ? { ...x, shared: next } : x)) ?? cur
    );
    try {
      if (next) await api.shareGallery(galleryId, m.id);
      else await api.unshareGallery(galleryId, m.id);
    } catch {
      setMembers(
        (cur) =>
          cur?.map((x) => (x.id === m.id ? { ...x, shared: !next } : x)) ?? cur
      );
      setError("Änderung fehlgeschlagen.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium text-ink-primary">Team-Zugriff</div>
        <p className="text-xs text-ink-tertiary mt-0.5">
          Wer diese Galerie sehen und bearbeiten darf. Freigegebene Mitglieder
          haben volle Rechte.
        </p>
      </div>
      {error && <div className="text-xs text-semantic-danger">{error}</div>}
      {members === null ? (
        <div className="text-xs text-ink-tertiary">Lädt …</div>
      ) : members.length <= 1 ? (
        <div className="text-xs text-ink-tertiary">
          Noch keine weiteren Team-Mitglieder. Lade unter Einstellungen → Team
          Kolleg:innen ein.
        </div>
      ) : (
        <ul className="divide-y divide-line-subtle rounded-md border border-line-subtle overflow-hidden">
          {members.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="text-sm text-ink-primary truncate">
                  {m.name || m.email}
                </div>
                <div className="text-xs text-ink-tertiary truncate">
                  {m.email}
                </div>
              </div>
              {m.alwaysHasAccess ? (
                <span className="text-xs text-ink-tertiary whitespace-nowrap">
                  {m.isCreator ? "Ersteller" : "Inhaber"} · Zugriff
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => toggle(m)}
                  disabled={busy === m.id}
                  className={`text-xs px-2.5 py-1 rounded-md border transition-colors disabled:opacity-50 whitespace-nowrap ${
                    m.shared
                      ? "border-accent bg-accent/10 text-ink-primary"
                      : "border-line-subtle text-ink-secondary hover:border-line-strong"
                  }`}
                >
                  {m.shared ? "Freigegeben" : "Freigeben"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
