-- Pro-Tenant Upload-Allowlist (Null = ENV-Default UPLOAD_ALLOWED_KINDS).
-- Kommagetrennte FileKinds: image,heic,raw,video,pdf,other.
ALTER TABLE "tenants" ADD COLUMN "uploadAllowedKinds" TEXT;
