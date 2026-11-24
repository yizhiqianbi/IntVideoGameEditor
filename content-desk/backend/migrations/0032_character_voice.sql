-- Private standalone readings share chat_media_usage's audio quota receipts.
CREATE TABLE character_voice_assets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  source_key TEXT NOT NULL CHECK(length(source_key) BETWEEN 1 AND 280),
  source_text TEXT NOT NULL,
  source_hash TEXT NOT NULL CHECK(length(source_hash)=64 AND source_hash NOT GLOB '*[^0-9a-f]*'),
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','ready','failed')),
  processing_token TEXT NOT NULL,
  object_key TEXT NOT NULL,
  mime_type TEXT,
  byte_length INTEGER,
  audio_text_chars INTEGER,
  total_text_chars INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id,source_hash),
  CHECK(status!='ready' OR (byte_length>0 AND mime_type IN ('audio/mpeg','audio/wav') AND audio_text_chars>0 AND total_text_chars>=audio_text_chars))
);
CREATE INDEX character_voice_assets_owner ON character_voice_assets(user_id,status,created_at);
