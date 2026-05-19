import type { Metadata } from "next";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Lumio",
  description: "Self-hosted photo & video sharing for photographers",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // lang="en" als sichere SSR-Default; der I18nProvider switcht clientseitig.
  // Das lang-Attribut absichtlich NICHT aus dem dynamischen Locale-State
  // ableiten, um Hydration-Mismatch zu vermeiden.
  return (
    <html lang="en">
      <body>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
