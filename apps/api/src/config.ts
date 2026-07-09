/**
 * Lumio API — Configuration
 *
 * Liest und validiert alle Environment-Variablen.
 * Fehlende oder ungültige Pflicht-Variablen führen zu einem Fail-Fast.
 */
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().default(3001),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DEPLOYMENT_MODE: z.enum(["single", "multi"]).default("single"),
  PUBLIC_URL: z.string().url().default("http://localhost:3000"),

  /** Basis-Domain für Subdomain-Tenant-Resolution (<slug>.<base>).
   * Nur im Multi-Mode relevant. Wird auch für die Studio-URL-Anzeige
   * und Custom-Domain-DNS-Hinweise verwendet. */
  LUMIO_DOMAIN_BASE: z.string().optional(),
  /** Öffentliche IP(v4) des Servers — für Custom-Domain-DNS-Checks.
   * Wir zeigen dem User "setze einen A-Record auf <IP>" und können
   * prüfen ob die DNS-Auflösung der Custom-Domain darauf zeigt. Wenn
   * nicht gesetzt, wird der DNS-Vergleich übersprungen (nur Resolve-
   * Anzeige ohne Soll/Ist-Abgleich). */
  LUMIO_PUBLIC_IP: z.string().optional(),

  /** Rechtliche Links des Betreibers (Impressum / Datenschutz). Werden
   *  als Footer-Links auf Login-, Galerie- und Studio-Seiten angezeigt.
   *  Self-Hoster setzen hier ihre eigenen URLs; bleibt es leer, wird
   *  kein Link angezeigt. Absolute URL empfohlen (z.B.
   *  https://example.de/impressum), relative Pfade sind erlaubt. */
  LUMIO_LEGAL_IMPRINT_URL: z.string().optional(),
  LUMIO_LEGAL_PRIVACY_URL: z.string().optional(),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://redis:6379"),

  STORAGE_PROVIDER: z
    .enum(["minio", "s3", "r2", "b2", "wasabi", "custom"])
    .default("minio"),
  S3_ENDPOINT: z.string().min(1),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  S3_PUBLIC_URL: z.string().optional(),

  JWT_SECRET: z.string().min(16),
  SESSION_SECRET: z.string().min(16),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  SMTP_SECURE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

  /** Default Pro-File-Upload-Limit in MiB. Tenants können das in
   * ihren Settings überschreiben (tenants.maxUploadMib), aber NIE
   * über MAX_UPLOAD_HARD_CAP_MIB. Self-Hoster setzen das auf was
   * sie eben für ihren Storage praktisch finden. */
  MAX_FILE_SIZE_MIB: z.coerce.number().int().default(10240),
  /** Default-Allowlist erlaubter Datei-Arten beim Upload (kommagetrennt).
   *  Werte: image,heic,raw,video,pdf,other. "other" aufnehmen = Filter aus.
   *  Pro Studio via tenants.uploadAllowedKinds uebersteuerbar. */
  UPLOAD_ALLOWED_KINDS: z.string().default("image,heic,raw,video,pdf"),
  /** Hard-Cap für ALLE pro-File-Limits in MiB. Letzte Schutzlinie
   * gegen versehentliche Misskonfiguration und gegen SaaS-Miss-
   * brauch. Tenant-Settings dürfen nicht über diesen Wert. */
  MAX_UPLOAD_HARD_CAP_MIB: z.coerce.number().int().default(10240),

  /** Default für die max. Größe eines Download-Pakets (Teil-ZIP) in MiB.
   * Tenants können das in ihren Settings überschreiben
   * (tenants.zipPartMaxMib), aber NIE über ZIP_PART_MAX_HARD_CAP_MIB.
   * Nicht gesetzt → 8192 (8 GiB). */
  ZIP_PART_MAX_MIB: z.coerce.number().int().positive().optional(),
  /** @deprecated Alt-ENV aus v0.45.0 in Bytes. Wird nur noch als Fallback
   * gelesen, wenn ZIP_PART_MAX_MIB nicht gesetzt ist. Bitte auf
   * ZIP_PART_MAX_MIB umstellen. */
  ZIP_PART_MAX_BYTES: z.coerce.number().int().positive().optional(),
  /** Hard-Cap für pro-Tenant-Paketgrößen in MiB. Letzte Schutzlinie
   * gegen Misskonfiguration/SaaS-Missbrauch. Default 50 GiB. */
  ZIP_PART_MAX_HARD_CAP_MIB: z.coerce.number().int().default(51200),

  BILLING_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // Cloudflare Turnstile (CAPTCHA) für den Self-Service-Signup. Nur aktiv,
  // wenn ein Secret gesetzt ist — sonst wird der Signup nicht gegated
  // (Self-Hoster/Single-Mode brauchen das nicht). Der zugehörige Site-Key
  // lebt im Frontend/Marketing-Site-Env (PUBLIC_TURNSTILE_SITE_KEY).
  TURNSTILE_SECRET_KEY: z.string().optional(),
  /** Publishable key — wird ans Frontend gegeben für Checkout-Forms.
   * Frontend braucht den, weil Stripe-Elements im Browser laufen.
   * Beginnt mit pk_test_ oder pk_live_. */
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  /** URL-Basis für Checkout/Portal-Returns. Default = SaaS-Domain.
   * Wird in der success_url / cancel_url verwendet. */
  STRIPE_RETURN_URL_BASE: z
    .string()
    .default("https://studio.lumio-cloud.de"),
  /** Test-Mode-Flag: Stripe-Calls gegen Test-Endpoints, Tenants
   * mit dem ?test=1-Query-Parameter dürfen Test-Sign-ups machen.
   * In Production auf false, dann ist Test-Mode-Sign-up gesperrt. */
  STRIPE_TEST_MODE: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  /** Billing-Archiv-Lifecycle (nur SaaS). Tage im Read-only, bevor ein
   * gekündigtes/unbezahltes Studio "kalt" archiviert wird (Galerien
   * offline, Renditions aus dem Bucket gelöscht). */
  BILLING_ARCHIVE_AFTER_DAYS: z.coerce.number().int().positive().default(30),
  /** Monate ab Abo-Ende (readOnlySince), bis ein archiviertes Studio
   * endgültig gelöscht wird. */
  BILLING_PURGE_AFTER_MONTHS: z.coerce.number().int().positive().default(12),
});

