"use client";

/**
 * Lumio Studio — Signup-Cancelled-Page
 *
 * User hat den Stripe-Checkout abgebrochen. Wichtig: der Tenant + User
 * sind trotzdem in der DB angelegt (vom POST /signup). Read-only-Modus
 * greift erst nach 14 Tagen. Heißt: User kann sich einfach einloggen
 * und entscheiden, ob er später ein Abo will.
 */
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { useT } from "@/lib/i18n";

export default function SignupCancelledPage() {
  const t = useT();
  const router = useRouter();
  return (
    <main className="min-h-screen bg-surface-canvas flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-surface-raised border border-line-subtle rounded-lg p-8 text-center space-y-6">
        <div className="text-6xl">😌</div>
        <div>
          <h1 className="text-display-md text-ink-primary font-medium mb-2">
            {t("signupCancelled.title")}
          </h1>
          <p className="text-ui text-ink-secondary">
            {t("signupCancelled.body")}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Button
            variant="primary"
            onClick={() => router.push("/studio")}
            className="w-full"
          >
            {t("signupCancelled.trialAccess")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => router.push("/login")}
            className="w-full"
          >
            {t("signupCancelled.toLogin")}
          </Button>
        </div>
      </div>
    </main>
  );
}
