"use client";

/**
 * Lumio Studio — Welcome-Page nach erfolgreichem Stripe-Checkout
 *
 * Stripe redirected hierher mit ?session_id=cs_test_... Wir zeigen
 * eine kurze Bestätigung + Button zum Studio. Die Subscription wird
 * vom Webhook-Worker im Hintergrund angelegt — wir warten kurz und
 * machen dann den Übergang.
 *
 * Next.js 16 verlangt useSearchParams() unter einer Suspense-Boundary
 * für Prerender-Fähigkeit. Wir trennen den params-lesenden Teil von
 * der äußeren Hülle und wrappen mit <Suspense>.
 */
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui";

function WelcomeContent() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params.get("session_id");
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    if (countdown <= 0) {
      router.push("/studio");
      return;
    }
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, router]);

  return (
    <div className="max-w-md w-full bg-surface-raised border border-line-subtle rounded-lg p-8 text-center space-y-6">
      <div className="text-6xl">🎉</div>
      <div>
        <h1 className="text-display-md text-ink-primary font-medium mb-2">
          Willkommen bei Lumio!
        </h1>
        <p className="text-ui text-ink-secondary">
          Dein Trial läuft 14 Tage. Erste Belastung erst danach.
        </p>
      </div>
      <div className="text-ui-sm text-ink-tertiary">
        {sessionId && (
          <div className="mb-2 font-mono text-ui-xs break-all opacity-60">
            {sessionId}
          </div>
        )}
        Du wirst in {countdown} Sekunden ins Studio weitergeleitet…
      </div>
      <Button
        variant="primary"
        onClick={() => router.push("/studio")}
        className="w-full"
      >
        Jetzt ins Studio
      </Button>
    </div>
  );
}

/** Fallback während die useSearchParams-Komponente noch nicht hydriert
 *  ist. Statischer Inhalt ohne client-side state — Next prerendert das. */
function WelcomeFallback() {
  return (
    <div className="max-w-md w-full bg-surface-raised border border-line-subtle rounded-lg p-8 text-center space-y-6">
      <div className="text-6xl">🎉</div>
      <div>
        <h1 className="text-display-md text-ink-primary font-medium mb-2">
          Willkommen bei Lumio!
        </h1>
        <p className="text-ui text-ink-secondary">
          Wird geladen…
        </p>
      </div>
    </div>
  );
}

export default function WelcomePage() {
  return (
    <main className="min-h-screen bg-surface-canvas flex items-center justify-center p-6">
      <Suspense fallback={<WelcomeFallback />}>
        <WelcomeContent />
      </Suspense>
    </main>
  );
}
