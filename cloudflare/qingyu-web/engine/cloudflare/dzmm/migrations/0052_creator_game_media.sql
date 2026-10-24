PRAGMA foreign_keys = ON;

-- Source above the original 256 KB row limit lives in R2. The source CHECK stays
-- in place; an external game stores an empty source plus the object key.
ALTER TABLE creator_games ADD COLUMN media_bytes INTEGER NOT NULL DEFAULT 0 CHECK (media_bytes >= 0 AND media_bytes <= 8388608);
ALTER TABLE creator_games ADD COLUMN media_key TEXT CHECK (media_key IS NULL OR length(media_key) BETWEEN 1 AND 512);
