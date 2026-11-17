-- Google and Telegram login identities. The provider subject is the account
-- key. A matching email never merges an existing 叙梦 account by itself.
CREATE TABLE external_identities (
  provider TEXT NOT NULL CHECK(provider IN ('google','telegram')),
  subject TEXT NOT NULL CHECK(length(subject) BETWEEN 1 AND 255),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX external_identities_user ON external_identities(user_id, provider);

CREATE TABLE oauth_transactions (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider IN ('google','telegram')),
  state_hash TEXT NOT NULL UNIQUE CHECK(length(state_hash)=64),
  nonce_hash TEXT NOT NULL CHECK(length(nonce_hash)=64),
  code_verifier TEXT NOT NULL CHECK(length(code_verifier)=0 OR length(code_verifier) BETWEEN 43 AND 128),
  guest_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX oauth_transactions_expiry ON oauth_transactions(expires_at);
