-- Per-Tenant Upload-Limit + Per-UploadLink Per-File-Limit
--
-- Tenants kriegen einen optionalen Override für das Pro-File-Limit
-- (default = ENV MAX_FILE_SIZE_MIB). Null = ENV-Wert nutzen.
--
-- UploadLinks kriegen einen optionalen Per-File-Cap separat zum
-- bereits existierenden maxBytesTotal (kumulativ). Null = effective
-- Tenant-Limit erben.
--
-- Beide Werte werden bei Init-Calls gegen MAX_UPLOAD_HARD_CAP_MIB
-- (ENV) gegengeprüft — der Hard-Cap ist die letzte Schutzlinie für
-- Self-Hoster und SaaS-Betreiber.

ALTER TABLE "tenants" ADD COLUMN "maxUploadMib" INTEGER;
ALTER TABLE "upload_links" ADD COLUMN "maxFileBytes" BIGINT;
