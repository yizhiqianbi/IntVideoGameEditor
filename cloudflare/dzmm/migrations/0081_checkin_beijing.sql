-- Daily check-in dates follow Beijing time. Rewards already stored at 5 stay valid.
-- Other task points stay on their original amounts.
PRAGMA foreign_keys = OFF;

CREATE TABLE task_claims_next (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL CHECK (task_id IN ('daily_checkin','first_conversation','publish_character','follow_authors','complete_profile','forum_reply')),
  period TEXT NOT NULL,
  points INTEGER NOT NULL,
  claimed_at INTEGER NOT NULL CHECK (claimed_at >= 0),
  expires_at INTEGER,
  PRIMARY KEY (user_id,task_id,period),
  CHECK (
    (task_id='daily_checkin' AND expires_at IS NOT NULL AND points BETWEEN 1 AND 100000
      AND (period=strftime('%Y-%m-%d', claimed_at/1000, 'unixepoch', '+8 hours')
        OR period=strftime('%Y-%m-%d', claimed_at/1000, 'unixepoch'))
      AND expires_at=claimed_at+2592000000)
    OR (task_id='publish_character' AND points=20 AND period='once' AND expires_at IS NULL)
    OR (task_id NOT IN ('daily_checkin','publish_character') AND points=5 AND period='once' AND expires_at IS NULL)
  )
);
INSERT INTO task_claims_next(user_id,task_id,period,points,claimed_at,expires_at)
  SELECT user_id,task_id,period,points,claimed_at,expires_at FROM task_claims;
DROP TABLE task_claims;
ALTER TABLE task_claims_next RENAME TO task_claims;
CREATE INDEX task_claims_balance ON task_claims(user_id,expires_at);
CREATE INDEX task_claims_recent ON task_claims(user_id,claimed_at DESC,task_id,period);

PRAGMA foreign_keys = ON;
