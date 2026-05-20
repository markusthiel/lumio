-- Drop the "masonry" grid-layout value. Two parts:
--
--   1. Existing rows with gridLayout='masonry' get rewritten to
--      'equal'. We picked 'equal' over 'justified' because the
--      previous masonry rendering was already showing as uniform
--      square tiles since commit 0b61a86 — operators saw squares,
--      so 'equal' is the literal continuation. No visual change
--      from this migration alone.
--
--   2. Default for new galleries flips masonry → equal. The
--      enum-like validation lives in app code (zod); after this
--      migration nothing in the database carries the masonry
--      string anymore.

UPDATE galleries
SET "gridLayout" = 'equal'
WHERE "gridLayout" = 'masonry';

ALTER TABLE galleries
  ALTER COLUMN "gridLayout" SET DEFAULT 'equal';
