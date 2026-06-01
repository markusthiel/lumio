"use client";

import { MotionProvider, useMotion, type MotionLevel } from "@/components/MotionBoot";
import { useT } from "@/lib/i18n";

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
    label: "motion.off",
    description: "motion.offDesc",
  },
  {
    value: "subtle",
    label: "motion.subtle",
    description: "motion.subtleDesc",
  },
  {
    value: "full",
    label: "motion.full",
    description: "motion.fullDesc",
  },
];

function MotionSectionInner() {
  const t = useT();
  const { motion, setMotion } = useMotion();

  return (
    <section className="rounded-md bg-surface-raised border border-line-subtle p-5 space-y-4">
      <div>
        <h2 className="text-ui-md font-medium text-ink-primary">{t("motion.heading")}</h2>
        <p className="text-ui-sm text-ink-tertiary mt-0.5">{t("motion.hint")}</p>
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
              <div className="text-ui font-medium text-ink-primary">{t(opt.label)}</div>
              <div className="text-ui-xs text-ink-tertiary mt-1">{t(opt.description)}</div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
