"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Speichert eine ad-hoc-Auswahl von File-IDs pro Galerie im localStorage.
 *
 * Warum localStorage und nicht Server-seitig:
 *   Likes/Picks im Collaboration-Mode sind "Photograph-Feedback" und gehören
 *   in die DB (der Photograph soll sie im Studio sehen). Picks im Warenkorb-
 *   Modus sind ephemere Customer-Wahl ("ich will diese 5 runterladen") und
 *   müssen nicht persistent in der Galerie sichtbar sein. localStorage hält
 *   die Auswahl über Reloads hinweg, ist aber pro Browser/Profil isoliert
 *   und stört keine Photograph-Auswertung.
 *
 * Key-Schema: lumio.pickedFiles.<gallerySlug>
 * Wert: JSON-Array von File-IDs.
 *
 * Max-Cap: 500 IDs (analog zum Server-Limit). Wenn mehr geadded werden,
 * verwerfen wir den Add — der Customer hat eh keinen vernünftigen Use-Case
 * für 500+ Picks.
 *
 * Stale-File-Cleanup: passiert nicht hier (wir wissen ja nicht ob ein File
 * noch in der Galerie ist). Der Server filtert beim ZIP-Build die ungültigen
 * raus und liefert nur die echten zurück; das Frontend könnte dann seine
 * lokale Liste bereinigen, aber das ist Sprint-2.
 */

const MAX_PICKS = 500;

function storageKey(slug: string): string {
  return `lumio.pickedFiles.${slug}`;
}

function loadInitial(slug: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(storageKey(slug));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((x): x is string => typeof x === "string").slice(0, MAX_PICKS)
    );
  } catch {
    return new Set();
  }
}

export interface PickStore {
  picked: Set<string>;
  has: (fileId: string) => boolean;
  toggle: (fileId: string) => void;
  add: (fileIds: string[]) => void;
  remove: (fileId: string) => void;
  clear: () => void;
  size: number;
  /** Sortierte Liste (für deterministisches dedup-Hashing beim Server) */
  asArray: () => string[];
}

export function usePickedFiles(slug: string): PickStore {
  const [picked, setPicked] = useState<Set<string>>(() => loadInitial(slug));

  // localStorage-Persistierung — bei jeder Set-Änderung schreiben.
  // Sehr klein (<5 KB selbst bei 500 IDs), kein Throttling nötig.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const arr = Array.from(picked);
      if (arr.length === 0) {
        window.localStorage.removeItem(storageKey(slug));
      } else {
        window.localStorage.setItem(storageKey(slug), JSON.stringify(arr));
      }
    } catch {
      // Quota voll oder localStorage disabled — ignorieren, Picks bleiben
      // in-memory für die Session.
    }
  }, [picked, slug]);

  const has = useCallback(
    (fileId: string) => picked.has(fileId),
    [picked]
  );

  const toggle = useCallback((fileId: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        if (next.size >= MAX_PICKS) return prev; // ignorieren wenn voll
        next.add(fileId);
      }
      return next;
    });
  }, []);

  const add = useCallback((fileIds: string[]) => {
    setPicked((prev) => {
      const next = new Set(prev);
      for (const id of fileIds) {
        if (next.size >= MAX_PICKS) break;
        next.add(id);
      }
      return next;
    });
  }, []);

  const remove = useCallback((fileId: string) => {
    setPicked((prev) => {
      if (!prev.has(fileId)) return prev;
      const next = new Set(prev);
      next.delete(fileId);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setPicked(new Set());
  }, []);

  const asArray = useCallback(
    () => Array.from(picked).sort(),
    [picked]
  );

  return {
    picked,
    has,
    toggle,
    add,
    remove,
    clear,
    size: picked.size,
    asArray,
  };
}
