/**
 * Setzt minimale Test-Env-Vars, bevor Module geladen werden, die `config.ts`
 * importieren. Die Werte sind reine Platzhalter — Tests, die echte
 * DB-/Storage-Verbindungen brauchen, müssen das selbst stubben.
 */
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  "postgres://test:test@localhost:5432/test";
process.env.S3_ENDPOINT = "http://localhost:9000";
process.env.S3_BUCKET = "test";
process.env.S3_ACCESS_KEY = "test";
process.env.S3_SECRET_KEY = "test";
process.env.JWT_SECRET = "test_secret_at_least_16_chars___";
process.env.SESSION_SECRET = "test_secret_at_least_16_chars___";
