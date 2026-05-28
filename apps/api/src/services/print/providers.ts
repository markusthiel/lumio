/**
 * Lumio API — Print-Provider-Registry
 *
 * Zentrale Code-Definition aller von Lumio unterstuetzten Print-
 * Anbieter. Neue Provider hier registrieren, dann Adapter unter
 * services/print/adapters/<key>.ts implementieren.
 *
 * Ein Eintrag bedeutet NICHT dass der Provider aktiv ist — das
 * entscheidet der Super-Admin via SuperAdminPrintProviderConfig.
 * Default ist alles aus.
 *
 * Pattern: alle externen Labs starten als 'beta' oder 'planned' mit
 * NotImplementedAdapter. Wenn die API-Integration fertig ist, ersetzen
 * wir den Adapter und schalten den Provider im Super-Admin scharf.
 *
 * 'manual_self_print' ist immer voll funktional und braucht keine
 * Super-Admin-Aktivierung — Self-Print ist als Modus ohnehin Pflicht
 * fuer jedes Tenant das den Print-Shop nutzt.
 */
import { ManualSelfPrintAdapter } from "./adapters/manual-self-print.js";
import {
  NotImplementedAdapter,
  type PrintAdapter,
} from "./adapters/base.js";

export type PrintProviderStage =
  | "production" // voll integriert, im Live-Einsatz
  | "beta" // API funktioniert, noch nicht freigegeben fuer alle
  | "planned" // Stub, Implementierung steht noch aus
  | "self_print"; // Sonderfall manual_self_print

export type CredentialFieldKind = "text" | "password" | "email" | "url";

export interface CredentialField {
  key: string;
  label: string;
  kind: CredentialFieldKind;
  /** Erklaerung im UI ("Den Key findest du im WhiteWall-Dashboard unter ...") */
  helpText?: string;
  required: boolean;
}

export interface PrintProviderDef {
  key: string;
  /** Anzeigename im UI (Studio + Super-Admin) */
  label: string;
  /** Eine-Zeile-Beschreibung fuer Auswahl-UI */
  tagline: string;
  /** Land / Markt-Fokus, kommagetrennt: 'DE', 'EU', 'US' */
  market: string;
  /** Website fuer Anmeldung/Account-Erstellung */
  websiteUrl: string;
  /** Hilfe-URL fuer API-Key-Setup (kann auf Lumio-Docs zeigen) */
  apiKeyHelpUrl?: string;
  stage: PrintProviderStage;

  /** Welche Produkt-Kategorien bietet das Lab schwerpunktmaessig? */
  categories: Array<
    "print" | "canvas" | "photobook" | "frame" | "metal_print" | "poster"
  >;

  /** Welche Credentials muss der Tenant eintragen, um diesen Provider
   *  zu nutzen? Self-Print: leer. */
  credentialFields: CredentialField[];

  /** Adapter-Instanz (singleton, stateless) */
  adapter: PrintAdapter;
}

/**
 * Self-Print: immer verfuegbar, voll funktional.
 */
const SELF_PRINT: PrintProviderDef = {
  key: "manual_self_print",
  label: "Selbst drucken",
  tagline:
    "Du druckst selbst (eigener Drucker oder lokales Lab). Wir leiten Bestellungen mit Lieferadresse an dich weiter.",
  market: "DE,EU,US",
  websiteUrl: "",
  stage: "self_print",
  categories: ["print", "canvas", "photobook", "frame", "metal_print", "poster"],
  credentialFields: [],
  adapter: new ManualSelfPrintAdapter(),
};

// =============================================================================
// Externe Lab-Provider (Stubs fuer Phase 2+)
// =============================================================================

const WHITEWALL: PrintProviderDef = {
  key: "whitewall",
  label: "WhiteWall",
  tagline:
    "Premium-Print-Lab mit eigener Manufaktur in Köln. ProAPI fuer Profi-Konditionen.",
  market: "DE,EU",
  websiteUrl: "https://www.whitewall.com",
  apiKeyHelpUrl: "https://www.whitewall.com/de/pro",
  stage: "planned",
  categories: ["print", "canvas", "frame", "metal_print"],
  credentialFields: [
    {
      key: "apiKey",
      label: "ProAPI-Key",
      kind: "password",
      required: true,
      helpText:
        "Im WhiteWall-Pro-Dashboard unter 'Mein Profi-Konto → API-Zugaenge' erstellbar.",
    },
    {
      key: "accountId",
      label: "Pro-Account-ID",
      kind: "text",
      required: true,
    },
  ],
  adapter: new NotImplementedAdapter("whitewall"),
};

const SAAL_DIGITAL: PrintProviderDef = {
  key: "saal_digital",
  label: "Saal Digital",
  tagline:
    "Premium-Lab fuer Photobooks und Prints. API-Zugang nur fuer Partner-Programm.",
  market: "DE,EU",
  websiteUrl: "https://www.saal-digital.de",
  apiKeyHelpUrl: "https://www.saal-digital.de/partner",
  stage: "planned",
  categories: ["print", "photobook", "canvas", "frame"],
  credentialFields: [
    {
      key: "apiKey",
      label: "Partner-API-Key",
      kind: "password",
      required: true,
      helpText:
        "Saal Digital vergibt API-Zugang nur an verifizierte Partner. Bei Saal unter partner@saal-digital.de anfragen.",
    },
  ],
  adapter: new NotImplementedAdapter("saal_digital"),
};

