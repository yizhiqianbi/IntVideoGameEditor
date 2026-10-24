PRAGMA foreign_keys = ON;

CREATE TABLE character_publications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  private_character_id TEXT NOT NULL CHECK (length(private_character_id) BETWEEN 1 AND 120),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  current_revision INTEGER NOT NULL DEFAULT 1 CHECK (current_revision >= 1),
  approved_revision INTEGER,
  is_listed INTEGER NOT NULL DEFAULT 0 CHECK (is_listed IN (0, 1)),
  mutation_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, private_character_id)
);
CREATE INDEX character_publications_owner ON character_publications(user_id, updated_at DESC, id);
CREATE INDEX character_publications_public ON character_publications(is_listed, updated_at DESC, id);

CREATE TABLE character_submissions (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES character_publications(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json) AND json_type(snapshot_json) = 'object'),
  private_media_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(private_media_json) AND json_type(private_media_json) = 'object'),
  published_media_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(published_media_json) AND json_type(published_media_json) = 'object'),
  review_reason TEXT NOT NULL DEFAULT '' CHECK (length(review_reason) <= 2000),
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  UNIQUE (publication_id, revision)
);
CREATE INDEX character_submissions_review ON character_submissions(status, created_at, id);
