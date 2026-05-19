/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{ts,tsx,js,jsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Wird zur Laufzeit über CSS-Vars pro Tenant überschrieben (Whitelabel)
        brand: {
          primary: "rgb(var(--brand-primary) / <alpha-value>)",
          accent: "rgb(var(--brand-accent) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
