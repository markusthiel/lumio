"use client";

import { MotionProvider, useMotion, type MotionLevel } from "@/components/MotionBoot";

/**
 * Settings-Sektion zum Wählen des Animations-Niveaus.
 *
 * Wir wickeln die Innen-Komponente in einen MotionProvider ein — der
 * RootLayout startet den Wert via MotionBoot (one-shot), aber für
 * interaktives Wechseln in der Settings-UI brauchen wir den Provider mit
 * State.
 */
export function MotionSection() {
  return (
    <MotionProvider>
      <MotionSectionInner />
    </MotionProvider>
  );
}

const OPTIONS: { value: MotionLevel; label: string; description: string }[] = [
  {
    value: "off",
    label: "Aus",
    description: "Keine Animationen. Inhalte erscheinen sofort.",
  },
  {
    value: "subtle",
    label: "Subtil",
    description: "Kurze Fades und kleine Bewegungen. Empfohlen.",
  },
  {
    value: "full",
    label: "Spürbar",
    description: "Längere Übergänge, deutlichere Reveals beim Scrollen.",
  },
];

function MotionSectionInner() {
  const { motion, setMotion } = useMotion();

  return (
    <section className="rounded-md bg-surface-raised border border-line-subtle p-5 space-y-4">
      <div>
        <h2 className="text-ui-md font-medium text-ink-primary">Animationen</h2>
        <p className="text-ui-sm text-ink-tertiary mt-0.5">
          Wie schwungvoll sich das Interface anfühlt. Wer in den
          System-Einstellungen „Bewegung reduzieren" aktiviert hat, sieht
          unabhängig von dieser Wahl keine Animationen.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {OPTIONS.map((opt) => {
          const active = motion === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setMotion(opt.value)}
              className={`text-left p-3 rounded border transition-colors duration-motion ease-out ${
                active
                  ? "border-accent bg-accent/10"
                  : "border-line-subtle hover:border-line-strong bg-surface-sunken"
              }`}
              aria-pressed={active}
            >
              <div className="text-ui font-medium text-ink-primary">{opt.label}</div>
              <div className="text-ui-xs text-ink-tertiary mt-1">{opt.description}</div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
