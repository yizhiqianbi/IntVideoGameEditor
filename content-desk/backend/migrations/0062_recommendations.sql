-- Recommendation facts. Event rows never store chat text. Daily counts are the
-- long-lived aggregate; raw events are deleted after 90 days by the worker.
CREATE TABLE recommendation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL CHECK (length(character_id) BETWEEN 1 AND 120),
  surface TEXT NOT NULL CHECK (surface IN ('home', 'for_you', 'ranking', 'related', 'search', 'category')),
  action TEXT NOT NULL CHECK (action IN ('impression', 'open', 'start', 'depth', 'like', 'unlike', 'favorite', 'unfavorite', 'hide')),
  position INTEGER CHECK (position IS NULL OR position BETWEEN 0 AND 500),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
);
CREATE INDEX recommendation_events_lookup ON recommendation_events(user_id, character_id, action, created_at);
CREATE INDEX recommendation_events_created ON recommendation_events(created_at);

CREATE TABLE recommendation_item_daily (
  character_id TEXT NOT NULL CHECK (length(character_id) BETWEEN 1 AND 120),
  day_key TEXT NOT NULL CHECK (day_key GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  impressions INTEGER NOT NULL DEFAULT 0 CHECK (impressions BETWEEN 0 AND 1000000000),
  opens INTEGER NOT NULL DEFAULT 0 CHECK (opens BETWEEN 0 AND 1000000000),
  starts INTEGER NOT NULL DEFAULT 0 CHECK (starts BETWEEN 0 AND 1000000000),
  qualified INTEGER NOT NULL DEFAULT 0 CHECK (qualified BETWEEN 0 AND 1000000000),
  likes INTEGER NOT NULL DEFAULT 0 CHECK (likes BETWEEN 0 AND 1000000000),
  favorites INTEGER NOT NULL DEFAULT 0 CHECK (favorites BETWEEN 0 AND 1000000000),
  PRIMARY KEY (character_id, day_key)
);

CREATE TABLE recommendation_backfill (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL CHECK (length(character_id) BETWEEN 1 AND 120),
  kind TEXT NOT NULL CHECK (kind IN ('like', 'favorite', 'qualified')),
  day_key TEXT NOT NULL CHECK (day_key GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  PRIMARY KEY (user_id, character_id, kind)
);

CREATE TABLE recommendation_hidden (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL CHECK (length(character_id) BETWEEN 1 AND 120),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  PRIMARY KEY (user_id, character_id)
);
