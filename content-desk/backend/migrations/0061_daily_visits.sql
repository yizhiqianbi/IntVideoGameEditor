-- One row per account per Beijing calendar day. Opening the app, chatting,
-- posting, or liking all count as a visit; the same account is not counted twice.
CREATE TABLE daily_visits (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_key TEXT NOT NULL CHECK (day_key GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  is_guest INTEGER NOT NULL CHECK (is_guest IN (0, 1)),
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, day_key)
);
CREATE INDEX daily_visits_day ON daily_visits(day_key, is_guest);
