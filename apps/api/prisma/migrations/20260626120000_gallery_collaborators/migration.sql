-- Granulare Galerie-Freigabe: Mitglieder, für die eine Galerie
-- freigegeben ist (volle Rechte). Siehe lib/gallery-access.ts.
CREATE TABLE "gallery_collaborators" (
    "id" UUID NOT NULL,
    "galleryId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "addedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gallery_collaborators_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gallery_collaborators_galleryId_userId_key"
    ON "gallery_collaborators"("galleryId", "userId");
CREATE INDEX "gallery_collaborators_userId_idx"
    ON "gallery_collaborators"("userId");
CREATE INDEX "gallery_collaborators_galleryId_idx"
    ON "gallery_collaborators"("galleryId");

ALTER TABLE "gallery_collaborators"
    ADD CONSTRAINT "gallery_collaborators_galleryId_fkey"
    FOREIGN KEY ("galleryId") REFERENCES "galleries"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gallery_collaborators"
    ADD CONSTRAINT "gallery_collaborators_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
