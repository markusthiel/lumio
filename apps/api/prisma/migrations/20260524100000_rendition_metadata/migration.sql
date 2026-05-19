-- Lumio: rendition metadata
--
-- JSON-Spalte für rendition-spezifische Daten, die in width/height/format
-- nicht passen. Erster Use-Case: Sprite-Sheets brauchen Intervall +
-- Kachelraster, damit der Frontend-Video-Player beim Scrubbing die
-- richtige Tile-Koordinate ausrechnen kann.
ALTER TABLE renditions ADD COLUMN metadata JSONB;
