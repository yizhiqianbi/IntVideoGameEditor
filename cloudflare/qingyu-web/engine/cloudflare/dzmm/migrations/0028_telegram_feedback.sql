-- A dedicated, opt-in group-feedback inbox. No ordinary Telegram messages or
-- chat history are persisted; media is metadata only.
CREATE TABLE telegram_feedback (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  update_id INTEGER NOT NULL,
  source_version INTEGER NOT NULL,
  text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 8192),
  chat_title TEXT NOT NULL,
  chat_username TEXT,
  sender_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  sender_username TEXT,
  thread_id INTEGER,
  message_url TEXT,
  message_at INTEGER NOT NULL,
  edited_at INTEGER,
  reply_text TEXT,
  reply_sender_name TEXT,
  media_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','fix','improve','later','done')),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=2000),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
  decided_by TEXT REFERENCES users(id),
  decided_at INTEGER,
  decision_token TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(bot_id,chat_id,message_id)
);
CREATE INDEX telegram_feedback_inbox ON telegram_feedback(status,created_at DESC,id DESC);
CREATE TABLE telegram_feedback_decisions (
  id TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL REFERENCES telegram_feedback(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  previous_status TEXT NOT NULL,
  previous_note TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','fix','improve','later','done')),
  note TEXT NOT NULL CHECK(length(note)<=2000),
  processing_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(feedback_id,revision)
);
