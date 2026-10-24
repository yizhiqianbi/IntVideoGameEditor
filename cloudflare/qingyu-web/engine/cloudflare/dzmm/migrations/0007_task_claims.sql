PRAGMA foreign_keys = ON;

-- Community reward ledger. Rewards cannot be supplied by clients or spent on model calls.
CREATE TABLE task_claims (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL CHECK (task_id IN ('daily_checkin','first_conversation','publish_character','follow_authors','complete_profile','forum_reply')),
  period TEXT NOT NULL,
  points INTEGER NOT NULL CHECK ((task_id='publish_character' AND points=20) OR (task_id<>'publish_character' AND points=5)),
  claimed_at INTEGER NOT NULL CHECK (claimed_at >= 0),
  expires_at INTEGER,
  PRIMARY KEY (user_id,task_id,period),
  CHECK ((task_id='daily_checkin' AND expires_at IS NOT NULL AND period=strftime('%Y-%m-%d',claimed_at/1000,'unixepoch') AND expires_at=claimed_at+2592000000)
    OR (task_id<>'daily_checkin' AND period='once' AND expires_at IS NULL))
);
CREATE INDEX task_claims_balance ON task_claims(user_id,expires_at);
CREATE INDEX task_claims_recent ON task_claims(user_id,claimed_at DESC,task_id,period);
