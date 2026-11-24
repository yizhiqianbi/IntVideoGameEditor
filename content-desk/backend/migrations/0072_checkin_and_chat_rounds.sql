-- Daily check-in amount is operator-configured. Existing task_claims keep the
-- points written at claim time, so a later change does not rewrite history.
CREATE TABLE platform_settings (
  key TEXT PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 64),
  value TEXT NOT NULL CHECK (length(value) BETWEEN 1 AND 200),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
);

-- One row per public character per Shanghai day. Counts only rounds that
-- completed after this table existed; the first sync of an old conversation
-- is a baseline and does not dump its history into today.
CREATE TABLE character_chat_rounds (
  character_id TEXT NOT NULL CHECK (length(character_id) BETWEEN 1 AND 120),
  day_key TEXT NOT NULL CHECK (day_key GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  rounds INTEGER NOT NULL CHECK (rounds BETWEEN 0 AND 1000000000),
  PRIMARY KEY (character_id, day_key)
);
