CREATE TABLE IF NOT EXISTS share_cards (
  slug TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('game','character','story','drama')),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  body TEXT NOT NULL DEFAULT '' CHECK(length(body) <= 1200),
  author TEXT NOT NULL DEFAULT '' CHECK(length(author) <= 80),
  cover_url TEXT,
  source_id TEXT,
  created_at INTEGER NOT NULL,
  views INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS share_cards_created ON share_cards(created_at DESC);
