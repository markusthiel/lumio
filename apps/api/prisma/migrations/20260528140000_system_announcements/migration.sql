CREATE TABLE "system_announcements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'info',
  "activeFrom" TIMESTAMP(3),
  "activeUntil" TIMESTAMP(3),
  "dismissible" BOOLEAN NOT NULL DEFAULT true,
  "createdById" UUID NOT NULL,
  "createdByEmail" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "system_announcements_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "system_announcements_activeFrom_activeUntil_idx"
  ON "system_announcements"("activeFrom", "activeUntil");
