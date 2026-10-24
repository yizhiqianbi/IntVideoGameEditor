-- Private immutable source images. The job snapshot remains after an upload is
-- removed so recovery and request deduplication retain the original identity.
CREATE TABLE generation_references (
  id TEXT PRIMARY KEY CHECK(length(id)=36),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
  mime_type TEXT NOT NULL CHECK(mime_type IN ('image/png','image/jpeg','image/webp')),
  byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 1 AND 2097152),
  width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 8192),
  height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 8192),
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  object_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  expires_at INTEGER NOT NULL CHECK(expires_at>created_at),
  deleted_at INTEGER,
  UNIQUE(id,user_id)
);
CREATE INDEX generation_references_owner ON generation_references(user_id,expires_at) WHERE deleted_at IS NULL;
ALTER TABLE generation_jobs ADD COLUMN reference_json TEXT CHECK(reference_json IS NULL OR json_valid(reference_json));
