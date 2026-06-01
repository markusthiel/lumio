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

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";

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
  const t = useT();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  // useRef-Guard: useEffect kann durch React-StrictMode (dev) oder durch
  // Re-Renders mit neuer useSearchParams-Referenz mehrfach feuern. Da
  // der Token one-shot ist, wuerde der zweite Lauf einen 'Token
  // ungueltig'-Fehler-Flash produzieren — sichtbar als kurze rote
  // Meldung bevor der location.replace greift. Mit dieser Sperre laeuft
  // der echte Redeem garantiert nur einmal pro Component-Mount.
  const didRunRef = useRef(false);

  useEffect(() => {
    if (didRunRef.current) return;
    didRunRef.current = true;

    const token = params.get("t");
    if (!token) {
      setError(t("impersonate.noToken"));
      return;
    }

    (async () => {
      try {
        // 1. Token gegen Session eintauschen — setzt den Session-Cookie
        //    auf dieser Tenant-Subdomain
        await api.redeemImpersonateToken(token);

        // 2. Verifizieren dass die Session WIRKLICH steht. Wenn der
        //    Cookie aus irgendeinem Grund nicht akzeptiert wurde
        //    (z.B. Browser-Privacy-Setting), sehen wir das HIER und
        //    nicht erst auf einer Folge-Page als 'plötzlich auf Login
        //    geworfen'. me() schickt den frisch gesetzten Cookie mit
        //    (credentials: 'include').
        const meResult = await api.me();
        if (!meResult.impersonation) {
          throw new Error(
            t("impersonate.errCookie")
          );
        }

        // 3. Harter Redirect zu /studio. router.replace würde Next.js-
        //    client-side-Navigation machen — / macht server-side einen
        //    unbedingten redirect zu /login (siehe app/page.tsx). Wir
        //    gehen direkt zu /studio, das ist die Studio-Startseite
        //    (StudioShell mit Session-Check). location.replace
        //    ersetzt zusaetzlich den History-Entry, sodass der Token
        //    nicht in der Browser-Back-History bleibt — eigener
        //    history.replaceState entfaellt damit.
        window.location.replace("/studio");
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : t("impersonate.errToken")
        );
      }
    })();
  }, [params]);

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
