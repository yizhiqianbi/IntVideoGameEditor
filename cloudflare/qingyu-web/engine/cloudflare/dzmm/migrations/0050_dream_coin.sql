-- RMB-denominated creator and invite wallet. 100 fen = 1 梦币 = ¥1.
-- Exchanged fen become Credit at the same rate as recharge: 1 fen = 1 Credit.
DROP VIEW credit_usage_balances;

CREATE TABLE dream_coin_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_fen INTEGER NOT NULL CHECK(amount_fen<>0 AND amount_fen BETWEEN -1000000000 AND 1000000000),
  kind TEXT NOT NULL CHECK(kind IN ('invite_rebate','creator_reward','exchange','withdraw_hold','withdraw_release')),
  source_type TEXT NOT NULL CHECK(source_type IN ('invite_rebate','creator_reward','exchange','withdraw_hold','withdraw_release')),
  source_id TEXT NOT NULL CHECK(length(source_id) BETWEEN 1 AND 80),
  note TEXT NOT NULL CHECK(length(note) BETWEEN 1 AND 120),
  created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>=0),
  UNIQUE(source_type,source_id)
);
CREATE INDEX dream_coin_ledger_owner ON dream_coin_ledger(user_id,created_at DESC,id);

CREATE TABLE dream_coin_exchanges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_fen INTEGER NOT NULL CHECK(amount_fen BETWEEN 100 AND 100000000 AND amount_fen%100=0),
  credits INTEGER NOT NULL CHECK(credits=amount_fen),
  created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>=0)
);
CREATE INDEX dream_coin_exchanges_owner ON dream_coin_exchanges(user_id,created_at DESC);

CREATE TABLE dream_coin_withdrawals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_fen INTEGER NOT NULL CHECK(amount_fen BETWEEN 1000 AND 100000000 AND amount_fen%100=0),
  payout_account TEXT NOT NULL CHECK(length(payout_account) BETWEEN 2 AND 64),
  status TEXT NOT NULL CHECK(status IN ('pending','paid','rejected')),
  created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>=0),
  updated_at INTEGER NOT NULL CHECK(updated_at>=created_at)
);
CREATE INDEX dream_coin_withdrawals_owner ON dream_coin_withdrawals(user_id,created_at DESC);
CREATE UNIQUE INDEX dream_coin_one_pending ON dream_coin_withdrawals(user_id) WHERE status='pending';

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
      +COALESCE((SELECT SUM(credits) FROM chat_media_usage WHERE user_id=u.id AND kind='image' AND status='ready'),0) AS total_spent,
    COALESCE((SELECT SUM(reserved_credits) FROM credit_usage_requests WHERE user_id=u.id AND status IN ('reserved','pending')
      AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),0)
      +COALESCE((SELECT SUM(reserved_credits) FROM generation_jobs WHERE user_id=u.id AND finalized_at IS NULL
      AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),0)
      +COALESCE((SELECT SUM(credits) FROM chat_media_usage WHERE user_id=u.id AND kind='image' AND status='pending'),0) AS reserved_credits
  FROM users u
);
