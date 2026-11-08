-- Assets are private derivatives of one saved assistant message. Successful
-- daily usage is retained independently so deleting a message cannot reset it.
CREATE TABLE chat_media_assets (
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
  CHECK(status!='ready' OR (byte_length>0 AND mime_type IN ('audio/mpeg','image/jpeg','image/png')))
);
CREATE INDEX chat_media_assets_owner ON chat_media_assets(user_id,conversation_id,status,created_at);

CREATE TABLE chat_media_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('audio','image')),
  day_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','ready','failed')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  CHECK(day_key=strftime('%Y-%m-%d',created_at/1000,'unixepoch','+8 hours'))
);
CREATE INDEX chat_media_daily_usage ON chat_media_usage(user_id,day_key,kind,status);
CREATE INDEX chat_media_pending_expiry ON chat_media_usage(user_id,status,expires_at);
