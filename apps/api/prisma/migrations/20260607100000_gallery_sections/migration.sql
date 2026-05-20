-- =============================================================================
-- Galerie-Sections / Kapitel
-- =============================================================================
-- Neue Tabelle gallery_sections — pro Galerie eine Liste von Kapiteln
-- (z.B. Hochzeit: "Vorbereitung", "Trauung", "Feier"). Files können
-- optional einer Section zugeordnet werden. Files ohne sectionId
-- bleiben im Default-Bucket und erscheinen oberhalb der Sections.
--
-- coverFileId zeigt auf File.id derselben Galerie; FK ohne
-- Composite-Constraint, Anwendung prüft Zugehörigkeit.

CREATE TABLE "gallery_sections" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
    "galleryId"   UUID NOT NULL,
    "title"       VARCHAR(120) NOT NULL,
    "description" VARCHAR(400),
    "coverFileId" UUID,
    "sortIndex"   INT NOT NULL DEFAULT 0,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gallery_sections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "gallery_sections_galleryId_fkey"
        FOREIGN KEY ("galleryId") REFERENCES "galleries"("id") ON DELETE CASCADE
);

CREATE INDEX "gallery_sections_galleryId_sortIndex_idx"
    ON "gallery_sections"("galleryId", "sortIndex");

-- File-Verknüpfung zur Section. NULL = im Default-Bucket.
-- ON DELETE SET NULL — wird eine Section gelöscht, fallen ihre Files
-- automatisch zurück in den Default-Bucket statt mitgelöscht zu werden.
ALTER TABLE "files"
    ADD COLUMN "sectionId" UUID,
    ADD CONSTRAINT "files_sectionId_fkey"
        FOREIGN KEY ("sectionId") REFERENCES "gallery_sections"("id")
        ON DELETE SET NULL;

CREATE INDEX "files_sectionId_idx" ON "files"("sectionId");
