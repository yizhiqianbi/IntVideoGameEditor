-- Increase the reward for each newly registered invitee. Existing rows keep
-- their original amount; only future referral rewards use 500 Credit.
PRAGMA foreign_keys = OFF;

DROP TRIGGER IF EXISTS referral_rewards_credit_after_insert;

CREATE TABLE referral_rewards_next (
  referral_id TEXT PRIMARY KEY REFERENCES referral_events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points INTEGER NOT NULL CHECK(points IN (20,500)),
  created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>=0),
  expires_at INTEGER CHECK(expires_at IS NULL)
);
INSERT INTO referral_rewards_next(referral_id,user_id,points,created_at,expires_at)
  SELECT referral_id,user_id,points,created_at,expires_at FROM referral_rewards;
DROP TABLE referral_rewards;
ALTER TABLE referral_rewards_next RENAME TO referral_rewards;
CREATE INDEX referral_rewards_owner ON referral_rewards(user_id, created_at DESC);

CREATE TRIGGER referral_rewards_credit_after_insert
AFTER INSERT ON referral_rewards
BEGIN
  INSERT OR IGNORE INTO community_credit_ledger(user_id,source_type,source_id,credits,created_at,expires_at)
    VALUES(NEW.user_id,'referral_reward',NEW.referral_id,NEW.points,NEW.created_at,NULL);
END;

PRAGMA foreign_keys = ON;
