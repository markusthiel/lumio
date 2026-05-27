"use client";

/**
 * Super-Admin — Broadcast-Editor
 *
 * Drei-Spalten-Layout:
 *  - Links: Audience-Picker + Felder
 *  - Mitte: Markdown-Editor
 *  - Rechts: Live-Preview als iframe (echtes Mail-HTML)
 *
 * Test-Send-Button schickt die Mail an die eigene Super-Admin-Email
 * bevor man auf 'Senden' drueckt. Empfaenger-Count wird beim Audience-
 * Wechsel nicht live nachgeladen — der echte Count wird beim Anlegen
 * auf der API berechnet und auf der Detail-Page sichtbar.
 *
 * 'Senden'-Button hat einen Zwei-Klick-Confirm — bei Broadcasts ist
 * jeder Versand-Fehler peinlich (geht ja an alle Customer).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { SuperShell } from "@/components/super/SuperShell";

type Audience =
  | "all_paid_owners"
  | "all_trial_owners"
  | "all_owners"
  | "all_active_users";

const AUDIENCE_OPTIONS: Array<{ value: Audience; label: string; help: string }> = [
  {
    value: "all_paid_owners",
    label: "Zahlende Owner",
    help: "Sub-Status active oder past_due.",
  },
  {
    value: "all_trial_owners",
    label: "Trial-Owner",
    help: "Sub-Status trialing — typisch für Onboarding-Nudges.",
  },
  {
    value: "all_owners",
    label: "Alle Owner",
    help: "Paying + Trialing zusammen. Für Produkt-Updates ideal.",
  },
  {
    value: "all_active_users",
    label: "Alle User",
    help: "Auch Members, nicht nur Owner. Bei Features die alle nutzen.",
  },
];

export default function NewBroadcastPage() {
  return (
    <SuperShell>
      <Editor />
    </SuperShell>
  );
}

function Editor() {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [bodyMarkdown, setBodyMarkdown] = useState(
    "Hallo,\n\nkurze Info zu **Lumio**:\n\n- ...\n- ...\n\nViele Grüße,\nMarkus"
  );
  const [audience, setAudience] = useState<Audience>("all_paid_owners");
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [testSendStatus, setTestSendStatus] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [submitState, setSubmitState] = useState<
    "idle" | "confirming" | "submitting"
  >("idle");
  const [error, setError] = useState<string | null>(null);

  // Debounced Live-Preview
  useEffect(() => {
    if (!bodyMarkdown.trim()) {
      setPreviewHtml("");
      return;
    }
    setPreviewLoading(true);
    const id = setTimeout(async () => {
      try {
        const r = await api.superPreviewBroadcast(bodyMarkdown);
        setPreviewHtml(r.html);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Preview-Fehler");
      } finally {
        setPreviewLoading(false);
      }
    }, 400);
    return () => clearTimeout(id);
  }, [bodyMarkdown]);

  async function testSend() {
    if (!subject.trim() || !bodyMarkdown.trim()) return;
    setTestSendStatus("sending");
    try {
      await api.superTestSendBroadcast({
        subject: subject.trim(),
        bodyMarkdown,
      });
      setTestSendStatus("sent");
      setTimeout(() => setTestSendStatus("idle"), 3000);
    } catch {
      setTestSendStatus("error");
      setTimeout(() => setTestSendStatus("idle"), 3000);
    }
  }

  async function submit() {
    if (submitState === "idle") {
      setSubmitState("confirming");
      setTimeout(() => {
        setSubmitState((s) => (s === "confirming" ? "idle" : s));
      }, 5000);
      return;
    }
    if (submitState !== "confirming") return;

    setSubmitState("submitting");
    setError(null);
    try {
      const r = await api.superCreateBroadcast({
        subject: subject.trim(),
        bodyMarkdown,
        audience,
      });
      router.push(`/super/broadcasts/${r.broadcast.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
      setSubmitState("idle");
    }
  }

  const canSubmit = subject.trim().length > 0 && bodyMarkdown.trim().length > 0;

  return (
    <div className="px-4 sm:px-8 py-6 max-w-7xl">
      <div className="mb-4">
        <button
          type="button"
          onClick={() => router.push("/super/broadcasts")}
          className="text-ui-xs text-ink-tertiary hover:text-ink-secondary"
        >
          ← Broadcasts
        </button>
      </div>
      <h1 className="text-2xl font-semibold mb-1">Neuer Broadcast</h1>
      <p className="text-ui-sm text-ink-tertiary mb-6">
        Markdown wird gerendert. Jede Mail enthält automatisch einen
        Abmelde-Link.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-4">
        {/* Linke Spalte: Editor */}
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium block mb-1">
              Empfänger-Gruppe
            </label>
            <div className="space-y-2">
              {AUDIENCE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={
                    "block rounded-md border p-3 cursor-pointer " +
                    (audience === opt.value
                      ? "border-accent bg-accent/5"
                      : "border-line-subtle hover:bg-surface-sunken/40")
                  }
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="audience"
                      checked={audience === opt.value}
                      onChange={() => setAudience(opt.value)}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="text-sm font-medium">{opt.label}</div>
                      <div className="text-xs text-ink-tertiary">{opt.help}</div>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="bc-subject" className="text-sm font-medium block mb-1">
              Betreff
            </label>
            <input
              id="bc-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              placeholder="z.B. Neue Druckpartner-Anbindung verfügbar"
              className="w-full rounded-md border border-line-subtle px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label htmlFor="bc-body" className="text-sm font-medium block mb-1">
              Text (Markdown)
            </label>
            <textarea
              id="bc-body"
              value={bodyMarkdown}
              onChange={(e) => setBodyMarkdown(e.target.value)}
              rows={18}
              maxLength={20000}
              className="w-full rounded-md border border-line-subtle px-3 py-2 text-sm font-mono"
            />
            <div className="text-xs text-ink-tertiary mt-1">
              Markdown: # für Überschriften, **fett**, - für Listen,
              [Text](url) für Links, leere Zeilen = neuer Absatz.
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap pt-3 border-t border-line-subtle">
            <button
              type="button"
              onClick={testSend}
              disabled={!canSubmit || testSendStatus === "sending"}
              className="text-sm px-3 py-2 rounded-md border border-line-subtle hover:bg-surface-sunken disabled:opacity-50"
            >
              {testSendStatus === "sending"
                ? "Test sendet…"
                : testSendStatus === "sent"
                  ? "Test-Mail versendet ✓"
                  : testSendStatus === "error"
                    ? "Test fehlgeschlagen"
                    : "Test-Mail an mich"}
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit || submitState === "submitting"}
              className={
                submitState === "confirming"
                  ? "text-sm px-4 py-2 rounded-md bg-semantic-danger text-white font-medium hover:opacity-90 disabled:opacity-50"
                  : "text-sm px-4 py-2 rounded-md bg-accent text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
              }
            >
              {submitState === "submitting"
                ? "Wird gestartet…"
                : submitState === "confirming"
                  ? "WIRKLICH an alle senden — nochmal klicken"
                  : "An Empfänger senden…"}
            </button>
          </div>
          {error && (
            <div className="text-sm text-semantic-danger">{error}</div>
          )}
        </div>

        {/* Rechte Spalte: Preview */}
        <div className="lg:sticky lg:top-4 self-start">
          <div className="text-sm font-medium mb-1 flex items-center gap-2">
            Live-Preview
            {previewLoading && (
              <span className="text-xs text-ink-tertiary">(lädt…)</span>
            )}
          </div>
          <div className="rounded-md border border-line-subtle bg-white overflow-hidden">
            {previewHtml ? (
              <iframe
                title="Mail-Vorschau"
                srcDoc={previewHtml}
                className="w-full"
                style={{ height: "70vh", border: "none" }}
              />
            ) : (
              <div className="p-6 text-sm text-ink-tertiary">
                Tippe Markdown links — Preview erscheint hier.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