const CEWE_PRO: PrintProviderDef = {
  key: "cewe_pro",
  label: "CEWE Professional",
  tagline:
    "Breitestes Produktportfolio inkl. Photobooks und Albumdrucke. Pro-API verfuegbar.",
  market: "DE,EU",
  websiteUrl: "https://www.cewe.de/photoworld",
  apiKeyHelpUrl: "https://professional.cewe.de",
  stage: "planned",
  categories: ["print", "photobook", "canvas", "frame", "poster"],
  credentialFields: [
    {
      key: "clientId",
      label: "Client-ID",
      kind: "text",
      required: true,
    },
    {
      key: "clientSecret",
      label: "Client-Secret",
      kind: "password",
      required: true,
    },
  ],
  adapter: new NotImplementedAdapter("cewe_pro"),
};

const PROFILAB: PrintProviderDef = {
  key: "profilab",
  label: "ProfiLab",
  tagline: "Editorial- und Galerie-Quality Prints aus Deutschland.",
  market: "DE,EU",
  websiteUrl: "https://www.profilab24.com",
  stage: "planned",
  categories: ["print", "canvas", "frame", "metal_print"],
  credentialFields: [
    {
      key: "apiKey",
      label: "API-Key",
      kind: "password",
      required: true,
    },
  ],
  adapter: new NotImplementedAdapter("profilab"),
};

const MYPOSTER: PrintProviderDef = {
  key: "myposter",
  label: "myposter",
  tagline: "Schneller Versand, breites Produktportfolio. API verfuegbar.",
  market: "DE,EU",
  websiteUrl: "https://www.myposter.de",
  stage: "planned",
  categories: ["print", "canvas", "poster", "photobook"],
  credentialFields: [
    {
      key: "apiKey",
      label: "API-Key",
      kind: "password",
      required: true,
    },
  ],
  adapter: new NotImplementedAdapter("myposter"),
};

const PIXUM: PrintProviderDef = {
  key: "pixum",
  label: "Pixum",
  tagline: "Eher Consumer-orientiert, gute Foto-Drucke und Wandbilder.",
  market: "DE,EU",
  websiteUrl: "https://www.pixum.de",
  stage: "planned",
  categories: ["print", "photobook", "canvas"],
  credentialFields: [
    {
      key: "apiKey",
      label: "API-Key",
      kind: "password",
      required: true,
    },
  ],
  adapter: new NotImplementedAdapter("pixum"),
};

const POSTERLOUNGE: PrintProviderDef = {
  key: "posterlounge",
  label: "Posterlounge",
  tagline: "Poster- und Wallart-Spezialist mit grosser Druckpalette.",
  market: "DE,EU",
  websiteUrl: "https://www.posterlounge.de",
  stage: "planned",
  categories: ["poster", "frame", "canvas"],
  credentialFields: [
    {
      key: "apiKey",
      label: "API-Key",
      kind: "password",
      required: true,
    },
  ],
  adapter: new NotImplementedAdapter("posterlounge"),
};

const ALBELLI: PrintProviderDef = {
  key: "albelli",
  label: "Albelli",
  tagline: "Photobook-Spezialist mit europaeischer Praesenz (NL/DE/UK).",
  market: "EU",
  websiteUrl: "https://www.albelli.de",
  stage: "planned",
  categories: ["photobook", "print", "canvas"],
  credentialFields: [
    {
      key: "apiKey",
      label: "API-Key",
      kind: "password",
      required: true,
    },
  ],
  adapter: new NotImplementedAdapter("albelli"),
};

const LALALAB: PrintProviderDef = {
  key: "lalalab",
  label: "Lalalab",
  tagline: "Mobile-first Foto-Drucke. Belgisch/franzoesisch.",
  market: "EU",
  websiteUrl: "https://www.lalalab.com",
  stage: "planned",
  categories: ["print"],
  credentialFields: [
    {
      key: "apiKey",
      label: "API-Key",
      kind: "password",
      required: true,
    },
  ],
  adapter: new NotImplementedAdapter("lalalab"),
};

const MPIX: PrintProviderDef = {
  key: "mpix",
  label: "MPIX",
  tagline: "US-Pro-Lab. Falls Lumio mal in den US-Markt expandiert.",
  market: "US",
  websiteUrl: "https://www.mpix.com",
  stage: "planned",
  categories: ["print", "canvas", "frame", "photobook"],
  credentialFields: [
    {
      key: "apiKey",
      label: "API-Key",
      kind: "password",
      required: true,
    },
  ],
  adapter: new NotImplementedAdapter("mpix"),
};

const BONUSPRINT: PrintProviderDef = {
  key: "bonusprint",
  label: "Bonusprint",
  tagline: "UK-Foto-Drucke und Photobooks.",
  market: "UK,EU",
  websiteUrl: "https://www.bonusprint.co.uk",
  stage: "planned",
  categories: ["print", "photobook", "canvas"],
  credentialFields: [
    {
      key: "apiKey",
      label: "API-Key",
      kind: "password",
      required: true,
    },
  ],
  adapter: new NotImplementedAdapter("bonusprint"),
};

/**
 * Registry: ALLE Provider die Lumio kennt. Reihenfolge bestimmt UI-
 * Default-Sortierung.
 */
export const PRINT_PROVIDERS: PrintProviderDef[] = [
  SELF_PRINT,
  WHITEWALL,
  SAAL_DIGITAL,
  CEWE_PRO,
  PROFILAB,
  MYPOSTER,
  PIXUM,
  POSTERLOUNGE,
  ALBELLI,
  LALALAB,
  MPIX,
  BONUSPRINT,
];

const BY_KEY = new Map(PRINT_PROVIDERS.map((p) => [p.key, p]));

export function getPrintProvider(key: string): PrintProviderDef | undefined {
  return BY_KEY.get(key);
}

export function listPrintProviders(): PrintProviderDef[] {
  return PRINT_PROVIDERS;
}
