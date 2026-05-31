"use client";

/**
 * Kleine UI-Toggle fuer den Slow-Connection-Modus. Liegt unten an
 * der Drop-Zone (Studio + Upload-Link). Visuell zurueckhaltend —
 * der durchschnittliche User braucht das nicht, aber wenn jemand
 * ueber LTE im Ausland uploaded soll er das hier finden.
 *
 * UX:
 *  - Off (auto/default + slow=false): kleines Link-Style "Langsam?"
 *    in der Ecke, klickbar zum Override-Aktivieren.
 *  - Auto-erkannt (slow=true, source=auto): kleiner Hinweis
 *    "Langsame Verbindung erkannt", X-Button zum Abschalten.
 *  - Manuell aktiviert (override=true): "Langsame Verbindung aktiv",
 *    X-Button zum Aufheben.
 */
import { useSlowConnection } from "@/lib/useSlowConnection";
import { useT } from "@/lib/i18n";

export function SlowConnectionToggle() {
  const t = useT();
  const { slow, source, setOverride } = useSlowConnection();

  if (!slow) {
    return (
      <button
        type="button"
        onClick={() => setOverride(true)}
        className="text-ui-xs text-ink-tertiary hover:text-ink-secondary underline-offset-2 hover:underline transition-colors duration-motion"
        title={t("slowConn.titleEnable")}
      >
        {t("slowConn.trigger")}
      </button>
    );
  }

  // slow === true: entweder auto oder manuell
  const label =
    source === "auto"
      ? t("slowConn.detectedAuto")
      : t("slowConn.activeManual");

  return (
    <div className="flex items-center gap-2 text-ui-xs text-ink-secondary">
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M2 12h12M5 9h6M7 6h2M8 3v0" />
      </svg>
      <span>{label}</span>
      <button
        type="button"
        onClick={() => setOverride(source === "auto" ? false : null)}
        className="text-ui-xs text-ink-tertiary hover:text-ink-primary underline-offset-2 hover:underline transition-colors duration-motion"
        title={
          source === "auto"
            ? t("slowConn.titleForceFast")
            : t("slowConn.titleResetAuto")
        }
      >
        {source === "auto" ? t("slowConn.forceFast") : t("common.reset")}
      </button>
    </div>
  );
}
