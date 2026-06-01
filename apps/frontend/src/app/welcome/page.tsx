"use client";

/**
 * Lumio Studio — Welcome-Page nach erfolgreichem Stripe-Checkout
 *
 * Stripe redirected hierher mit ?session_id=cs_test_... Wir tun zwei
 * Dinge parallel:
 *   1. Auto-Login via api.checkoutLogin(sessionId) — Backend validiert
 *      die Session bei Stripe, prüft Tenant-Konsistenz, stellt Session-
 *      Cookie aus. Wenn das klappt, ist der User nahtlos eingeloggt
 *      (kein Re-Login auf studio.lumio-cloud.de nach Cross-Domain-
 *      Signup).
 *   2. 3-Sek-Countdown bis Redirect zu /studio. Falls Auto-Login
 *      scheitert, landet der User auf der Login-Page und kann sich
 *      manuell anmelden — Daten sind ja in der DB.
 *
 * Subscription wird vom Webhook-Worker im Hintergrund angelegt — sollte
 * spätestens bis zum Studio-Visit fertig sein.
 *
 * Next.js 16 verlangt useSearchParams() unter einer Suspense-Boundary
 * für Prerender-Fähigkeit.
 */
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui";
import { useT } from "@/lib/i18n";

function WelcomeContent() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params.get("session_id");
  const [countdown, setCountdown] = useState(3);
  // Auto-Login-State: 'pending' = noch nicht versucht, 'ok' = klappt,
  // 'fail' = Backend wollte nicht. Bei fail leiten wir trotzdem zu
  // /studio um — die Login-Page sieht halt den User-Wunsch und macht
  // ihre Sache. Wir loggen die Fail-Reason in der Konsole.
  const [autoLogin, setAutoLogin] = useState<"pending" | "ok" | "fail">(
    "pending"
  );

  // Auto-Login beim Mount triggern. Wenn keine session_id da ist
  // (Direkt-Aufruf der /welcome-Page), skippen wir das.
  useEffect(() => {
    if (!sessionId) {
      setAutoLogin("fail");
      return;
    }
    let cancelled = false;
    api
      .checkoutLogin(sessionId)
      .then(() => {
        if (!cancelled) setAutoLogin("ok");
      })
      .catch((err) => {
        if (!cancelled) {
          // Stiller Fail — User merkt es spätestens am Login-Screen
          console.warn("checkout-login failed", err);
          setAutoLogin("fail");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

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
          {t("welcome.title")}
        </h1>
        <p className="text-ui text-ink-secondary">
          {t("welcome.trialInfo")}
        </p>
      </div>
      <div className="text-ui-sm text-ink-tertiary">
        {autoLogin === "pending" && (
          <div className="text-ui-xs opacity-60 mb-1">{t("welcome.loggingIn")}</div>
        )}
        {t("welcome.redirecting", { n: countdown })}
      </div>
      <Button
        variant="primary"
        onClick={() => router.push("/studio")}
        className="w-full"
      >
        {t("welcome.toStudio")}
      </Button>
    </div>
  );
}

function WelcomeFallback() {
  const t = useT();
  return (
    <div className="max-w-md w-full bg-surface-raised border border-line-subtle rounded-lg p-8 text-center space-y-6">
      <div className="text-6xl">🎉</div>
      <div>
        <h1 className="text-display-md text-ink-primary font-medium mb-2">
          {t("welcome.title")}
        </h1>
        <p className="text-ui text-ink-secondary">{t("welcome.loading")}</p>
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
