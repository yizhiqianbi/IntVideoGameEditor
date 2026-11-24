PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE COLLATE NOCASE,
  password_hash TEXT,
  nickname TEXT NOT NULL,
  is_guest INTEGER NOT NULL CHECK (is_guest IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  mutation_token TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE auth_rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);

CREATE TABLE characters (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  author TEXT NOT NULL,
  cover TEXT NOT NULL,
  tags_json TEXT NOT NULL CHECK (json_valid(tags_json)),
  description TEXT NOT NULL,
  personality TEXT NOT NULL,
  scenario TEXT NOT NULL,
  first_message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE conversations (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  title TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX conversations_character ON conversations(user_id, character_id);

CREATE TABLE messages (
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 12000 AND instr(content, char(0)) = 0),
  position INTEGER NOT NULL,
  PRIMARY KEY (user_id, conversation_id, id),
  FOREIGN KEY (user_id, conversation_id) REFERENCES conversations(user_id, id) ON DELETE CASCADE
);
CREATE INDEX messages_position ON messages(user_id, conversation_id, position);

CREATE TABLE favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, character_id)
);

CREATE TABLE preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  persona TEXT NOT NULL,
  preset TEXT NOT NULL,
  model TEXT NOT NULL CHECK (model IN ('fast', 'balanced', 'story')),
  dark INTEGER NOT NULL CHECK (dark IN (0, 1))
);
