"use client";

/**
 * Super-Admin — Broadcasts-Uebersicht
 *
 * Liste aller versendeten / pending / failed Broadcasts mit Status,
 * Counts und Versanddatum. '+ Neuer Broadcast' fuehrt zum Editor.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { SuperShell } from "@/components/super/SuperShell";

type Response = Awaited<ReturnType<typeof api.superListBroadcasts>>;

export default function SuperBroadcastsPage() {
  return (
    <SuperShell>
      <BroadcastsContent />
    </SuperShell>
  );
}

function BroadcastsContent() {
  const router = useRouter();
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Polling damit der Status von 'sending' live aktualisiert wird
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await api.superListBroadcasts();
        if (!cancelled) setData(r);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Fehler");
      }
    }
    void load();
    const id = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="px-8 py-6 max-w-5xl">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Broadcasts</h1>
          <p className="text-ui-sm text-ink-tertiary">
            Versand-Mails an alle Tenant-Owner. Feature-Ankündigungen,
            Wartungs-Hinweise, AGB-Updates.
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push("/super/broadcasts/new")}
          className="text-sm px-3 py-2 rounded-md bg-accent text-accent-contrast hover:bg-accent-hover"
        >
          + Neuer Broadcast
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-semantic-danger/30 bg-semantic-danger/8 px-3 py-2 mb-4 text-sm text-semantic-danger">
          {error}
        </div>
      )}

      {!data ? (
        <div className="text-sm text-ink-tertiary">Lädt…</div>
      ) : data.broadcasts.length === 0 ? (
        <div className="border border-line-subtle rounded-md bg-surface-raised p-8 text-center">
          <p className="text-sm text-ink-tertiary mb-3">
            Noch keine Broadcasts.
          </p>
          <Link
            href="/super/broadcasts/new"
            className="text-sm text-accent hover:underline"
          >
            Ersten Broadcast erstellen →
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {data.broadcasts.map((b) => (
            <BroadcastRow
              key={b.id}
              b={b}
              audienceLabel={data.audienceLabels[b.audience] ?? b.audience}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BroadcastRow({
  b,
  audienceLabel,
}: {
  b: Response["broadcasts"][number];
  audienceLabel: string;
}) {
  const progress =
    b.totalRecipients > 0
      ? Math.floor(
          ((b.sentCount + b.failedCount + b.optedOutSkippedCount) /
            b.totalRecipients) *
            100
        )
      : 0;

  return (
    <Link
      href={`/super/broadcasts/${b.id}`}
      className="block rounded-md border border-line-subtle bg-surface-raised hover:bg-surface-sunken/40 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <StatusBadge status={b.status} />
            <strong className="text-sm">{b.subject}</strong>
          </div>
          <div className="text-xs text-ink-tertiary">
            {audienceLabel} · {b.totalRecipients}{" "}
            {b.totalRecipients === 1 ? "Empfänger" : "Empfänger"}
            {" · "}
            {new Date(b.createdAt).toLocaleString("de-DE", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
            {" · "}von {b.createdByEmail}
          </div>
        </div>
        <div className="text-right shrink-0">
          {b.status === "sending" && (
            <div className="text-xs text-ink-tertiary">{progress}%</div>
          )}
          {(b.status === "finished" ||
            b.status === "sending" ||
            b.status === "failed") && (
            <div className="text-xs">
              <span className="text-semantic-success">
                {b.sentCount.toLocaleString("de-DE")} gesendet
              </span>
              {b.failedCount > 0 && (
                <>
                  {" · "}
                  <span className="text-semantic-danger">
                    {b.failedCount} fehler
                  </span>
                </>
              )}
              {b.optedOutSkippedCount > 0 && (
                <>
                  {" · "}
                  <span className="text-ink-tertiary">
                    {b.optedOutSkippedCount} opt-out
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      {b.status === "sending" && (
        <div className="mt-2 h-1 bg-surface-sunken rounded overflow-hidden">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </Link>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = (() => {
    switch (status) {
      case "finished":
        return "bg-semantic-success/15 text-semantic-success";
      case "sending":
        return "bg-accent/15 text-accent";
      case "pending":
        return "bg-surface-sunken text-ink-tertiary";
      case "failed":
        return "bg-semantic-danger/15 text-semantic-danger";
      case "cancelled":
        return "bg-surface-sunken text-ink-tertiary";
      default:
        return "bg-surface-sunken text-ink-secondary";
    }
  })();
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-mono ${tone}`}
    >
      {status}
    </span>
  );
}
