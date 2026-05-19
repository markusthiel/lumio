import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n";
import { MotionBoot } from "@/components/MotionBoot";

// Inter via next/font.
// Wir variieren auf einer einzigen Variable --font-inter; tailwind.config.mjs
// fängt das per fontFamily.sans wieder ein.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Lumio",
  description: "Self-hosted photo & video sharing for photographers",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // lang="en" als SSR-Default; I18nProvider switcht clientseitig.
  // data-motion="subtle" als sicherer SSR-Default — MotionBoot setzt
  // beim Mount auf den persistierten User-Wert um. So vermeiden wir
  // Hydration-Mismatch.
  return (
    <html lang="en" className={inter.variable} data-motion="subtle">
      <body>
        <MotionBoot />
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
