-- Index für Cross-Tenant-Abfragen nach Action über Zeit (Security-Dashboard).
CREATE INDEX "events_action_createdAt_idx" ON "events"("action", "createdAt");