let parsed: z.infer<typeof envSchema>;

try {
  parsed = envSchema.parse(process.env);
} catch (err) {
  if (err instanceof z.ZodError) {
    const issues = err.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.error(
      `[lumio:api] Invalid environment configuration:\n${issues}\n` +
        `Refer to .env.example for required variables.`
    );
  } else {
    console.error("[lumio:api] Failed to load configuration:", err);
  }
  process.exit(1);
}

export const config = parsed;
export type AppConfig = typeof config;

/**
 * Sicherheits-Guard: In Production darf NIE mit einem Platzhalter- oder
 * Default-Secret gestartet werden. JWT_SECRET/SESSION_SECRET signieren
 * Sessions und Visitor-Cookies — der Platzhalter aus .env.example steht
 * öffentlich im Repo, ein vergessener Wert würde fälschbare Tokens
 * bedeuten. Lieber hart abbrechen als unsicher laufen.
 *
 * Greift nur in Production, damit lokale Dev-/Test-Setups mit simplen
 * Werten weiter funktionieren.
 */
if (config.NODE_ENV === "production") {
  const weak: string[] = [];
  const looksDefault = (v: string) =>
    /changeme/i.test(v) || /^your[_-]/i.test(v) || /placeholder/i.test(v);
  for (const key of ["JWT_SECRET", "SESSION_SECRET"] as const) {
    const val = config[key];
    if (looksDefault(val)) weak.push(key);
  }
  if (weak.length > 0) {
    console.error(
      `[lumio:api] Refusing to start: insecure secret(s) detected: ${weak.join(", ")}.\n` +
        `Set strong, unique values (e.g. \`openssl rand -base64 32\`). ` +
        `The placeholder values from .env.example are publicly known and ` +
        `would allow forging session/visitor tokens.`
    );
    process.exit(1);
  }
}
