CREATE TABLE shelf_tags (
  tag TEXT PRIMARY KEY CHECK (length(tag) BETWEEN 1 AND 16 AND instr(tag, char(0)) = 0),
  normalized TEXT NOT NULL UNIQUE CHECK (length(normalized) BETWEEN 1 AND 16),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX shelf_tags_created ON shelf_tags(created_at DESC, tag);
