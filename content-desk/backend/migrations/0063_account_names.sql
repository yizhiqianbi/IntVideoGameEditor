-- A registration name stays reserved even if the display name later changes.
-- Guests share the nickname 游客, so uniqueness lives here instead of users.nickname.
-- A trigger cannot report a taken display name: D1 turns RAISE into an internal error.
CREATE TABLE account_names (
  name_key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE email_bind_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL COLLATE NOCASE,
  code_hash TEXT NOT NULL CHECK(length(code_hash)=64),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at>created_at),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  send_status TEXT NOT NULL DEFAULT 'pending' CHECK(send_status IN ('pending','sent','failed')),
  invalidated_at INTEGER,
  consumed_at INTEGER,
  claim_nonce TEXT NOT NULL DEFAULT ''
);
CREATE INDEX email_bind_challenges_user ON email_bind_challenges(user_id, created_at DESC);
