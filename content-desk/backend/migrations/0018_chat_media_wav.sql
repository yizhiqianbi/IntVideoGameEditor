-- Preserve existing private assets and usage; allow the WAV output actually
-- returned by Workers AI MeloTTS. No payment or membership tables are changed.
CREATE TABLE chat_media_assets_wav (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('audio','image')),
  source_hash TEXT NOT NULL CHECK(length(source_hash)=64 AND source_hash NOT GLOB '*[^0-9a-f]*'),
  status TEXT NOT NULL CHECK(status IN ('pending','ready','failed')),
  processing_token TEXT NOT NULL,
  object_key TEXT NOT NULL,
  mime_type TEXT,
  byte_length INTEGER,
  audio_text_chars INTEGER,
  total_text_chars INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(user_id,conversation_id,message_id) REFERENCES messages(user_id,conversation_id,id) ON DELETE CASCADE,
  UNIQUE(user_id,conversation_id,message_id,kind,source_hash),
  CHECK(status!='ready' OR (byte_length>0 AND mime_type IN ('audio/mpeg','audio/wav','image/jpeg','image/png')))
);
INSERT INTO chat_media_assets_wav SELECT * FROM chat_media_assets;
DROP TABLE chat_media_assets;
ALTER TABLE chat_media_assets_wav RENAME TO chat_media_assets;
CREATE INDEX chat_media_assets_owner ON chat_media_assets(user_id,conversation_id,status,created_at);
