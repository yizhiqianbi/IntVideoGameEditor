-- Merge server-issued community rewards into the spendable Credit wallet.
-- The source tables remain the audit and eligibility records.  This ledger is
-- an idempotent projection: one source reward can create one wallet grant.
CREATE TABLE community_credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK(source_type IN ('task_claim','task_market_reward','referral_reward')),
  source_id TEXT NOT NULL CHECK(length(source_id) BETWEEN 1 AND 512),
  credits INTEGER NOT NULL CHECK(credits BETWEEN 1 AND 1000000000),
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  expires_at INTEGER CHECK(expires_at IS NULL OR expires_at>=created_at),
  UNIQUE(source_type,source_id)
);
CREATE INDEX community_credit_owner ON community_credit_ledger(user_id,created_at DESC,id DESC);
CREATE INDEX community_credit_active ON community_credit_ledger(user_id,expires_at);

-- Backfill every reward that already exists. INSERT OR IGNORE makes the
-- projection safe to replay during migration recovery or verification.
INSERT OR IGNORE INTO community_credit_ledger(user_id,source_type,source_id,credits,created_at,expires_at)
  SELECT user_id,'task_claim',user_id || ':' || task_id || ':' || period,points,claimed_at,NULL FROM task_claims;
INSERT OR IGNORE INTO community_credit_ledger(user_id,source_type,source_id,credits,created_at,expires_at)
  SELECT user_id,'task_market_reward',assignment_id,points,claimed_at,NULL FROM task_market_rewards;
INSERT OR IGNORE INTO community_credit_ledger(user_id,source_type,source_id,credits,created_at,expires_at)
  SELECT user_id,'referral_reward',referral_id,points,created_at,NULL FROM referral_rewards;

-- Keep the projection in sync for all future server-side reward inserts. The
-- unique source key protects against retries and concurrent writes.
CREATE TRIGGER task_claims_credit_after_insert
AFTER INSERT ON task_claims
BEGIN
  INSERT OR IGNORE INTO community_credit_ledger(user_id,source_type,source_id,credits,created_at,expires_at)
    VALUES(NEW.user_id,'task_claim',NEW.user_id || ':' || NEW.task_id || ':' || NEW.period,NEW.points,NEW.claimed_at,NULL);
END;
CREATE TRIGGER task_market_rewards_credit_after_insert
AFTER INSERT ON task_market_rewards
BEGIN
  INSERT OR IGNORE INTO community_credit_ledger(user_id,source_type,source_id,credits,created_at,expires_at)
    VALUES(NEW.user_id,'task_market_reward',NEW.assignment_id,NEW.points,NEW.claimed_at,NULL);
END;
CREATE TRIGGER referral_rewards_credit_after_insert
AFTER INSERT ON referral_rewards
BEGIN
  INSERT OR IGNORE INTO community_credit_ledger(user_id,source_type,source_id,credits,created_at,expires_at)
    VALUES(NEW.user_id,'referral_reward',NEW.referral_id,NEW.points,NEW.created_at,NULL);
END;

-- Rebuild the read-only wallet view. Community rewards are now permanent
-- grants; paid/subscription grants and all existing usage facts are preserved.
-- The original task expiry remains in the task audit tables, while its Credit
-- projection is permanent so a later expiry cannot create wallet debt after a
-- reward has already been spent.
DROP VIEW IF EXISTS credit_usage_balances;
CREATE VIEW credit_usage_balances AS
SELECT user_id,granted_credits,total_spent,reserved_credits,
  MAX(0,granted_credits-total_spent-reserved_credits) AS balance,
  MAX(0,total_spent-granted_credits) AS debt_credits
FROM (
  SELECT u.id AS user_id,
    COALESCE((SELECT SUM(credits) FROM (
      SELECT l.credits FROM payment_credit_ledger l JOIN payment_orders o ON o.id=l.order_id WHERE l.user_id=u.id AND o.mode='live'
      UNION ALL SELECT l.credits FROM zpay_credit_ledger l JOIN zpay_orders o ON o.id=l.order_id WHERE l.user_id=u.id
      UNION ALL SELECT credits FROM subscription_credit_ledger WHERE user_id=u.id
      UNION ALL SELECT credits FROM (
        SELECT credits FROM community_credit_ledger WHERE user_id=u.id
        UNION ALL SELECT credits FROM admin_credit_adjustments WHERE user_id=u.id
        UNION ALL SELECT credits FROM trusted_credit_grants WHERE user_id=u.id
      )
    )),0) AS granted_credits,
    -COALESCE((SELECT SUM(credits) FROM credit_usage_ledger WHERE user_id=u.id),0)
      -COALESCE((SELECT SUM(credits) FROM generation_credit_ledger WHERE user_id=u.id),0) AS total_spent,
    COALESCE((SELECT SUM(reserved_credits) FROM credit_usage_requests WHERE user_id=u.id AND status IN ('reserved','pending')
      AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),0)
      +COALESCE((SELECT SUM(reserved_credits) FROM generation_jobs WHERE user_id=u.id AND finalized_at IS NULL
      AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),0) AS reserved_credits
  FROM users u
);
PRAGMA foreign_keys = ON;
