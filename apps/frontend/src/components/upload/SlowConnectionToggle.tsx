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

export function SlowConnectionToggle() {
  const { slow, source, setOverride } = useSlowConnection();

  if (!slow) {
    return (
      <button
        type="button"
        onClick={() => setOverride(true)}
        className="text-ui-xs text-ink-tertiary hover:text-ink-secondary underline-offset-2 hover:underline transition-colors duration-motion"
        title="Reduziert die Anzahl paralleler Uploads für langsame Verbindungen (z.B. mobiles Netz)."
      >
        Langsame Verbindung?
      </button>
    );
  }

  // slow === true: entweder auto oder manuell
  const label =
    source === "auto"
      ? "Langsame Verbindung erkannt — Uploads laufen seriell."
      : "Langsame Verbindung aktiv — Uploads laufen seriell.";

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
            ? "Auto-Erkennung überschreiben und schnelle Uploads erzwingen"
            : "Auf Auto-Erkennung zurücksetzen"
        }
      >
        {source === "auto" ? "Schnell trotzdem" : "Zurücksetzen"}
      </button>
    </div>
  );
}
