-- Zustellungs-Log für ausgehende Mails (Super-Admin-Deliverability).
CREATE TABLE "mail_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mail_log_createdAt_idx" ON "mail_log"("createdAt");
CREATE INDEX "mail_log_status_createdAt_idx" ON "mail_log"("status", "createdAt");
