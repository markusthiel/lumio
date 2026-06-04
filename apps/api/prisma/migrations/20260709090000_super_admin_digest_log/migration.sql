-- Idempotenz-Marker für den täglichen Super-Admin-Digest (ein Row pro Tag).
CREATE TABLE "super_admin_digest_log" (
    "date" DATE NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "super_admin_digest_log_pkey" PRIMARY KEY ("date")
);
