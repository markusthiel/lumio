"use client";

/**
 * AutoTagsSection
 *
 * Selbst-versteckende Komponente: zeigt KI-Auto-Tag-Vorschlaege fuer
 * ein File mit Accept/Reject-Buttons. Versteckt sich kommentarlos
 * wenn das Feature 'ai_tagging' fuer den Tenant nicht aktiv ist
 * (API liefert dann 404).
 *
 * Vorschlaege werden gruppiert nach Status angezeigt:
 *   - suggested: noch nicht reviewed, mit Confidence-Bar + Accept/Reject
 *   - accepted: ausgegraut, kleiner ✓ — Information dass der Tag schon
 *               als echter Tag uebernommen ist
 *   - rejected: optional ausgeblendet — der Vorschlag wird nicht
 *               nochmal angezeigt, aber wenn der User es manuell sehen
 *               will, koennen wir das einblenden (V1: weglassen)
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type AutoTag = {
  id: string;
  tagName: string;
  confidence: number;
  source: string;
  status: "suggested" | "accepted" | "rejected";
  reviewedAt: string | null;
  label: string;
  group: string | null;
  color: string;
};

export function AutoTagsSection({ fileId }: { fileId: string }) {
  const [tags, setTags] = useState<AutoTag[] | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.getFileAutoTags(fileId);
        if (!cancelled) {
          setTags(r.autoTags);
          setAvailable(true);
        }
      } catch {
        if (!cancelled) setAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  async function onAccept(autoTagId: string) {
    setBusyId(autoTagId);
    try {
      await api.acceptAutoTag(fileId, autoTagId);
      // Optimistic: lokal patchen
      setTags((prev) =>
        prev
          ? prev.map((t) =>
              t.id === autoTagId
                ? { ...t, status: "accepted", reviewedAt: new Date().toISOString() }
                : t
            )
          : prev
      );
    } catch (err) {
      console.error("acceptAutoTag failed:", err);
    } finally {
      setBusyId(null);
    }
  }

  async function onReject(autoTagId: string) {
    setBusyId(autoTagId);
    try {
      await api.rejectAutoTag(fileId, autoTagId);
      setTags((prev) =>
        prev
          ? prev.map((t) =>
              t.id === autoTagId
                ? { ...t, status: "rejected", reviewedAt: new Date().toISOString() }
                : t
            )
          : prev
      );
    } catch (err) {
      console.error("rejectAutoTag failed:", err);
    } finally {
      setBusyId(null);
    }
  }

  if (!available) return null;
  if (!tags || tags.length === 0) return null;

  // Filter: rejected ausblenden, suggested + accepted zeigen.
  const visible = tags.filter((t) => t.status !== "rejected");
  if (visible.length === 0) return null;

  const suggested = visible.filter((t) => t.status === "suggested");
  const accepted = visible.filter((t) => t.status === "accepted");

  return (
    <div className="border-b border-line-subtle">
      <div className="px-4 py-3 text-ui-sm font-medium text-ink-primary flex items-center gap-2">
        <span>KI-Tag-Vorschläge</span>
        {suggested.length > 0 && (
          <span className="text-ui-xs text-ink-tertiary font-normal">
            ({suggested.length} unreviewt)
          </span>
        )}
      </div>

      <div className="px-4 pb-4 space-y-2">
        {suggested.map((t) => (
          <div
            key={t.id}
            className="rounded border border-line-subtle bg-surface-sunken p-2"
          >
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: t.color }}
                />
                <span className="text-sm truncate">{t.label}</span>
                <span className="text-xs text-ink-tertiary tabular-nums shrink-0">
                  {Math.round(t.confidence * 100)}%
                </span>
              </div>
            </div>
            {/* Confidence-Bar */}
            <div className="h-1 rounded bg-surface-raised overflow-hidden mb-2">
              <div
                className="h-full"
                style={{
                  width: `${Math.round(t.confidence * 100)}%`,
                  backgroundColor: t.color,
                }}
              />
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => onAccept(t.id)}
                disabled={busyId === t.id}
                className="flex-1 px-2 py-1 text-xs rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-50"
              >
                Übernehmen
              </button>
              <button
                type="button"
                onClick={() => onReject(t.id)}
                disabled={busyId === t.id}
                className="flex-1 px-2 py-1 text-xs rounded bg-surface-raised border border-line-subtle text-ink-secondary hover:bg-surface-sunken disabled:opacity-50"
              >
                Verwerfen
              </button>
            </div>
          </div>
        ))}

        {accepted.length > 0 && (
          <div className="pt-2">
            <div className="text-ui-xs uppercase tracking-[0.12em] text-ink-tertiary mb-1.5">
              Übernommen
            </div>
            <div className="flex flex-wrap gap-1.5">
              {accepted.map((t) => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded"
                  style={{
                    backgroundColor: `${t.color}20`,
                    color: t.color,
                  }}
                >
                  <span>✓</span>
                  <span>{t.label}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
