/** @type {import('tailwindcss').Config} */
//
// Lumio Design-System — Token-Tailwind-Config
//
// Alle Werte hängen an CSS-Custom-Properties, damit (a) das Tenant-Branding
// dieselben Slots zur Laufzeit überschreiben kann und (b) Light-/Dark-Modi
// und Animation-Niveau ohne Class-Toggle-Krampf umschaltbar sind.
//
// Token-Familien:
//   surface-*   → Hintergründe in Tiefe (canvas/raised/sunken/overlay)
//   ink-*       → Textfarben (primary/secondary/tertiary/inverted)
//   line-*      → Linien-Farben (subtle/strong/focus)
//   accent-*    → Marken-/Aktionsfarbe (Studio-Default = Amber)
//   semantic-*  → Status (success/warning/danger/info)
import typography from "@tailwindcss/typography";

export default {
  content: ["./src/**/*.{ts,tsx,js,jsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Bestehende Brand-Slots bleiben (Whitelabel via globals.css)
        brand: {
          primary: "rgb(var(--brand-primary) / <alpha-value>)",
          accent: "rgb(var(--brand-accent) / <alpha-value>)",
          "accent-contrast":
            "rgb(var(--brand-accent-contrast) / <alpha-value>)",
        },
        surface: {
          // `base` = Alias auf die Canvas-Fläche. Wird historisch an vielen
          // Stellen (Modal-Panels, Inputs, Full-Page-Backgrounds, invertierte
          // Texte) verwendet; ohne diese Definition erzeugte Tailwind keine
          // Regel → Panels wurden transparent.
          base: "rgb(var(--surface-canvas) / <alpha-value>)",
          canvas: "rgb(var(--surface-canvas) / <alpha-value>)",
          raised: "rgb(var(--surface-raised) / <alpha-value>)",
          sunken: "rgb(var(--surface-sunken) / <alpha-value>)",
          overlay: "rgb(var(--surface-overlay) / <alpha-value>)",
        },
        ink: {
          primary: "rgb(var(--ink-primary) / <alpha-value>)",
          secondary: "rgb(var(--ink-secondary) / <alpha-value>)",
          tertiary: "rgb(var(--ink-tertiary) / <alpha-value>)",
          inverted: "rgb(var(--ink-inverted) / <alpha-value>)",
        },
        line: {
          subtle: "rgb(var(--line-subtle) / <alpha-value>)",
          strong: "rgb(var(--line-strong) / <alpha-value>)",
          focus: "rgb(var(--line-focus) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          hover: "rgb(var(--accent-hover) / <alpha-value>)",
          subtle: "rgb(var(--accent-subtle) / <alpha-value>)",
          contrast: "rgb(var(--accent-contrast) / <alpha-value>)",
        },
        semantic: {
          success: "rgb(var(--semantic-success) / <alpha-value>)",
          warning: "rgb(var(--semantic-warning) / <alpha-value>)",
          danger: "rgb(var(--semantic-danger) / <alpha-value>)",
          info: "rgb(var(--semantic-info) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        "ui-xs": ["11px", { lineHeight: "16px", letterSpacing: "0.01em" }],
        "ui-sm": ["12px", { lineHeight: "16px" }],
        "ui": ["13px", { lineHeight: "18px" }],
        "ui-md": ["14px", { lineHeight: "20px" }],
        "ui-lg": ["16px", { lineHeight: "22px" }],
        "display-sm": ["20px", { lineHeight: "26px", letterSpacing: "-0.01em" }],
        "display": ["24px", { lineHeight: "30px", letterSpacing: "-0.015em" }],
        "display-lg": ["32px", { lineHeight: "38px", letterSpacing: "-0.02em" }],
        "display-xl": ["48px", { lineHeight: "54px", letterSpacing: "-0.025em" }],
      },
      borderRadius: {
        xs: "3px",
        sm: "5px",
        DEFAULT: "8px",
        md: "10px",
        lg: "14px",
        xl: "20px",
      },
      boxShadow: {
        "elev-1": "0 1px 0 0 rgb(0 0 0 / 0.3), 0 1px 3px rgb(0 0 0 / 0.2)",
        "elev-2": "0 4px 8px rgb(0 0 0 / 0.25), 0 1px 3px rgb(0 0 0 / 0.2)",
        "elev-3": "0 12px 24px rgb(0 0 0 / 0.35), 0 4px 8px rgb(0 0 0 / 0.25)",
        "focus": "0 0 0 2px rgb(var(--surface-canvas)), 0 0 0 4px rgb(var(--line-focus))",
      },
      transitionTimingFunction: {
        "out": "cubic-bezier(0.16, 1, 0.3, 1)",
        "inout": "cubic-bezier(0.4, 0, 0.2, 1)",
      },
      transitionDuration: {
        // `duration-motion` greift auf die CSS-Variable zurück, die je nach
        // User-Setting unterschiedlich groß ist (oder 0).
        motion: "var(--motion-duration, 200ms)",
      },
      animation: {
        "reveal": "lumio-reveal var(--motion-reveal, 280ms) var(--motion-ease, cubic-bezier(0.16, 1, 0.3, 1)) both",
        "fade-in": "lumio-fade var(--motion-duration, 200ms) ease-out both",
      },
      keyframes: {
        "lumio-reveal": {
          "0%": {
            opacity: "0",
            transform: "translateY(var(--motion-reveal-y, 6px))",
          },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "lumio-fade": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
    },
  },
  plugins: [
    // @tailwindcss/typography für die `prose`-Klassen im Welcome-Markdown
    // des Customer-Hero. Wir nutzen prose-invert (dunkler Hero) und
    // beschränken auf prose-sm/prose-base in der Hero-Komponente
    // selbst.
    typography,
  ],
};
