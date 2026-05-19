"use client";

/**
 * Lumio Motion — User-Setting für Animations-Niveau.
 *
 * Drei Stufen:
 *   off    — keine Animationen, jeder Reveal sofort sichtbar
 *   subtle — kleine Distanzen, kurze Easings (Default)
 *   full   — größere Distanzen, längere Easings
 *
 * Override: `prefers-reduced-motion: reduce` aus den System-Settings wird
 * IMMER respektiert und überschreibt die User-Einstellung effektiv auf "off"
 * (das passiert via CSS-Media-Query in globals.css). Der hier gespeicherte
 * Wert wird aber NICHT verändert — wenn der User auf seinem Phone reduce
 * an hat aber am Desktop nicht, sieht er am Desktop wieder Animationen.
 *
 * Persistenz: localStorage. Server hat keinen Bedarf an dem Wert; ein
 * Cookie-basierter Sync zur API-Side ist nicht notwendig.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type MotionLevel = "off" | "subtle" | "full";

const STORAGE_KEY = "lumio_motion";
const DEFAULT: MotionLevel = "subtle";

interface MotionContextValue {
  motion: MotionLevel;
  setMotion: (m: MotionLevel) => void;
}

const MotionContext = createContext<MotionContextValue>({
  motion: DEFAULT,
  setMotion: () => {},
});

function readStored(): MotionLevel {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "off" || v === "subtle" || v === "full") return v;
  } catch {
    /* private mode / SSR */
  }
  return DEFAULT;
}

function apply(level: MotionLevel): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-motion", level);
}

/**
 * Direkt im RootLayout gerendert. Liest den persistierten Wert beim Mount
 * und applied ihn auf <html data-motion="...">. Bewusst KEIN Provider —
 * der Wert wird beim Mount einmal gesetzt und danach via useMotion()
 * gelesen/geschrieben. Wir vermeiden Provider hier, damit der Boot
 * niemals einen extra Render auslöst.
 */
export function MotionBoot() {
  useEffect(() => {
    apply(readStored());
  }, []);
  return null;
}

/**
 * Provider-Variante für Settings-Seiten, die den Wert wechseln können
 * sollen. Wird NICHT global im RootLayout gemountet — nur dort, wo
 * jemand `useMotion()` braucht, also typischerweise in der Settings-Page.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  const [motion, setMotionState] = useState<MotionLevel>(DEFAULT);

  // Beim ersten Mount aus dem Storage übernehmen
  useEffect(() => {
    setMotionState(readStored());
  }, []);

  const setMotion = useCallback((m: MotionLevel) => {
    setMotionState(m);
    try {
      window.localStorage.setItem(STORAGE_KEY, m);
    } catch {
      /* ignore */
    }
    apply(m);
  }, []);

  return (
    <MotionContext.Provider value={{ motion, setMotion }}>
      {children}
    </MotionContext.Provider>
  );
}

export function useMotion(): MotionContextValue {
  return useContext(MotionContext);
}
