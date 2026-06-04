-- Throttle-Marker für neue Studio-Benachrichtigungen.
ALTER TABLE "galleries" ADD COLUMN "expiryWarnedAt" TIMESTAMP(3);
ALTER TABLE "upload_links" ADD COLUMN "lastUploadNotifyAt" TIMESTAMP(3);
