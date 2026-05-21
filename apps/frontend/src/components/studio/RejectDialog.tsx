"use client";

/**
 * Lumio Studio — Reject-Dialog
 *
 * Modal zum Ablehnen von Upload-Link-Uploads. Wird sowohl für Per-File-
 * Reject als auch für Bulk-Reject verwendet (mit gemeinsamem Grund).
 *
 * UX: vordefinierte Presets als Buttons (in 90 % der Fälle reicht das)
 * plus Freitext-Feld für Edge-Cases. Klick auf ein Preset füllt das
 * Freitext-Feld vor — User kann anpassen oder direkt absenden.
 *
 * Reason ist im API optional (kann null sein), aber wir validieren
 * hier auch nicht stärker; der User entscheidet ob er was schreibt.
 */
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useT } from "@/lib/i18n";

interface Props {
  /** Anzahl Files die abgelehnt werden — beeinflusst den Header-Text
   *  ("File ablehnen" vs "3 Files ablehnen"). */
  count: number;
  onCancel: () => void;
  onConfirm: (reason: string | null) => void | Promise<void>;
}

export function RejectDialog({ count, onCancel, onConfirm }: Props) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  // Preset-Optionen — i18n-Keys, das User-facing Label kommt aus den
  // Translations. Die geschickten Werte (das was als reason ans Backend
  // geht) sind die übersetzten Strings, damit der Audit-Log lesbar
  // bleibt ohne dass das Frontend irgendwo eine Lookup-Tabelle pflegen
  // muss.
  const presets = [
    t("studio.uploadLinks.rejectPresetBlurry"),
    t("studio.uploadLinks.rejectPresetInappropriate"),
    t("studio.uploadLinks.rejectPresetDuplicate"),
    t("studio.uploadLinks.rejectPresetOther"),
  ];

  async function submit() {
    setBusy(true);
    try {
      // Leerer Text → null (Backend speichert nichts, statt "")
      const finalReason = reason.trim() === "" ? null : reason.trim();
      await onConfirm(finalReason);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-surface-canvas border border-line-subtle rounded-lg p-5 max-w-md w-full space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-ui-md font-medium text-ink-primary">
            {count === 1
              ? t("studio.uploadLinks.rejectDialogHeadingSingle")
              : t("studio.uploadLinks.rejectDialogHeadingBulk", { count })}
          </h3>
          <p className="text-ui-sm text-ink-tertiary mt-1">
            {t("studio.uploadLinks.rejectDialogHint")}
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setReason(preset)}
              className="text-ui-xs px-2.5 h-7 rounded border border-line-subtle text-ink-secondary hover:border-line-strong hover:bg-surface-sunken transition-colors duration-motion"
            >
              {preset}
            </button>
          ))}
        </div>

        <label className="block">
          <span className="text-ui-sm text-ink-secondary">
            {t("studio.uploadLinks.rejectReasonField")}
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 500))}
            placeholder={t("studio.uploadLinks.rejectReasonPlaceholder")}
            rows={3}
            className="w-full mt-1 bg-surface-canvas border border-line-subtle rounded px-3 py-2 text-ui text-ink-primary placeholder:text-ink-tertiary focus:outline-none focus:border-accent transition-colors duration-motion resize-none"
            autoFocus
          />
          <div className="text-ui-xs text-ink-tertiary mt-0.5 text-right">
            {reason.length}/500
          </div>
        </label>

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" onClick={submit} disabled={busy}>
            {busy
              ? t("studio.uploadLinks.rejecting")
              : count === 1
              ? t("studio.uploadLinks.rejectConfirmSingle")
              : t("studio.uploadLinks.rejectConfirmBulk", { count })}
          </Button>
        </div>
      </div>
    </div>
  );
}
