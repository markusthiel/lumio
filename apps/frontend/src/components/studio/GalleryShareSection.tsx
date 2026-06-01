"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";

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
 * Eigenständige Card auf der Galerie-Detailseite: Team-Zugriff (granulare
 * Freigabe). Listet alle aktiven Team-Mitglieder; Ersteller und Studio-
 * Inhaber haben immer Zugriff (nicht abwählbar), alle anderen können pro
 * Galerie freigegeben werden. Freigegebene erhalten volle Rechte.
 */
export function GalleryShareSection({ galleryId }: { galleryId: string }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
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
        if (alive) setError(t("galleryShare.loadFailed"));
      });
    return () => {
      alive = false;
    };
  }, [galleryId]);

  const sharedCount = members?.filter((m) => m.shared).length ?? 0;

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
      setError(t("galleryShare.changeFailed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-md border border-line-subtle bg-surface-raised overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((s) => !s)}
        className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-surface-overlay/40 transition-colors duration-motion"
      >
        <div>
          <h2 className="text-ui-md font-medium text-ink-primary">
            {t("galleryShare.teamAccess")}
          </h2>
          <p className="text-ui-xs text-ink-tertiary mt-0.5">
            {t("galleryShare.whoCanSee")}
            {sharedCount > 0 ? t("galleryShare.sharedCount", { n: sharedCount }) : ""}
          </p>
        </div>
        <span
          className={`text-ink-tertiary text-ui-sm transition-transform duration-motion ${
            expanded ? "rotate-90" : ""
          }`}
        >
          ▶
        </span>
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-3">
          <p className="text-xs text-ink-tertiary">
            {t("galleryShare.fullRightsDesc")}
          </p>
          {error && (
            <div className="text-xs text-semantic-danger">{error}</div>
          )}
          {members === null ? (
            <div className="text-xs text-ink-tertiary">{t("common.loading")}</div>
          ) : members.length <= 1 ? (
            <div className="text-xs text-ink-tertiary">
              {t("galleryShare.noMembers")}
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
                      {m.isCreator ? t("galleryShare.roleCreatorAccess") : t("galleryShare.roleOwnerAccess")}
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
                      {m.shared ? t("galleryShare.shared") : t("galleryShare.share")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
