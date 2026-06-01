"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/**
 * Dezente Versions-Zeile (z.B. "Lumio v0.9.0") für den Studio-Footer.
 *
 * Die Version kommt aus dem öffentlichen /meta-Endpoint der API und
 * entspricht damit der laufenden Produkt-Version der Instanz. Nützlich
 * für Self-Hoster und Support: man sieht auf einen Blick, worauf die
 * Instanz läuft.
 *
 * Rendert nichts, solange /meta noch nicht geladen ist.
 */
export function AppVersion({ className = "" }: { className?: string }) {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .getAppMeta()
      .then((m) => {
        if (active) setVersion(m.version ?? null);
      })
      .catch(() => {
        /* still: Zeile bleibt einfach leer */
      });
    return () => {
      active = false;
    };
  }, []);

  if (!version) return null;

  return (
    <p className={`text-[11px] text-ink-tertiary/70 select-none ${className}`}>
      Lumio v{version}
    </p>
  );
}
