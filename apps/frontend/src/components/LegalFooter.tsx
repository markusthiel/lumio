"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/**
 * Dezente Footer-Zeile mit den rechtlichen Links des Betreibers
 * (Impressum / Datenschutz). Die URLs kommen aus der Instanz-Config
 * (ENV LUMIO_LEGAL_IMPRINT_URL / LUMIO_LEGAL_PRIVACY_URL) über den
 * öffentlichen /meta-Endpoint.
 *
 * Sind keine URLs gesetzt (z.B. frische Self-Host-Instanz), rendert die
 * Komponente nichts — so wird kein toter Link angezeigt.
 */
export function LegalFooter({
  className = "",
  align = "center",
}: {
  className?: string;
  align?: "center" | "start";
}) {
  const [legal, setLegal] = useState<{
    imprintUrl: string | null;
    privacyUrl: string | null;
  } | null>(null);

  useEffect(() => {
    let active = true;
    api
      .getAppMeta()
      .then((m) => {
        if (active) setLegal(m.legal);
      })
      .catch(() => {
        /* still: Footer bleibt einfach leer */
      });
    return () => {
      active = false;
    };
  }, []);

  if (!legal || (!legal.imprintUrl && !legal.privacyUrl)) return null;

  return (
    <footer
      className={`flex items-center ${
        align === "start" ? "justify-start" : "justify-center"
      } gap-3 text-xs text-ink-secondary ${className}`}
    >
      {legal.imprintUrl && (
        <a
          href={legal.imprintUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-ink-primary hover:underline"
        >
          Impressum
        </a>
      )}
      {legal.imprintUrl && legal.privacyUrl && <span aria-hidden>·</span>}
      {legal.privacyUrl && (
        <a
          href={legal.privacyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-ink-primary hover:underline"
        >
          Datenschutz
        </a>
      )}
    </footer>
  );
}
