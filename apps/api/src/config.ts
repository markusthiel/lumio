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

  MAX_FILE_SIZE_MIB: z.coerce.number().int().default(2048),

  BILLING_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
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
