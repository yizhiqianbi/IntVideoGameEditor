-- Qingyu owns its preference schema. Offer the complete current safe picker,
-- preserve unrelated settings, and normalize removed unfiltered model IDs.
CREATE TABLE preferences_qingyu_models (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 nickname TEXT NOT NULL,persona TEXT NOT NULL,preset TEXT NOT NULL,
 model TEXT NOT NULL CHECK(model IN ('fast','balanced','story','grok','grok46','gemini31','gemini','claude','gpt','deepseek','qwen','gemma26','gemma31')),
 dark INTEGER NOT NULL CHECK(dark IN(0,1)),
 extra_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(extra_json) AND json_type(extra_json)='object')
);
INSERT INTO preferences_qingyu_models SELECT user_id,nickname,persona,preset,
 CASE WHEN model IN ('cydonia','venice') THEN 'qwen' ELSE model END,dark,extra_json FROM preferences;
DROP TABLE preferences;
ALTER TABLE preferences_qingyu_models RENAME TO preferences;
