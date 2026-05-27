CREATE TABLE "mrr_snapshots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "date" DATE NOT NULL,
  "mrrCents" INTEGER NOT NULL,
  "trialingMrrCents" INTEGER NOT NULL,
  "activeSubs" INTEGER NOT NULL,
  "trialingSubs" INTEGER NOT NULL,
  "perPlan" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mrr_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mrr_snapshots_date_key" ON "mrr_snapshots"("date");
