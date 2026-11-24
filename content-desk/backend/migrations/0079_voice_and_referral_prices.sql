-- Voice clips now cost 20 Credit. Rows already charged at 5 stay valid.
-- An invitee's successful-chat day now pays the inviter 500 Credit.
-- Days already paid at 5 stay valid.
PRAGMA foreign_keys = OFF;

DROP VIEW credit_usage_balances;

CREATE TABLE chat_media_usage_next (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('audio','image')),
  day_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','ready','failed')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  credits INTEGER NOT NULL DEFAULT 0 CHECK(credits IN (0,5,20,100)),
  CHECK(day_key=strftime('%Y-%m-%d',created_at/1000,'unixepoch','+8 hours'))
);
INSERT INTO chat_media_usage_next(id,user_id,asset_id,kind,day_key,status,created_at,expires_at,credits)
  SELECT id,user_id,asset_id,kind,day_key,status,created_at,expires_at,credits FROM chat_media_usage;
DROP TABLE chat_media_usage;
ALTER TABLE chat_media_usage_next RENAME TO chat_media_usage;
CREATE INDEX chat_media_daily_usage ON chat_media_usage(user_id,day_key,kind,status);
CREATE INDEX chat_media_pending_expiry ON chat_media_usage(user_id,status,expires_at);

CREATE TABLE referral_activity_rewards_next (
  referral_id TEXT NOT NULL REFERENCES referral_events(id) ON DELETE CASCADE,
  day_key TEXT NOT NULL CHECK(length(day_key)=10),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points INTEGER NOT NULL CHECK(points IN (5, 500)),
  created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>=0),
  PRIMARY KEY (referral_id, day_key)
);
INSERT INTO referral_activity_rewards_next(referral_id,day_key,user_id,points,created_at)
  SELECT referral_id,day_key,user_id,points,created_at FROM referral_activity_rewards;
DROP TABLE referral_activity_rewards;
ALTER TABLE referral_activity_rewards_next RENAME TO referral_activity_rewards;
CREATE INDEX referral_activity_rewards_owner ON referral_activity_rewards(user_id, created_at DESC);

CREATE TRIGGER referral_activity_rewards_credit_after_insert
AFTER INSERT ON referral_activity_rewards
BEGIN
  INSERT OR IGNORE INTO community_credit_ledger(user_id,source_type,source_id,credits,created_at,expires_at)
    VALUES(NEW.user_id,'referral_reward',NEW.referral_id || ':' || NEW.day_key,NEW.points,NEW.created_at,NULL);
END;

CREATE VIEW credit_usage_balances AS
SELECT user_id,granted_credits,total_spent,reserved_credits,
  MAX(0,granted_credits-total_spent-reserved_credits) AS balance,
  MAX(0,total_spent-granted_credits) AS debt_credits
FROM (
  SELECT u.id AS user_id,
    COALESCE((SELECT SUM(credits) FROM (
      SELECT l.credits FROM payment_credit_ledger l JOIN payment_orders o ON o.id=l.order_id WHERE l.user_id=u.id AND o.mode='live'
      UNION ALL SELECT l.credits FROM zpay_credit_ledger l JOIN zpay_orders o ON o.id=l.order_id WHERE l.user_id=u.id
      UNION ALL SELECT l.credits FROM guagua_credit_ledger l JOIN guagua_orders o ON o.id=l.order_id WHERE l.user_id=u.id
      UNION ALL SELECT credits FROM subscription_credit_ledger WHERE user_id=u.id
      UNION ALL SELECT credits FROM (
        SELECT credits FROM community_credit_ledger WHERE user_id=u.id
        UNION ALL SELECT credits FROM admin_credit_adjustments WHERE user_id=u.id
        UNION ALL SELECT credits FROM trusted_credit_grants WHERE user_id=u.id
        UNION ALL SELECT credits FROM dream_coin_exchanges WHERE user_id=u.id
      )
    )),0) AS granted_credits,
    -COALESCE((SELECT SUM(credits) FROM credit_usage_ledger WHERE user_id=u.id),0)
      -COALESCE((SELECT SUM(credits) FROM generation_credit_ledger WHERE user_id=u.id),0)
      +COALESCE((SELECT SUM(credits) FROM chat_media_usage WHERE user_id=u.id AND status='ready'),0)
      -COALESCE((SELECT SUM(credits) FROM companion_turn_ledger WHERE user_id=u.id),0)
      +COALESCE((SELECT SUM(credits) FROM studio_still_charges WHERE user_id=u.id AND status='charged'),0)
      +COALESCE((SELECT SUM(credits) FROM canvas_generation_charges WHERE user_id=u.id AND status='charged'),0) AS total_spent,
    COALESCE((SELECT SUM(reserved_credits) FROM credit_usage_requests WHERE user_id=u.id AND status IN ('reserved','pending')
      AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),0)
      +COALESCE((SELECT SUM(reserved_credits) FROM generation_jobs WHERE user_id=u.id AND finalized_at IS NULL
      AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),0)
      +COALESCE((SELECT SUM(credits) FROM chat_media_usage WHERE user_id=u.id AND status='pending'),0)
      +COALESCE((SELECT SUM(reserved_credits) FROM companion_turn_requests WHERE user_id=u.id AND status='reserved'
      AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),0)
      +COALESCE((SELECT SUM(credits) FROM studio_still_charges WHERE user_id=u.id AND status='reserved'
      AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),0)
      +COALESCE((SELECT SUM(credits) FROM canvas_generation_charges WHERE user_id=u.id AND status='reserved'
      AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),0) AS reserved_credits
  FROM users u
);

PRAGMA foreign_keys = ON;
