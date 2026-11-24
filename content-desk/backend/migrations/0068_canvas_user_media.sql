-- Account library for canvas uploads, references and generated results.
-- The bytes stay in the create worker's media bucket; this table is the per-user catalog.
CREATE TABLE canvas_user_media (
  id TEXT PRIMARY KEY CHECK(length(id)=36),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('image','video','audio')),
  source TEXT NOT NULL CHECK(source IN ('upload','generation','reference')),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  mime_type TEXT NOT NULL CHECK(length(mime_type) BETWEEN 1 AND 80),
  byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 1 AND 80000000),
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  UNIQUE(user_id, content_hash)
);
CREATE INDEX canvas_user_media_owner ON canvas_user_media(user_id, created_at DESC);
