-- =============================================================================
-- Lumio — Initial Migration
-- =============================================================================
-- Entspricht dem Prisma-Schema in prisma/schema.prisma.
-- Wird beim ersten `prisma migrate deploy` ausgeführt.

-- Tenants
CREATE TABLE "tenants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "customDomain" TEXT,
    "brandingId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");
CREATE UNIQUE INDEX "tenants_customDomain_key" ON "tenants"("customDomain");
CREATE INDEX "tenants_slug_idx" ON "tenants"("slug");

-- Brandings
CREATE TABLE "brandings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "faviconUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#0f172a',
    "accentColor" TEXT NOT NULL DEFAULT '#f59e0b',
    "fontFamily" TEXT NOT NULL DEFAULT 'Inter',
    "introText" TEXT,
    "footerText" TEXT,
    "customCss" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "brandings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "brandings_tenantId_idx" ON "brandings"("tenantId");

ALTER TABLE "brandings"
    ADD CONSTRAINT "brandings_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenants"
    ADD CONSTRAINT "tenants_brandingId_fkey"
    FOREIGN KEY ("brandingId") REFERENCES "brandings"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Users
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'active',
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");
CREATE INDEX "users_email_idx" ON "users"("email");

ALTER TABLE "users"
    ADD CONSTRAINT "users_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Sessions
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

ALTER TABLE "sessions"
    ADD CONSTRAINT "sessions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Galleries
CREATE TABLE "galleries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "brandingId" UUID,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'collaboration',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "passwordHash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "downloadEnabled" BOOLEAN NOT NULL DEFAULT true,
    "watermarkEnabled" BOOLEAN NOT NULL DEFAULT false,
    "commentsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "ratingsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "selectionLimit" INTEGER,
    "emailRequired" BOOLEAN NOT NULL DEFAULT false,
    "coverFileId" UUID,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "galleries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "galleries_slug_key" ON "galleries"("slug");
CREATE INDEX "galleries_tenantId_idx" ON "galleries"("tenantId");
CREATE INDEX "galleries_ownerId_idx" ON "galleries"("ownerId");
CREATE INDEX "galleries_slug_idx" ON "galleries"("slug");

ALTER TABLE "galleries"
    ADD CONSTRAINT "galleries_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "galleries"
    ADD CONSTRAINT "galleries_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "galleries"
    ADD CONSTRAINT "galleries_brandingId_fkey"
    FOREIGN KEY ("brandingId") REFERENCES "brandings"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Gallery Access (Tokens für Kunden)
CREATE TABLE "gallery_access" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "galleryId" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "email" CITEXT,
    "canDownload" BOOLEAN NOT NULL DEFAULT true,
    "canComment" BOOLEAN NOT NULL DEFAULT true,
    "canSelect" BOOLEAN NOT NULL DEFAULT true,
    "canSeeOthers" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "lastAccessAt" TIMESTAMP(3),
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gallery_access_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "gallery_access_token_key" ON "gallery_access"("token");
CREATE INDEX "gallery_access_galleryId_idx" ON "gallery_access"("galleryId");
CREATE INDEX "gallery_access_token_idx" ON "gallery_access"("token");

ALTER TABLE "gallery_access"
    ADD CONSTRAINT "gallery_access_galleryId_fkey"
    FOREIGN KEY ("galleryId") REFERENCES "galleries"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Files
CREATE TABLE "files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "galleryId" UUID NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "kind" TEXT NOT NULL,
    "exif" JSONB,
    "takenAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'uploading',
    "errorMessage" TEXT,
    "sortIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "files_galleryId_sortIndex_idx" ON "files"("galleryId", "sortIndex");
CREATE INDEX "files_galleryId_status_idx" ON "files"("galleryId", "status");
CREATE INDEX "files_sha256_idx" ON "files"("sha256");

ALTER TABLE "files"
    ADD CONSTRAINT "files_galleryId_fkey"
    FOREIGN KEY ("galleryId") REFERENCES "galleries"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Renditions
CREATE TABLE "renditions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fileId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sizeBytes" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "renditions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "renditions_fileId_kind_key" ON "renditions"("fileId", "kind");
CREATE INDEX "renditions_fileId_idx" ON "renditions"("fileId");

ALTER TABLE "renditions"
    ADD CONSTRAINT "renditions_fileId_fkey"
    FOREIGN KEY ("fileId") REFERENCES "files"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Selections
