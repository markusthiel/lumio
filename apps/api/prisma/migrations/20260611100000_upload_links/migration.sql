-- Upload-Links: öffentliche Drag-and-Drop-Endpunkte pro Galerie
--
-- Erlaubt Studio-Owner einen sicheren Link zu generieren der an Dritte
-- weitergegeben werden kann ("Junggesellenabend"-Use-Case). Files die
-- über den Link reinkommen werden Status uploadedVia='upload_link' +
-- publicVisibility='hidden' markiert — Studio sieht sie, Customer-
-- Galerie erst nach Freigabe.

CREATE TABLE "upload_links" (
  "id"              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "galleryId"       UUID NOT NULL REFERENCES "galleries"("id") ON DELETE CASCADE,
  "token"           TEXT NOT NULL UNIQUE,
  "label"           TEXT NOT NULL,
  "passwordHash"    TEXT,
  "active"          BOOLEAN NOT NULL DEFAULT TRUE,
  "maxFiles"        INT,
  "maxBytesTotal"   BIGINT,
  "expiresAt"       TIMESTAMP(3),
  "uploadCount"     INT NOT NULL DEFAULT 0,
  "bytesUploaded"   BIGINT NOT NULL DEFAULT 0,
  "lastUploadAt"    TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE INDEX "upload_links_galleryId_idx" ON "upload_links"("galleryId");
CREATE INDEX "upload_links_token_idx" ON "upload_links"("token");

-- File-Erweiterung: woher kam der Upload, wer ist Owner der Link-Beziehung,
-- soll der Customer das File schon sehen?
ALTER TABLE "files" ADD COLUMN "uploadedVia" TEXT NOT NULL DEFAULT 'studio';
ALTER TABLE "files" ADD COLUMN "uploadLinkId" UUID
  REFERENCES "upload_links"("id") ON DELETE SET NULL;
ALTER TABLE "files" ADD COLUMN "publicVisibility" TEXT NOT NULL DEFAULT 'visible';

CREATE INDEX "files_galleryId_publicVisibility_idx"
  ON "files"("galleryId", "publicVisibility");
CREATE INDEX "files_uploadLinkId_idx" ON "files"("uploadLinkId");
