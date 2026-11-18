-- A single switch decides whether the shelf shows adult content. Everything
-- that already exists stays adult; new rows may opt into the clean shelf.
CREATE TABLE site_settings (
  key TEXT PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 60),
  value TEXT NOT NULL CHECK (length(value) BETWEEN 1 AND 400),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
);
INSERT OR IGNORE INTO site_settings(key, value, updated_at) VALUES ('content_rating', 'nsfw', 0);

ALTER TABLE character_publications ADD COLUMN content_rating TEXT NOT NULL DEFAULT 'nsfw'
  CHECK (content_rating IN ('nsfw', 'sfw'));
CREATE INDEX character_publications_rating ON character_publications(is_listed, content_rating, updated_at DESC, id);
