-- Broadcast-Tabelle + User-Opt-Out

CREATE TABLE "broadcasts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "subject" TEXT NOT NULL,
  "bodyMarkdown" TEXT NOT NULL,
  "bodyHtml" TEXT NOT NULL,
  "audience" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "totalRecipients" INTEGER NOT NULL DEFAULT 0,
  "sentCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "optedOutSkippedCount" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "lastProgressAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "createdById" UUID NOT NULL,
  "createdByEmail" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "broadcasts_status_lastProgressAt_idx"
  ON "broadcasts"("status", "lastProgressAt");

ALTER TABLE "users"
  ADD COLUMN "broadcastOptOut" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "broadcastOptOutToken" TEXT;

CREATE UNIQUE INDEX "users_broadcastOptOutToken_key"
  ON "users"("broadcastOptOutToken")
  WHERE "broadcastOptOutToken" IS NOT NULL;
