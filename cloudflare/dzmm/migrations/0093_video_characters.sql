CREATE TABLE IF NOT EXISTS video_characters (
  drama_id TEXT PRIMARY KEY,
  card_json TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 40),
  generated_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
