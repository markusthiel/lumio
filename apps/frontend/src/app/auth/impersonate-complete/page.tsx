"use client";

/**
 * Lumio Studio — Impersonate-Complete
 *
 * Diese Page wird durch den Impersonate-Flow auf der Tenant-Subdomain
 * aufgerufen (z.B. https://saro.lumio-cloud.de/auth/impersonate-complete?t=...).
 * Sie ruft den Redeem-Endpoint auf, der den Intent-Token gegen eine
 * Session eintauscht und den Session-Cookie auf der aktuellen Domain
 * setzt. Danach redirect zu /.
 *
 * Wird KEINEN normalen User je sehen — der Token wird nur vom Super-
 * Admin via /super/tenants/.../impersonate vergeben.
 */

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";

export default function ImpersonateCompletePage() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = params.get("t");
    if (!token) {
      setError("Kein Token im Link.");
      return;
    }

    (async () => {
      try {
        await api.redeemImpersonateToken(token);
        // URL aufraeumen damit der Token nicht in der Browser-History
        // bleibt. Dann zur Studio-Startseite.
        if (typeof window !== "undefined") {
          window.history.replaceState({}, "", "/");
        }
        router.replace("/");
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Token ungültig oder abgelaufen. Bitte erneut vom Super-Admin starten."
        );
      }
    })();
  }, [params, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-canvas">
      <div className="max-w-md w-full mx-4 rounded-lg border border-line-subtle bg-surface-raised p-6 text-center">
        {error ? (
          <>
            <h1 className="text-lg font-semibold text-semantic-danger mb-2">
              Impersonate fehlgeschlagen
            </h1>
            <p className="text-sm text-ink-secondary mb-4">{error}</p>
            <a
              href="/"
              className="text-sm text-accent hover:underline"
            >
              Zurück zur Startseite
            </a>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold mb-2">Support-Login</h1>
            <p className="text-sm text-ink-tertiary">
              Session wird angelegt…
            </p>
          </>
        )}
      </div>
    </div>
  );
}
