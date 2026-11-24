PRAGMA foreign_keys = ON;

-- A like belongs to the current account and a public character ID. The ID is
-- deliberately not a foreign key: the public directory also contains
-- read-only cards imported from an external catalogue.
CREATE TABLE character_likes (
  character_id TEXT NOT NULL CHECK (length(character_id) BETWEEN 1 AND 120),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (character_id, user_id)
);
CREATE INDEX character_likes_count ON character_likes(character_id, created_at DESC);