CREATE TABLE "selections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fileId" UUID NOT NULL,
    "accessId" UUID NOT NULL,
    "color" TEXT,
    "rating" INTEGER,
    "liked" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "selections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "selections_fileId_accessId_key" ON "selections"("fileId", "accessId");
CREATE INDEX "selections_fileId_idx" ON "selections"("fileId");
CREATE INDEX "selections_accessId_idx" ON "selections"("accessId");

ALTER TABLE "selections"
    ADD CONSTRAINT "selections_fileId_fkey"
    FOREIGN KEY ("fileId") REFERENCES "files"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "selections"
    ADD CONSTRAINT "selections_accessId_fkey"
    FOREIGN KEY ("accessId") REFERENCES "gallery_access"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Comments
CREATE TABLE "comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fileId" UUID NOT NULL,
    "accessId" UUID,
    "authorLabel" TEXT NOT NULL,
    "authorIsStudio" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "annotation" JSONB,
    "parentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "comments_fileId_idx" ON "comments"("fileId");
CREATE INDEX "comments_accessId_idx" ON "comments"("accessId");

ALTER TABLE "comments"
    ADD CONSTRAINT "comments_fileId_fkey"
    FOREIGN KEY ("fileId") REFERENCES "files"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comments"
    ADD CONSTRAINT "comments_accessId_fkey"
    FOREIGN KEY ("accessId") REFERENCES "gallery_access"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comments"
    ADD CONSTRAINT "comments_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "comments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Download Logs
CREATE TABLE "download_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "galleryId" UUID NOT NULL,
    "fileId" UUID,
    "kind" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "bytes" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "download_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "download_logs_galleryId_createdAt_idx" ON "download_logs"("galleryId", "createdAt");

ALTER TABLE "download_logs"
    ADD CONSTRAINT "download_logs_galleryId_fkey"
    FOREIGN KEY ("galleryId") REFERENCES "galleries"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "download_logs"
    ADD CONSTRAINT "download_logs_fileId_fkey"
    FOREIGN KEY ("fileId") REFERENCES "files"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Events (Audit Log)
CREATE TABLE "events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "payload" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "events_tenantId_createdAt_idx" ON "events"("tenantId", "createdAt");
CREATE INDEX "events_tenantId_action_idx" ON "events"("tenantId", "action");

ALTER TABLE "events"
    ADD CONSTRAINT "events_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Billing Plans
CREATE TABLE "billing_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "storageGib" INTEGER,
    "galleriesMax" INTEGER,
    "filesPerGallery" INTEGER,
    "usersMax" INTEGER,
    "bandwidthGibPerMonth" INTEGER,
    "customDomain" BOOLEAN NOT NULL DEFAULT false,
    "whiteLabel" BOOLEAN NOT NULL DEFAULT false,
    "watermarking" BOOLEAN NOT NULL DEFAULT true,
    "analytics" BOOLEAN NOT NULL DEFAULT false,
    "stripePriceIdMonthly" TEXT,
    "stripePriceIdYearly" TEXT,
    "priceMonthlyCents" INTEGER,
    "priceYearlyCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "billing_plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "billing_plans_slug_key" ON "billing_plans"("slug");

-- Billing Subscriptions
CREATE TABLE "billing_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "billingInterval" TEXT NOT NULL,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "trialEndsAt" TIMESTAMP(3),
    "storageBytesUsed" BIGINT NOT NULL DEFAULT 0,
    "bandwidthBytesUsed" BIGINT NOT NULL DEFAULT 0,
    "galleriesCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "billing_subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "billing_subscriptions_tenantId_key" ON "billing_subscriptions"("tenantId");
CREATE UNIQUE INDEX "billing_subscriptions_stripeSubscriptionId_key" ON "billing_subscriptions"("stripeSubscriptionId");

ALTER TABLE "billing_subscriptions"
    ADD CONSTRAINT "billing_subscriptions_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_subscriptions"
    ADD CONSTRAINT "billing_subscriptions_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "billing_plans"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Billing Usage Records
CREATE TABLE "billing_usage_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "quantity" BIGINT NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "reportedToStripeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "billing_usage_records_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "billing_usage_records_tenantId_periodStart_idx" ON "billing_usage_records"("tenantId", "periodStart");
