-- A password registration alone never proved mailbox ownership. Existing
-- identities, passwords, roles, private state and purchased credits stay intact.
ALTER TABLE users ADD COLUMN email_verified_at INTEGER;

CREATE TABLE email_auth_challenges (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  code_hash TEXT NOT NULL CHECK(length(code_hash)=64),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at>created_at),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  send_status TEXT NOT NULL DEFAULT 'pending' CHECK(send_status IN ('pending','sent','failed')),
  invalidated_at INTEGER,
  consumed_at INTEGER,
  claim_nonce TEXT NOT NULL DEFAULT '',
  target_user_id TEXT,
  registered INTEGER NOT NULL DEFAULT 0 CHECK(registered IN (0,1)),
  legacy_reset INTEGER NOT NULL DEFAULT 0 CHECK(legacy_reset IN (0,1))
);
CREATE INDEX email_auth_challenges_email ON email_auth_challenges(email,created_at DESC);
CREATE INDEX email_auth_challenges_expiry ON email_auth_challenges(expires_at);

-- This reservation deliberately has no foreign key to the challenge: reserving
-- the cooldown and inserting its challenge happen in the same transaction.
CREATE TABLE email_auth_cooldowns (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  challenge_id TEXT NOT NULL,
  requested_at INTEGER NOT NULL
);
