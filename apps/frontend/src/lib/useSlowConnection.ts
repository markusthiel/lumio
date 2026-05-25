"use client";

import { useEffect, useState } from "react";

/**
 * Liefert ein 3-Tuple [slow, source, setOverride]:
 *   slow:     true wenn der Upload den Slow-Modus nutzen sollte
 *             (= 1 paralleles File, 1 paralleler Part statt 4/4).
 *   source:   wie der Wert zustande kam — 'auto' (Browser-Hint),
 *             'override' (User-Toggle), oder 'default' (kein Hint,
 *             nicht gesetzt → false).
 *   setOverride: setzt einen manuellen Override (true/false) oder
 *                clearen mit null (zurueck auf Auto-Detect).
 *
 * Quellen in dieser Prioritaet:
 *   1. localStorage 'lumio_upload_slow' = 'true'|'false'  → manueller Override
 *   2. navigator.connection.effectiveType (slow-2g/2g/3g) → 'auto'
 *   3. navigator.connection.saveData = true              → 'auto'
 *   4. sonst                                              → false
 *
 * Warum nicht direkt auf navigator schauen jedes Mal: SSR-Sicherheit
 * (navigator existiert nicht in Node), und State sorgt fuer Re-Render
 * wenn der User den Override toggle. localStorage haben wir auch als
 * String, weil `false` als JSON-Boolean true-wertig waere ('false' !== '').
 */
const LS_KEY = "lumio_upload_slow";

interface ConnectionLike {
  effectiveType?: string;
  saveData?: boolean;
  addEventListener?: (
    type: string,
    listener: EventListenerOrEventListenerObject
  ) => void;
  removeEventListener?: (
    type: string,
    listener: EventListenerOrEventListenerObject
  ) => void;
}

function readOverride(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(LS_KEY);
    if (v === "true") return true;
    if (v === "false") return false;
  } catch {
    /* localStorage kann disabled sein (private mode, quota) */
  }
  return null;
}

function getConnection(): ConnectionLike | null {
  if (typeof navigator === "undefined") return null;
  // navigator.connection ist nicht im TypeScript-DOM-Type drin, weil
  // experimentell. Wir casten defensiv.
  const conn = (navigator as Navigator & { connection?: ConnectionLike })
    .connection;
  return conn ?? null;
}

function detectAuto(): boolean {
  const conn = getConnection();
  if (!conn) return false;
  if (conn.saveData) return true;
  const et = conn.effectiveType;
  if (et === "slow-2g" || et === "2g" || et === "3g") return true;
  return false;
}

export function useSlowConnection(): {
  slow: boolean;
  source: "auto" | "override" | "default";
  setOverride: (value: boolean | null) => void;
} {
  // Server-Render und initial Client-Render muessen das gleiche
  // Resultat liefern, sonst meckert React ueber Hydration-Mismatch.
  // Wir starten daher mit 'default' und korrigieren in einem Effect.
  const [override, setOverrideState] = useState<boolean | null>(null);
  const [auto, setAuto] = useState(false);

  useEffect(() => {
    setOverrideState(readOverride());
    setAuto(detectAuto());

    // Wenn der Browser einen connection.change-Event sendet, neu
    // auswerten. Praktisch heisst das: User wechselt von WLAN zu LTE,
    // wir schalten Auto-Slow ein ohne dass der Page-Reload noetig ist.
    const conn = getConnection();
    if (!conn || !conn.addEventListener) return;
    const handler = () => setAuto(detectAuto());
    conn.addEventListener("change", handler);
    return () => {
      conn.removeEventListener?.("change", handler);
    };
  }, []);

  const setOverride = (value: boolean | null) => {
    if (typeof window !== "undefined") {
      try {
        if (value === null) {
          window.localStorage.removeItem(LS_KEY);
        } else {
          window.localStorage.setItem(LS_KEY, value ? "true" : "false");
        }
      } catch {
        /* noop */
      }
    }
    setOverrideState(value);
  };

  const slow = override !== null ? override : auto;
  const source: "auto" | "override" | "default" =
    override !== null ? "override" : auto ? "auto" : "default";

  return { slow, source, setOverride };
}
