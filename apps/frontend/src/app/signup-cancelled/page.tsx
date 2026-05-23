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

export default function SignupCancelledPage() {
  const router = useRouter();
  return (
    <main className="min-h-screen bg-surface-canvas flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-surface-raised border border-line-subtle rounded-lg p-8 text-center space-y-6">
        <div className="text-6xl">😌</div>
        <div>
          <h1 className="text-display-md text-ink-primary font-medium mb-2">
            Kein Problem
          </h1>
          <p className="text-ui text-ink-secondary">
            Dein Account ist trotzdem angelegt. Du hast 14 Tage Zeit, dich
            zu entscheiden. Karte kannst du jederzeit nachreichen.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Button
            variant="primary"
            onClick={() => router.push("/studio")}
            className="w-full"
          >
            Trial-Zugang ins Studio
          </Button>
          <Button
            variant="ghost"
            onClick={() => router.push("/login")}
            className="w-full"
          >
            Zum Login
          </Button>
        </div>
      </div>
    </main>
  );
}
