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

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";

// useSearchParams() erzwingt eine Client-Side-Render-Boundary. Ohne diese
// Direktive versucht Next.js die Page beim Production-Build statisch
// vorzurendern, was scheitert weil die Query-Parameter zur Build-Zeit
// nicht existieren ('Error occurred prerendering page
// /auth/impersonate-complete').
export const dynamic = "force-dynamic";

export default function ImpersonateCompletePage() {
  // Suspense-Boundary ist Pflicht fuer useSearchParams unter Next.js 14+
  // im App-Router. Der Fallback ist trivial, weil die Inner-Komponente
  // beim Mount sofort eigenes State-Rendering uebernimmt.
  return (
    <Suspense fallback={<LoadingShell />}>
      <Inner />
    </Suspense>
  );
}

function LoadingShell() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-canvas">
      <div className="max-w-md w-full mx-4 rounded-lg border border-line-subtle bg-surface-raised p-6 text-center">
        <h1 className="text-lg font-semibold mb-2">Support-Login</h1>
        <p className="text-sm text-ink-tertiary">Session wird angelegt…</p>
      </div>
    </div>
  );
}

function Inner() {
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
            <a href="/" className="text-sm text-accent hover:underline">
              Zurück zur Startseite
            </a>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold mb-2">Support-Login</h1>
            <p className="text-sm text-ink-tertiary">Session wird angelegt…</p>
          </>
        )}
      </div>
    </div>
  );
}
