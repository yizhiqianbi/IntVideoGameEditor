PRAGMA foreign_keys = ON;

CREATE TABLE forum_posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120 AND instr(title, char(0)) = 0),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 12000 AND instr(body, char(0)) = 0),
  category TEXT NOT NULL CHECK (category IN ('characters', 'social', 'life', 'help', 'real')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX forum_posts_created ON forum_posts(created_at DESC, id DESC);
CREATE INDEX forum_posts_category ON forum_posts(category, created_at DESC, id DESC);

CREATE TABLE forum_post_tags (
  post_id TEXT NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  tag TEXT NOT NULL CHECK (length(tag) BETWEEN 1 AND 40 AND instr(tag, char(0)) = 0),
  PRIMARY KEY (post_id, tag)
);
CREATE INDEX forum_tags_name ON forum_post_tags(tag, post_id);

CREATE TABLE forum_replies (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000 AND instr(body, char(0)) = 0),
  created_at INTEGER NOT NULL
);
CREATE INDEX forum_replies_post ON forum_replies(post_id, created_at, id);

CREATE TABLE forum_votes (
  post_id TEXT NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE forum_reports (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000 AND instr(reason, char(0)) = 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed')),
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (post_id, user_id)
);
CREATE INDEX forum_reports_status ON forum_reports(status, created_at DESC, id DESC);
