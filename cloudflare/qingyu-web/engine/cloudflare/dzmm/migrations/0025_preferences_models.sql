-- Expand model IDs without changing existing rows, extra JSON or account FKs.
-- SQLite cannot alter a CHECK constraint in place.
CREATE TABLE preferences_model_choices (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  persona TEXT NOT NULL,
  preset TEXT NOT NULL,
  model TEXT NOT NULL CHECK (model IN ('fast','balanced','story','grok','gemini','claude','gpt','deepseek','qwen')),
  dark INTEGER NOT NULL CHECK (dark IN (0, 1)),
  extra_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(extra_json) AND json_type(extra_json) = 'object')
);
INSERT INTO preferences_model_choices(user_id,nickname,persona,preset,model,dark,extra_json)
  SELECT user_id,nickname,persona,preset,model,dark,extra_json FROM preferences;
DROP TABLE preferences;
ALTER TABLE preferences_model_choices RENAME TO preferences;
